import { and, asc, eq } from "drizzle-orm"
import { getDatabase } from "@/db/client"
import {
  entities,
  entityEvidence,
  entityStatusChanges,
  ingestionRuns,
  people,
  sourcePassages,
  sources,
} from "@/db/schema"
import {
  getActivationPolicyViolations,
  hadithGrades,
  SOURCE_POLICY_VERSION,
  type SourceVerification,
  sourceCategories,
} from "@/domain/evidence/source-policy"
import { cleanDisplayText } from "@/domain/people/normalization"
import { PeopleInputError } from "../shared/errors"
import {
  assertMatchingIdempotentRequest,
  hashRequest,
  requireCleanText,
} from "../shared/helpers"
import type {
  ActivatePersonEvidenceInput,
  ActivatePersonInput,
  ActivatePersonResult,
  EvidenceLocatorInput,
} from "../shared/types"

interface PreparedActivationEvidence {
  source: {
    category: (typeof sourceCategories)[number]
    label: string
    uri?: string
    author?: string
    workTitle?: string
    edition?: string
    methodologyBasis: string
    verification: SourceVerification
  }
  passage: string
  language?: string
  locator: EvidenceLocatorInput
  assertion: string
  interpretation: "explicit" | "inferred"
  notes?: string
}

function prepareVerification(
  verification: SourceVerification | undefined,
  index: number,
): SourceVerification {
  if (!verification) {
    return {}
  }

  if (
    verification.hadithGrade !== undefined &&
    !hadithGrades.some((grade) => grade === verification.hadithGrade)
  ) {
    throw new PeopleInputError(
      `evidence[${index}].source.verification.hadithGrade is invalid.`,
    )
  }

  return {
    hadithGrade: verification.hadithGrade,
    gradedBy: cleanOptionalText(
      verification.gradedBy,
      `evidence[${index}].source.verification.gradedBy`,
      500,
    ),
    notes: cleanOptionalText(
      verification.notes,
      `evidence[${index}].source.verification.notes`,
      5_000,
    ),
  }
}

function cleanOptionalText(
  value: string | undefined,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) {
    return undefined
  }

  const cleaned = cleanDisplayText(value)

  if (!cleaned) {
    throw new PeopleInputError(`${field} must not be blank when provided.`)
  }

  if (cleaned.length > maxLength) {
    throw new PeopleInputError(
      `${field} must contain at most ${maxLength} characters.`,
    )
  }

  return cleaned
}

function cleanOptionalUri(
  value: string | undefined,
  field: string,
  maxLength = 2_000,
): string | undefined {
  if (value === undefined) {
    return undefined
  }

  const cleaned = value.trim()

  if (!cleaned) {
    throw new PeopleInputError(`${field} must not be blank when provided.`)
  }

  if (cleaned.length > maxLength) {
    throw new PeopleInputError(
      `${field} must contain at most ${maxLength} characters.`,
    )
  }

  return cleaned
}

function prepareLocator(
  locator: EvidenceLocatorInput | undefined,
  index: number,
): EvidenceLocatorInput {
  if (!locator) {
    return {}
  }

  return {
    volume: cleanOptionalText(
      locator.volume,
      `evidence[${index}].locator.volume`,
      100,
    ),
    page: cleanOptionalText(
      locator.page,
      `evidence[${index}].locator.page`,
      100,
    ),
    chapter: cleanOptionalText(
      locator.chapter,
      `evidence[${index}].locator.chapter`,
      500,
    ),
    verse: cleanOptionalText(
      locator.verse,
      `evidence[${index}].locator.verse`,
      100,
    ),
    hadithNumber: cleanOptionalText(
      locator.hadithNumber,
      `evidence[${index}].locator.hadithNumber`,
      100,
    ),
    section: cleanOptionalText(
      locator.section,
      `evidence[${index}].locator.section`,
      500,
    ),
    url: cleanOptionalUri(locator.url, `evidence[${index}].locator.url`),
  }
}

