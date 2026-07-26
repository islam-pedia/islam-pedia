import { and, asc, eq, inArray } from "drizzle-orm"
import { getDatabase } from "@/db/client"
import {
  entities,
  ingestionRuns,
  people,
  personRelationshipEvidence,
  personRelationshipStatusChanges,
  personRelationships,
} from "@/db/schema"
import { SOURCE_POLICY_VERSION } from "@/domain/evidence/source-policy"
import { personRelationshipTypes } from "@/domain/people/relationships"
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
  AddPersonRelationshipInput,
  AddPersonRelationshipResult,
  AssertionStatus,
} from "../shared/types"

const assertionStatuses = [
  "accepted",
  "uncertain",
  "disputed",
  "retracted",
] as const

export async function addPersonRelationship(
  input: AddPersonRelationshipInput,
): Promise<AddPersonRelationshipResult> {
  const operationKey = requireCleanText(input.operationKey, "operationKey", 300)
  const fromPersonId = requireCleanText(input.fromPersonId, "fromPersonId", 100)
  const toPersonId = requireCleanText(input.toPersonId, "toPersonId", 100)
  const reason = requireCleanText(input.reason, "reason", 5_000)

  if (fromPersonId === toPersonId) {
    throw new PeopleInputError("A person relationship cannot point to itself.")
  }

  if (!personRelationshipTypes.includes(input.type)) {
    throw new PeopleInputError(
      `Unsupported person relationship type "${input.type}".`,
    )
  }

  if (!assertionStatuses.includes(input.status)) {
    throw new PeopleInputError(
      `Unsupported relationship status "${input.status}".`,
    )
  }

  if (input.evidence.length === 0 || input.evidence.length > 20) {
    throw new PeopleInputError(
      "evidence must contain between 1 and 20 source passages.",
    )
  }

  const instruction =
    input.instruction === undefined
      ? undefined
      : requireCleanText(input.instruction, "instruction", 5_000)
  const preparedEvidence = input.evidence.map(prepareEvidence)

  assertEvidenceSupportsStatus(preparedEvidence, input.status)

  const requestHash = hashRequest({
    operation: "add_person_relationship",
    sourcePolicyVersion: SOURCE_POLICY_VERSION,
    fromPersonId,
    toPersonId,
    type: input.type,
    status: input.status,
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

      return replayRelationship(transaction, existingRun.id)
    }

    const peopleRows = await transaction
      .select({
        entityId: people.entityId,
        gender: people.gender,
        status: entities.status,
        mergedIntoEntityId: entities.mergedIntoEntityId,
      })
      .from(people)
      .innerJoin(entities, eq(entities.id, people.entityId))
      .where(inArray(people.entityId, [fromPersonId, toPersonId]))

    const peopleById = new Map(
      peopleRows.map((person) => [person.entityId, person]),
    )
    const fromPerson = peopleById.get(fromPersonId)
    const toPerson = peopleById.get(toPersonId)

    assertRelationshipPerson(fromPerson, fromPersonId)
    assertRelationshipPerson(toPerson, toPersonId)

    if (input.type === "husband_of") {
      if (fromPerson.gender !== "male" || toPerson.gender !== "female") {
        throw new PeopleInputError(
          "husband_of requires fromPersonId to be male and toPersonId to be female.",
        )
      }
    }

    const [existingRelationship] = await transaction
      .select()
      .from(personRelationships)
      .where(
        and(
          eq(personRelationships.fromPersonId, fromPersonId),
          eq(personRelationships.toPersonId, toPersonId),
          eq(personRelationships.type, input.type),
        ),
      )
      .limit(1)
    const sourceSummary = getEvidenceSourceSummary(preparedEvidence)
    const [run] = await transaction
      .insert(ingestionRuns)
      .values({
        idempotencyKey: operationKey,
        instruction,
        sourceLabel: sourceSummary.sourceLabel,
        sourceUri: sourceSummary.sourceUri,
        metadata: {
          operation: "add_person_relationship",
          requestHash,
          fromPersonId,
          toPersonId,
          type: input.type,
          status: input.status,
          evidenceCount: preparedEvidence.length,
          sourcePolicyVersion: SOURCE_POLICY_VERSION,
        },
      })
      .returning({ id: ingestionRuns.id })

    if (!run) {
      throw new Error("Failed to create relationship ingestion run.")
    }

    let relationshipId: string
    let created = false
    let statusChangeId: string | null = null

    if (existingRelationship) {
      relationshipId = existingRelationship.id

      if (existingRelationship.status !== input.status) {
        await transaction
          .update(personRelationships)
          .set({ status: input.status, updatedAt: new Date() })
          .where(eq(personRelationships.id, relationshipId))

        statusChangeId = await insertStatusChange(
          transaction,
          relationshipId,
          existingRelationship.status,
          input.status,
          reason,
          run.id,
        )
      }
    } else {
      const [relationship] = await transaction
        .insert(personRelationships)
        .values({
          fromPersonId,
          toPersonId,
          type: input.type,
          status: input.status,
          createdByRunId: run.id,
        })
        .returning({ id: personRelationships.id })

      if (!relationship) {
        throw new Error("Failed to create person relationship.")
      }

      relationshipId = relationship.id
      created = true
      statusChangeId = await insertStatusChange(
        transaction,
        relationshipId,
        null,
        input.status,
        reason,
        run.id,
      )
    }

    const evidenceIds: string[] = []

    for (const evidence of preparedEvidence) {
      const { passageId } = await insertEvidenceSourcePassage(
        transaction,
        evidence,
        run.id,
      )
      const [evidenceRow] = await transaction
        .insert(personRelationshipEvidence)
        .values({
          relationshipId,
          passageId,
          assertion: evidence.assertion,
          interpretation: evidence.interpretation,
          status: input.status,
          notes: evidence.notes,
          createdByRunId: run.id,
        })
        .returning({ id: personRelationshipEvidence.id })

      if (!evidenceRow) {
        throw new Error("Failed to attach relationship evidence.")
      }

      evidenceIds.push(evidenceRow.id)
    }

    return {
      runId: run.id,
      replayed: false,
      relationshipId,
      created,
      status: input.status,
      evidenceIds,
      statusChangeId,
    }
  })
}

