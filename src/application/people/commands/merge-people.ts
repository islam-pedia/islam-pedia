import { and, asc, eq, inArray, or, sql } from "drizzle-orm"
import { getDatabase } from "@/db/client"
import {
  entities,
  entityEvidence,
  entitySearchTerms,
  entityStatusChanges,
  ingestionRuns,
  people,
  personGenderChanges,
  personNames,
  personPrimaryNameChanges,
  personRelationshipEvidence,
  personRelationshipStatusChanges,
  personRelationships,
} from "@/db/schema"
import {
  getActivationPolicyViolations,
  SOURCE_POLICY_VERSION,
} from "@/domain/evidence/source-policy"
import { cleanDisplayText } from "@/domain/people/normalization"
import { PeopleInputError } from "../shared/errors"
import {
  getEvidenceSourceSummary,
  insertEvidenceSourcePassage,
  prepareEvidence,
} from "../shared/evidence"
import {
  assertMatchingIdempotentRequest,
  hashRequest,
  requireCleanText,
} from "../shared/helpers"
import type {
  MergePeopleInput,
  MergePeopleResult,
  PersonGender,
} from "../shared/types"

type ActivePersonStatus = "provisional" | "active"

interface MergePersonRow {
  entityId: string
  status: "provisional" | "active" | "merged"
  mergedIntoEntityId: string | null
  nameOriginal: string
  gender: PersonGender
}

interface StoredMergeResult {
  duplicatePersonId: MergePeopleResult["duplicatePersonId"]
  canonicalPersonId: MergePeopleResult["canonicalPersonId"]
  duplicateStatusBefore: MergePeopleResult["duplicateStatusBefore"]
  canonicalStatusBefore: MergePeopleResult["canonicalStatusBefore"]
  canonicalStatusAfter: MergePeopleResult["canonicalStatusAfter"]
  canonicalGenderBefore: MergePeopleResult["canonicalGenderBefore"]
  canonicalGenderAfter: MergePeopleResult["canonicalGenderAfter"]
  duplicateStatusChangeId: MergePeopleResult["duplicateStatusChangeId"]
  canonicalStatusChangeId: MergePeopleResult["canonicalStatusChangeId"]
  canonicalGenderChangeId: MergePeopleResult["canonicalGenderChangeId"]
  mergeEvidenceIds: MergePeopleResult["mergeEvidenceIds"]
  transferred: MergePeopleResult["transferred"]
  deduplicated: MergePeopleResult["deduplicated"]
}