function prepareEvidence(
  evidence: ActivatePersonEvidenceInput,
  index: number,
): PreparedActivationEvidence {
  if (
    !sourceCategories.some((category) => category === evidence.source.category)
  ) {
    throw new PeopleInputError(`evidence[${index}].source.category is invalid.`)
  }

  if (
    evidence.interpretation !== "explicit" &&
    evidence.interpretation !== "inferred"
  ) {
    throw new PeopleInputError(
      `evidence[${index}].interpretation must be explicit or inferred.`,
    )
  }

  return {
    source: {
      category: evidence.source.category,
      label: requireCleanText(
        evidence.source.label,
        `evidence[${index}].source.label`,
        500,
      ),
      uri: cleanOptionalUri(
        evidence.source.uri,
        `evidence[${index}].source.uri`,
      ),
      author: cleanOptionalText(
        evidence.source.author,
        `evidence[${index}].source.author`,
        500,
      ),
      workTitle: cleanOptionalText(
        evidence.source.workTitle,
        `evidence[${index}].source.workTitle`,
        500,
      ),
      edition: cleanOptionalText(
        evidence.source.edition,
        `evidence[${index}].source.edition`,
        500,
      ),
      methodologyBasis: requireCleanText(
        evidence.source.methodologyBasis,
        `evidence[${index}].source.methodologyBasis`,
        5_000,
      ),
      verification: prepareVerification(evidence.source.verification, index),
    },
    passage: requireCleanText(
      evidence.passage,
      `evidence[${index}].passage`,
      20_000,
    ),
    language: cleanOptionalText(
      evidence.language,
      `evidence[${index}].language`,
      100,
    ),
    locator: prepareLocator(evidence.locator, index),
    assertion: requireCleanText(
      evidence.assertion,
      `evidence[${index}].assertion`,
      5_000,
    ),
    interpretation: evidence.interpretation,
    notes: cleanOptionalText(evidence.notes, `evidence[${index}].notes`, 5_000),
  }
}

async function replayActivation(
  transaction: Parameters<
    Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]
  >[0],
  runId: string,
  entityId: string,
): Promise<ActivatePersonResult> {
  const [statusChange] = await transaction
    .select({ id: entityStatusChanges.id })
    .from(entityStatusChanges)
    .where(
      and(
        eq(entityStatusChanges.createdByRunId, runId),
        eq(entityStatusChanges.entityId, entityId),
        eq(entityStatusChanges.toStatus, "active"),
      ),
    )
    .limit(1)

  if (!statusChange) {
    throw new Error(`Activation run "${runId}" has no status change record.`)
  }

  const evidenceRows = await transaction
    .select({ id: entityEvidence.id })
    .from(entityEvidence)
    .where(
      and(
        eq(entityEvidence.createdByRunId, runId),
        eq(entityEvidence.entityId, entityId),
      ),
    )
    .orderBy(asc(entityEvidence.id))

  return {
    runId,
    replayed: true,
    entityId,
    status: "active",
    evidenceIds: evidenceRows.map(({ id }) => id),
    statusChangeId: statusChange.id,
  }
}