type RelationshipTransaction = Parameters<
  Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]
>[0]

interface RelationshipPerson {
  gender: "male" | "female" | "unknown"
  status: "provisional" | "active" | "merged"
  mergedIntoEntityId: string | null
}

function assertRelationshipPerson(
  person: RelationshipPerson | undefined,
  entityId: string,
): asserts person is RelationshipPerson {
  if (!person) {
    throw new PeopleInputError(`Person "${entityId}" was not found.`)
  }

  if (person.status === "merged") {
    throw new PeopleInputError(
      `Person "${entityId}" was merged into "${person.mergedIntoEntityId}".`,
    )
  }
}

function assertEvidenceSupportsStatus(
  evidence: ReturnType<typeof prepareEvidence>[],
  status: AssertionStatus,
): void {
  if (status !== "accepted") {
    return
  }

  for (const [index, item] of evidence.entries()) {
    if (item.interpretation !== "explicit") {
      throw new PeopleInputError(
        `evidence[${index}].interpretation must be explicit for an accepted relationship.`,
      )
    }

    if (item.source.category === "context_only") {
      throw new PeopleInputError(
        `evidence[${index}].source.category context_only cannot establish an accepted relationship.`,
      )
    }
  }
}

async function insertStatusChange(
  transaction: RelationshipTransaction,
  relationshipId: string,
  fromStatus: AssertionStatus | null,
  toStatus: AssertionStatus,
  reason: string,
  runId: string,
): Promise<string> {
  const [change] = await transaction
    .insert(personRelationshipStatusChanges)
    .values({
      relationshipId,
      fromStatus,
      toStatus,
      reason,
      createdByRunId: runId,
    })
    .returning({ id: personRelationshipStatusChanges.id })

  if (!change) {
    throw new Error("Failed to record relationship status change.")
  }

  return change.id
}

async function replayRelationship(
  transaction: RelationshipTransaction,
  runId: string,
): Promise<AddPersonRelationshipResult> {
  const evidenceRows = await transaction
    .select({
      id: personRelationshipEvidence.id,
      relationshipId: personRelationshipEvidence.relationshipId,
      status: personRelationshipEvidence.status,
    })
    .from(personRelationshipEvidence)
    .where(eq(personRelationshipEvidence.createdByRunId, runId))
    .orderBy(asc(personRelationshipEvidence.id))

  const firstEvidence = evidenceRows[0]

  if (!firstEvidence) {
    throw new Error(`Relationship run "${runId}" has no evidence.`)
  }

  const [relationship] = await transaction
    .select({ createdByRunId: personRelationships.createdByRunId })
    .from(personRelationships)
    .where(eq(personRelationships.id, firstEvidence.relationshipId))
    .limit(1)
  const [statusChange] = await transaction
    .select({ id: personRelationshipStatusChanges.id })
    .from(personRelationshipStatusChanges)
    .where(eq(personRelationshipStatusChanges.createdByRunId, runId))
    .limit(1)

  return {
    runId,
    replayed: true,
    relationshipId: firstEvidence.relationshipId,
    created: relationship?.createdByRunId === runId,
    status: firstEvidence.status,
    evidenceIds: evidenceRows.map(({ id }) => id),
    statusChangeId: statusChange?.id ?? null,
  }
}