export async function mergePeople(
  input: MergePeopleInput,
): Promise<MergePeopleResult> {
  const operationKey = requireCleanText(input.operationKey, "operationKey", 300)
  const duplicatePersonId = requireCleanText(
    input.duplicatePersonId,
    "duplicatePersonId",
    100,
  )
  const canonicalPersonId = requireCleanText(
    input.canonicalPersonId,
    "canonicalPersonId",
    100,
  )
  const expectedDuplicateNameOriginal = requireCleanText(
    input.expectedDuplicateNameOriginal,
    "expectedDuplicateNameOriginal",
    500,
  )
  const expectedCanonicalNameOriginal = requireCleanText(
    input.expectedCanonicalNameOriginal,
    "expectedCanonicalNameOriginal",
    500,
  )
  const reason = requireCleanText(input.reason, "reason", 5_000)
  const instruction =
    input.instruction === undefined
      ? undefined
      : requireCleanText(input.instruction, "instruction", 5_000)

  if (duplicatePersonId === canonicalPersonId) {
    throw new PeopleInputError(
      "duplicatePersonId and canonicalPersonId must identify different people.",
    )
  }

  if (input.evidence.length === 0 || input.evidence.length > 20) {
    throw new PeopleInputError(
      "evidence must contain between 1 and 20 source passages.",
    )
  }

  const preparedEvidence = input.evidence.map(prepareEvidence)
  const policyViolations = getActivationPolicyViolations(preparedEvidence)

  if (policyViolations.length > 0) {
    throw new PeopleInputError(
      `A destructive identity merge requires activation-grade evidence. ${policyViolations.join(" ")}`,
    )
  }

  const requestHash = hashRequest({
    operation: "merge_people",
    sourcePolicyVersion: SOURCE_POLICY_VERSION,
    duplicatePersonId,
    canonicalPersonId,
    expectedDuplicateNameOriginal,
    expectedCanonicalNameOriginal,
    reason,
    instruction,
    evidence: preparedEvidence,
  })
  const sourceSummary = getEvidenceSourceSummary(preparedEvidence)
  const database = getDatabase()

  return database.transaction(async (transaction) => {
    const [existingRun] = await transaction
      .select()
      .from(ingestionRuns)
      .where(eq(ingestionRuns.idempotencyKey, operationKey))
      .limit(1)

    if (existingRun) {
      assertMatchingIdempotentRequest(
        existingRun.metadata,
        requestHash,
        operationKey,
      )

      return replayMerge(existingRun.id, existingRun.metadata)
    }

    await transaction.execute(sql`
      SELECT ${entities.id}
      FROM ${entities}
      WHERE ${entities.id} IN (
        ${duplicatePersonId}::uuid,
        ${canonicalPersonId}::uuid
      )
      ORDER BY ${entities.id}
      FOR UPDATE
    `)

    const personRows = await transaction
      .select({
        entityId: people.entityId,
        status: entities.status,
        mergedIntoEntityId: entities.mergedIntoEntityId,
        nameOriginal: people.nameOriginal,
        gender: people.gender,
      })
      .from(people)
      .innerJoin(entities, eq(entities.id, people.entityId))
      .where(inArray(people.entityId, [duplicatePersonId, canonicalPersonId]))
    const peopleById = new Map(
      personRows.map((person) => [person.entityId, person]),
    )
    const duplicate = peopleById.get(duplicatePersonId)
    const canonical = peopleById.get(canonicalPersonId)

    assertMergePerson(duplicate, duplicatePersonId, "duplicate")
    assertMergePerson(canonical, canonicalPersonId, "canonical")
    assertExpectedName(
      duplicate.nameOriginal,
      expectedDuplicateNameOriginal,
      "duplicate",
    )
    assertExpectedName(
      canonical.nameOriginal,
      expectedCanonicalNameOriginal,
      "canonical",
    )
    assertCompatibleGenders(duplicate.gender, canonical.gender)

    const duplicateNames = await transaction
      .select()
      .from(personNames)
      .where(eq(personNames.entityId, duplicatePersonId))
      .orderBy(asc(personNames.id))
    const canonicalNames = await transaction
      .select()
      .from(personNames)
      .where(eq(personNames.entityId, canonicalPersonId))
      .orderBy(asc(personNames.id))

    if (!canonicalNames.some(({ isPrimary }) => isPrimary)) {
      throw new Error(
        `Canonical person "${canonicalPersonId}" has no primary structured name.`,
      )
    }

    const canonicalNamesByIdentity = new Map(
      canonicalNames.map((name) => [personNameIdentity(name), name]),
    )
    const duplicateNameMappings = duplicateNames
      .map((name) => ({
        duplicateName: name,
        canonicalName: canonicalNamesByIdentity.get(personNameIdentity(name)),
      }))
      .filter(
        (
          item,
        ): item is {
          duplicateName: (typeof duplicateNames)[number]
          canonicalName: (typeof canonicalNames)[number]
        } => item.canonicalName !== undefined,
      )
    const duplicateNameIdsToDelete = new Set(
      duplicateNameMappings.map(({ duplicateName }) => duplicateName.id),
    )
    const duplicateNameIdsToMove = duplicateNames
      .filter(({ id }) => !duplicateNameIdsToDelete.has(id))
      .map(({ id }) => id)

    const duplicateKeywords = await transaction
      .select()
      .from(entitySearchTerms)
      .where(eq(entitySearchTerms.entityId, duplicatePersonId))
      .orderBy(asc(entitySearchTerms.id))
    const canonicalKeywords = await transaction
      .select()
      .from(entitySearchTerms)
      .where(eq(entitySearchTerms.entityId, canonicalPersonId))
      .orderBy(asc(entitySearchTerms.id))
    const canonicalKeywordsByNormalized = new Map(
      canonicalKeywords.map((keyword) => [keyword.normalizedTerm, keyword]),
    )
    const duplicateKeywordMappings = duplicateKeywords
      .map((keyword) => ({
        duplicateKeyword: keyword,
        canonicalKeyword: canonicalKeywordsByNormalized.get(
          keyword.normalizedTerm,
        ),
      }))
      .filter(
        (
          item,
        ): item is {
          duplicateKeyword: (typeof duplicateKeywords)[number]
          canonicalKeyword: (typeof canonicalKeywords)[number]
        } => item.canonicalKeyword !== undefined,
      )
    const duplicateKeywordIdsToDelete = new Set(
      duplicateKeywordMappings.map(
        ({ duplicateKeyword }) => duplicateKeyword.id,
      ),
    )
    const duplicateKeywordIdsToMove = duplicateKeywords
      .filter(({ id }) => !duplicateKeywordIdsToDelete.has(id))
      .map(({ id }) => id)

    const duplicateRelationships = await transaction
      .select()
      .from(personRelationships)
      .where(
        or(
          eq(personRelationships.fromPersonId, duplicatePersonId),
          eq(personRelationships.toPersonId, duplicatePersonId),
        ),
      )
      .orderBy(asc(personRelationships.id))
    const relationshipPlans: Array<{
      relationship: (typeof duplicateRelationships)[number]
      mappedFromPersonId: string
      mappedToPersonId: string
      consolidateIntoRelationshipId: string | null
    }> = []

    for (const relationship of duplicateRelationships) {
      const mappedFromPersonId =
        relationship.fromPersonId === duplicatePersonId
          ? canonicalPersonId
          : relationship.fromPersonId
      const mappedToPersonId =
        relationship.toPersonId === duplicatePersonId
          ? canonicalPersonId
          : relationship.toPersonId

      if (mappedFromPersonId === mappedToPersonId) {
        throw new PeopleInputError(
          `Cannot merge because relationship "${relationship.id}" would become a self-relationship.`,
        )
      }

      const [existingRelationship] = await transaction
        .select()
        .from(personRelationships)
        .where(
          and(
            eq(personRelationships.fromPersonId, mappedFromPersonId),
            eq(personRelationships.toPersonId, mappedToPersonId),
            eq(personRelationships.type, relationship.type),
          ),
        )
        .limit(1)

      if (
        existingRelationship &&
        existingRelationship.id !== relationship.id &&
        existingRelationship.status !== relationship.status
      ) {
        throw new PeopleInputError(
          `Cannot merge relationship "${relationship.id}" into "${existingRelationship.id}" because their assertion statuses differ (${relationship.status} versus ${existingRelationship.status}). Resolve the relationship dispute first.`,
        )
      }

      relationshipPlans.push({
        relationship,
        mappedFromPersonId,
        mappedToPersonId,
        consolidateIntoRelationshipId:
          existingRelationship && existingRelationship.id !== relationship.id
            ? existingRelationship.id
            : null,
      })
    }

    const duplicateRelationshipIds = duplicateRelationships.map(({ id }) => id)
    const relationshipEvidenceRows =
      duplicateRelationshipIds.length === 0
        ? []
        : await transaction
            .select({ id: personRelationshipEvidence.id })
            .from(personRelationshipEvidence)
            .where(
              inArray(
                personRelationshipEvidence.relationshipId,
                duplicateRelationshipIds,
              ),
            )
    const relationshipStatusChangeRows =
      duplicateRelationshipIds.length === 0
        ? []
        : await transaction
            .select({ id: personRelationshipStatusChanges.id })
            .from(personRelationshipStatusChanges)
            .where(
              inArray(
                personRelationshipStatusChanges.relationshipId,
                duplicateRelationshipIds,
              ),
            )
    const duplicateEntityEvidenceRows = await transaction
      .select({ id: entityEvidence.id })
      .from(entityEvidence)
      .where(eq(entityEvidence.entityId, duplicatePersonId))
    const duplicateGenderChangeRows = await transaction
      .select({ id: personGenderChanges.id })
      .from(personGenderChanges)
      .where(eq(personGenderChanges.entityId, duplicatePersonId))
    const duplicatePrimaryNameChangeRows = await transaction
      .select({ id: personPrimaryNameChanges.id })
      .from(personPrimaryNameChanges)
      .where(eq(personPrimaryNameChanges.entityId, duplicatePersonId))

    const [run] = await transaction
      .insert(ingestionRuns)
      .values({
        idempotencyKey: operationKey,
        instruction,
        sourceLabel: sourceSummary.sourceLabel,
        sourceUri: sourceSummary.sourceUri,
        metadata: {
          operation: "merge_people",
          requestHash,
          duplicatePersonId,
          canonicalPersonId,
          sourcePolicyVersion: SOURCE_POLICY_VERSION,
        },
      })
      .returning({ id: ingestionRuns.id })

    if (!run) {
      throw new Error("Failed to create person-merge ingestion run.")
    }

    await transaction
      .update(personNames)
      .set({ isPrimary: false })
      .where(eq(personNames.entityId, duplicatePersonId))

    for (const { duplicateName, canonicalName } of duplicateNameMappings) {
      await transaction
        .update(personPrimaryNameChanges)
        .set({ fromNameId: canonicalName.id })
        .where(eq(personPrimaryNameChanges.fromNameId, duplicateName.id))
      await transaction
        .update(personPrimaryNameChanges)
        .set({ toNameId: canonicalName.id })
        .where(eq(personPrimaryNameChanges.toNameId, duplicateName.id))
    }

    if (duplicateNameIdsToDelete.size > 0) {
      await transaction
        .delete(personNames)
        .where(inArray(personNames.id, [...duplicateNameIdsToDelete]))
    }

    if (duplicateNameIdsToMove.length > 0) {
      await transaction
        .update(personNames)
        .set({ entityId: canonicalPersonId })
        .where(inArray(personNames.id, duplicateNameIdsToMove))
    }

    for (const {
      duplicateKeyword,
      canonicalKeyword,
    } of duplicateKeywordMappings) {
      if (duplicateKeyword.weight > canonicalKeyword.weight) {
        await transaction
          .update(entitySearchTerms)
          .set({ weight: duplicateKeyword.weight })
          .where(eq(entitySearchTerms.id, canonicalKeyword.id))
      }
    }

    if (duplicateKeywordIdsToDelete.size > 0) {
      await transaction
        .delete(entitySearchTerms)
        .where(inArray(entitySearchTerms.id, [...duplicateKeywordIdsToDelete]))
    }

    if (duplicateKeywordIdsToMove.length > 0) {
      await transaction
        .update(entitySearchTerms)
        .set({ entityId: canonicalPersonId })
        .where(inArray(entitySearchTerms.id, duplicateKeywordIdsToMove))
    }

    await transaction
      .update(entityEvidence)
      .set({ entityId: canonicalPersonId })
      .where(eq(entityEvidence.entityId, duplicatePersonId))
    await transaction
      .update(personGenderChanges)
      .set({ entityId: canonicalPersonId })
      .where(eq(personGenderChanges.entityId, duplicatePersonId))
    await transaction
      .update(personPrimaryNameChanges)
      .set({ entityId: canonicalPersonId })
      .where(eq(personPrimaryNameChanges.entityId, duplicatePersonId))

    let relationshipsTransferred = 0
    let relationshipsDeduplicated = 0

    for (const plan of relationshipPlans) {
      if (plan.consolidateIntoRelationshipId) {
        await transaction
          .update(personRelationshipEvidence)
          .set({ relationshipId: plan.consolidateIntoRelationshipId })
          .where(
            eq(personRelationshipEvidence.relationshipId, plan.relationship.id),
          )
        await transaction
          .update(personRelationshipStatusChanges)
          .set({ relationshipId: plan.consolidateIntoRelationshipId })
          .where(
            eq(
              personRelationshipStatusChanges.relationshipId,
              plan.relationship.id,
            ),
          )
        await transaction
          .delete(personRelationships)
          .where(eq(personRelationships.id, plan.relationship.id))
        relationshipsDeduplicated += 1
      } else {
        await transaction
          .update(personRelationships)
          .set({
            fromPersonId: plan.mappedFromPersonId,
            toPersonId: plan.mappedToPersonId,
            updatedAt: new Date(),
          })
          .where(eq(personRelationships.id, plan.relationship.id))
        relationshipsTransferred += 1
      }
    }

    const canonicalGenderBefore = canonical.gender
    const canonicalGenderAfter =
      canonical.gender === "unknown" ? duplicate.gender : canonical.gender
    let canonicalGenderChangeId: string | null = null

    if (canonicalGenderAfter !== canonicalGenderBefore) {
      await transaction
        .update(people)
        .set({ gender: canonicalGenderAfter })
        .where(eq(people.entityId, canonicalPersonId))
      const [genderChange] = await transaction
        .insert(personGenderChanges)
        .values({
          entityId: canonicalPersonId,
          fromGender: canonicalGenderBefore,
          toGender: canonicalGenderAfter,
          reason: `Transferred known gender while merging duplicate person "${duplicatePersonId}". ${reason}`,
          createdByRunId: run.id,
        })
        .returning({ id: personGenderChanges.id })

      if (!genderChange) {
        throw new Error("Failed to record canonical gender promotion.")
      }

      canonicalGenderChangeId = genderChange.id
    }

    const canonicalStatusAfter: ActivePersonStatus =
      canonical.status === "active" || duplicate.status === "active"
        ? "active"
        : "provisional"
    let canonicalStatusChangeId: string | null = null

    if (canonicalStatusAfter !== canonical.status) {
      await transaction
        .update(entities)
        .set({ status: canonicalStatusAfter, updatedAt: new Date() })
        .where(eq(entities.id, canonicalPersonId))
      const [canonicalStatusChange] = await transaction
        .insert(entityStatusChanges)
        .values({
          entityId: canonicalPersonId,
          fromStatus: canonical.status,
          toStatus: canonicalStatusAfter,
          reason: `Preserved the stronger status while merging duplicate person "${duplicatePersonId}". ${reason}`,
          createdByRunId: run.id,
        })
        .returning({ id: entityStatusChanges.id })

      if (!canonicalStatusChange) {
        throw new Error("Failed to record canonical status promotion.")
      }

      canonicalStatusChangeId = canonicalStatusChange.id
    } else {
      await transaction
        .update(entities)
        .set({ updatedAt: new Date() })
        .where(eq(entities.id, canonicalPersonId))
    }

    const mergeEvidenceIds: string[] = []

    for (const evidence of preparedEvidence) {
      const { passageId } = await insertEvidenceSourcePassage(
        transaction,
        evidence,
        run.id,
      )
      const [evidenceRow] = await transaction
        .insert(entityEvidence)
        .values({
          entityId: canonicalPersonId,
          passageId,
          assertion: evidence.assertion,
          interpretation: evidence.interpretation,
          status: "accepted",
          notes: evidence.notes,
          qualifiers: {
            operation: "merge_people",
            duplicatePersonId,
            canonicalPersonId,
          },
          createdByRunId: run.id,
        })
        .returning({ id: entityEvidence.id })

      if (!evidenceRow) {
        throw new Error("Failed to attach identity-merge evidence.")
      }

      mergeEvidenceIds.push(evidenceRow.id)
    }

    const [mergedEntity] = await transaction
      .update(entities)
      .set({
        status: "merged",
        mergedIntoEntityId: canonicalPersonId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(entities.id, duplicatePersonId),
          inArray(entities.status, ["provisional", "active"]),
        ),
      )
      .returning({ id: entities.id })

    if (!mergedEntity) {
      throw new PeopleInputError(
        `Duplicate person "${duplicatePersonId}" changed while the merge was in progress.`,
      )
    }

    const [duplicateStatusChange] = await transaction
      .insert(entityStatusChanges)
      .values({
        entityId: duplicatePersonId,
        fromStatus: duplicate.status,
        toStatus: "merged",
        reason,
        createdByRunId: run.id,
      })
      .returning({ id: entityStatusChanges.id })

    if (!duplicateStatusChange) {
      throw new Error("Failed to record duplicate merge status.")
    }

    const storedResult: StoredMergeResult = {
      duplicatePersonId,
      canonicalPersonId,
      duplicateStatusBefore: duplicate.status,
      canonicalStatusBefore: canonical.status,
      canonicalStatusAfter,
      canonicalGenderBefore,
      canonicalGenderAfter,
      duplicateStatusChangeId: duplicateStatusChange.id,
      canonicalStatusChangeId,
      canonicalGenderChangeId,
      mergeEvidenceIds,
      transferred: {
        names: duplicateNameIdsToMove.length,
        keywords: duplicateKeywordIdsToMove.length,
        entityEvidence: duplicateEntityEvidenceRows.length,
        genderChanges: duplicateGenderChangeRows.length,
        primaryNameChanges: duplicatePrimaryNameChangeRows.length,
        relationships: relationshipsTransferred,
        relationshipEvidence: relationshipEvidenceRows.length,
        relationshipStatusChanges: relationshipStatusChangeRows.length,
      },
      deduplicated: {
        names: duplicateNameIdsToDelete.size,
        keywords: duplicateKeywordIdsToDelete.size,
        relationships: relationshipsDeduplicated,
      },
    }

    await transaction
      .update(ingestionRuns)
      .set({
        metadata: {
          operation: "merge_people",
          requestHash,
          duplicatePersonId,
          canonicalPersonId,
          sourcePolicyVersion: SOURCE_POLICY_VERSION,
          result: storedResult,
        },
      })
      .where(eq(ingestionRuns.id, run.id))

    return {
      runId: run.id,
      replayed: false,
      ...storedResult,
    }
  })
}