export async function activatePerson(
  input: ActivatePersonInput,
): Promise<ActivatePersonResult> {
  const operationKey = requireCleanText(input.operationKey, "operationKey", 300)
  const entityId = requireCleanText(input.entityId, "entityId", 100)
  const reason = requireCleanText(input.reason, "reason", 5_000)
  const instruction = cleanOptionalText(input.instruction, "instruction", 5_000)

  if (input.evidence.length === 0) {
    throw new PeopleInputError(
      "evidence must contain at least one accepted source passage.",
    )
  }

  if (input.evidence.length > 20) {
    throw new PeopleInputError("evidence must contain at most 20 passages.")
  }

  const preparedEvidence = input.evidence.map(prepareEvidence)
  const policyViolations = getActivationPolicyViolations(preparedEvidence)

  if (policyViolations.length > 0) {
    throw new PeopleInputError(policyViolations.join(" "))
  }

  const requestHash = hashRequest({
    operation: "activate_person",
    sourcePolicyVersion: SOURCE_POLICY_VERSION,
    entityId,
    reason,
    instruction,
    evidence: preparedEvidence,
  })
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

      return replayActivation(transaction, existingRun.id, entityId)
    }

    const [person] = await transaction
      .select({
        status: entities.status,
        mergedIntoEntityId: entities.mergedIntoEntityId,
      })
      .from(entities)
      .innerJoin(people, eq(people.entityId, entities.id))
      .where(eq(entities.id, entityId))
      .limit(1)

    if (!person) {
      throw new PeopleInputError(`Person "${entityId}" was not found.`)
    }

    if (person.status === "merged") {
      throw new PeopleInputError(
        `Person "${entityId}" was merged into "${person.mergedIntoEntityId}".`,
      )
    }

    if (person.status === "active") {
      throw new PeopleInputError(`Person "${entityId}" is already active.`)
    }

    const distinctSourceLabels = [
      ...new Set(preparedEvidence.map(({ source }) => source.label)),
    ]
    const distinctSourceUris = [
      ...new Set(
        preparedEvidence
          .map(({ source }) => source.uri)
          .filter((uri): uri is string => uri !== undefined),
      ),
    ]
    const [run] = await transaction
      .insert(ingestionRuns)
      .values({
        idempotencyKey: operationKey,
        instruction,
        sourceLabel:
          distinctSourceLabels.length === 1
            ? distinctSourceLabels[0]
            : `${distinctSourceLabels.length} verification sources`,
        sourceUri:
          distinctSourceUris.length === 1 ? distinctSourceUris[0] : undefined,
        metadata: {
          operation: "activate_person",
          requestHash,
          entityId,
          evidenceCount: preparedEvidence.length,
          sourcePolicyVersion: SOURCE_POLICY_VERSION,
        },
      })
      .returning({ id: ingestionRuns.id })

    if (!run) {
      throw new Error("Failed to create activation ingestion run.")
    }

    const evidenceIds: string[] = []

    for (const evidence of preparedEvidence) {
      const [source] = await transaction
        .insert(sources)
        .values({
          ...evidence.source,
          methodology:
            evidence.source.category === "context_only"
              ? "context_only"
              : "salafiyyun",
          policyVersion: SOURCE_POLICY_VERSION,
          createdByRunId: run.id,
        })
        .returning({ id: sources.id })

      if (!source) {
        throw new Error("Failed to create verification source.")
      }

      const [passage] = await transaction
        .insert(sourcePassages)
        .values({
          sourceId: source.id,
          passage: evidence.passage,
          language: evidence.language,
          locator: evidence.locator,
          createdByRunId: run.id,
        })
        .returning({ id: sourcePassages.id })

      if (!passage) {
        throw new Error("Failed to create source passage.")
      }

      const [evidenceRow] = await transaction
        .insert(entityEvidence)
        .values({
          entityId,
          passageId: passage.id,
          assertion: evidence.assertion,
          interpretation: evidence.interpretation,
          status: "accepted",
          notes: evidence.notes,
          createdByRunId: run.id,
        })
        .returning({ id: entityEvidence.id })

      if (!evidenceRow) {
        throw new Error("Failed to attach person evidence.")
      }

      evidenceIds.push(evidenceRow.id)
    }

    const [activated] = await transaction
      .update(entities)
      .set({
        status: "active",
        updatedAt: new Date(),
      })
      .where(and(eq(entities.id, entityId), eq(entities.status, "provisional")))
      .returning({ id: entities.id })

    if (!activated) {
      throw new PeopleInputError(
        `Person "${entityId}" changed while activation was in progress.`,
      )
    }

    const [statusChange] = await transaction
      .insert(entityStatusChanges)
      .values({
        entityId,
        fromStatus: "provisional",
        toStatus: "active",
        reason,
        createdByRunId: run.id,
      })
      .returning({ id: entityStatusChanges.id })

    if (!statusChange) {
      throw new Error("Failed to create status change record.")
    }

    return {
      runId: run.id,
      replayed: false,
      entityId,
      status: "active",
      evidenceIds,
      statusChangeId: statusChange.id,
    }
  })
}