function assertMergePerson(
  person: MergePersonRow | undefined,
  entityId: string,
  role: "duplicate" | "canonical",
): asserts person is MergePersonRow & { status: ActivePersonStatus } {
  if (!person) {
    throw new PeopleInputError(`${role} person "${entityId}" was not found.`)
  }

  if (person.status === "merged") {
    throw new PeopleInputError(
      `${role} person "${entityId}" was already merged into "${person.mergedIntoEntityId}".`,
    )
  }
}

function assertExpectedName(
  actual: string,
  expected: string,
  role: "duplicate" | "canonical",
): void {
  if (cleanDisplayText(actual) !== cleanDisplayText(expected)) {
    throw new PeopleInputError(
      `The ${role} person's current original name is "${actual}", not the expected "${expected}". Re-read the person before merging.`,
    )
  }
}

function assertCompatibleGenders(
  duplicateGender: PersonGender,
  canonicalGender: PersonGender,
): void {
  if (
    duplicateGender !== "unknown" &&
    canonicalGender !== "unknown" &&
    duplicateGender !== canonicalGender
  ) {
    throw new PeopleInputError(
      `Cannot merge people with conflicting explicit genders (${duplicateGender} versus ${canonicalGender}). Resolve the conflict first.`,
    )
  }
}

function personNameIdentity(name: {
  type: string
  nameOriginalNormalized: string
  nameLatinNormalized: string
}): string {
  return [
    name.type,
    name.nameOriginalNormalized,
    name.nameLatinNormalized,
  ].join("\u0000")
}

function replayMerge(
  runId: string,
  metadata: Record<string, unknown>,
): MergePeopleResult {
  const result = metadata.result

  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error(`Person-merge run "${runId}" has no stored result.`)
  }

  return {
    runId,
    replayed: true,
    ...(result as StoredMergeResult),
  }
}
