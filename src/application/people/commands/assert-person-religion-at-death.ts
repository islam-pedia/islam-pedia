import { and, asc, eq, ne } from "drizzle-orm"
import { getDatabase } from "@/db/client"
import {
  entities,
  ingestionRuns,
  people,
  personReligionAtDeathAssertions,
  personReligionAtDeathEvidence,
  personReligionAtDeathStatusChanges,
} from "@/db/schema"
import { SOURCE_POLICY_VERSION } from "@/domain/evidence/source-policy"
import { personReligionsAtDeath } from "@/domain/people/assertions"
import { PeopleInputError } from "../shared/errors"
import {
  assertEvidenceSupportsAcceptedStatus,
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
  AssertionStatus,
  AssertPersonReligionAtDeathInput,
  AssertPersonReligionAtDeathResult,
} from "../shared/types"

const assertionStatuses = [
  "accepted",
  "uncertain",
  "disputed",
  "retracted",
] as const

export async function assertPersonReligionAtDeath(
  input: AssertPersonReligionAtDeathInput,
): Promise<AssertPersonReligionAtDeathResult> {
  const operationKey = requireCleanText(input.operationKey, "operationKey", 300)
  const personId = requireCleanText(input.personId, "personId", 100)
  const reason = requireCleanText(input.reason, "reason", 5_000)
  const instruction =
    input.instruction === undefined
      ? undefined
      : requireCleanText(input.instruction, "instruction", 5_000)

  if (!personReligionsAtDeath.includes(input.value)) {
    throw new PeopleInputError(
      `Unsupported religion-at-death value "${input.value}".`,
    )
  }

  if (!assertionStatuses.includes(input.status)) {
    throw new PeopleInputError(
      `Unsupported assertion status "${input.status}".`,
    )
  }

  if (input.evidence.length === 0 || input.evidence.length > 20) {
    throw new PeopleInputError(
      "evidence must contain between 1 and 20 source passages.",
    )
  }

  const preparedEvidence = input.evidence.map(prepareEvidence)
  assertEvidenceSupportsAcceptedStatus(
    preparedEvidence,
    input.status,
    "religion-at-death assertion",
  )

  const requestHash = hashRequest({
    operation: "assert_person_religion_at_death",
    sourcePolicyVersion: SOURCE_POLICY_VERSION,
    personId,
    value: input.value,
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
      return replayReligionAtDeathAssertion(transaction, existingRun.id)
    }

    const [person] = await transaction
      .select({
        entityId: people.entityId,
        status: entities.status,
        mergedIntoEntityId: entities.mergedIntoEntityId,
      })
      .from(people)
      .innerJoin(entities, eq(entities.id, people.entityId))
      .where(eq(people.entityId, personId))
      .limit(1)

    if (!person) {
      throw new PeopleInputError(`Person "${personId}" was not found.`)
    }

    if (person.status === "merged") {
      throw new PeopleInputError(
        `Person "${personId}" was merged into "${person.mergedIntoEntityId}".`,
      )
    }

    if (input.status === "accepted") {
      const [conflictingAccepted] = await transaction
        .select({
          id: personReligionAtDeathAssertions.id,
          value: personReligionAtDeathAssertions.value,
        })
        .from(personReligionAtDeathAssertions)
        .where(
          and(
            eq(personReligionAtDeathAssertions.personId, personId),
            eq(personReligionAtDeathAssertions.status, "accepted"),
            ne(personReligionAtDeathAssertions.value, input.value),
          ),
        )
        .limit(1)

      if (conflictingAccepted) {
        throw new PeopleInputError(
          `Person "${personId}" already has accepted religion-at-death value "${conflictingAccepted.value}". Mark that assertion disputed or retracted before accepting "${input.value}".`,
        )
      }
    }

    const [existingAssertion] = await transaction
      .select()
      .from(personReligionAtDeathAssertions)
      .where(
        and(
          eq(personReligionAtDeathAssertions.personId, personId),
          eq(personReligionAtDeathAssertions.value, input.value),
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
          operation: "assert_person_religion_at_death",
          requestHash,
          personId,
          value: input.value,
          status: input.status,
          evidenceCount: preparedEvidence.length,
          sourcePolicyVersion: SOURCE_POLICY_VERSION,
        },
      })
      .returning({ id: ingestionRuns.id })

    if (!run) {
      throw new Error("Failed to create religion-at-death ingestion run.")
    }

    let assertionId: string
    let created = false
    let statusChangeId: string | null = null

    if (existingAssertion) {
      assertionId = existingAssertion.id

      if (existingAssertion.status !== input.status) {
        await transaction
          .update(personReligionAtDeathAssertions)
          .set({ status: input.status, updatedAt: new Date() })
          .where(eq(personReligionAtDeathAssertions.id, assertionId))
        statusChangeId = await insertStatusChange(
          transaction,
          assertionId,
          existingAssertion.status,
          input.status,
          reason,
          run.id,
        )
      }
    } else {
      const [assertion] = await transaction
        .insert(personReligionAtDeathAssertions)
        .values({
          personId,
          value: input.value,
          status: input.status,
          createdByRunId: run.id,
        })
        .returning({ id: personReligionAtDeathAssertions.id })

      if (!assertion) {
        throw new Error("Failed to create religion-at-death assertion.")
      }

      assertionId = assertion.id
      created = true
      statusChangeId = await insertStatusChange(
        transaction,
        assertionId,
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
        .insert(personReligionAtDeathEvidence)
        .values({
          assertionId,
          passageId,
          assertion: evidence.assertion,
          interpretation: evidence.interpretation,
          status: input.status,
          notes: evidence.notes,
          createdByRunId: run.id,
        })
        .returning({ id: personReligionAtDeathEvidence.id })

      if (!evidenceRow) {
        throw new Error("Failed to attach religion-at-death evidence.")
      }
      evidenceIds.push(evidenceRow.id)
    }

    return {
      runId: run.id,
      replayed: false,
      assertionId,
      created,
      value: input.value,
      status: input.status,
      evidenceIds,
      statusChangeId,
    }
  })
}

type AssertionTransaction = Parameters<
  Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]
>[0]

async function insertStatusChange(
  transaction: AssertionTransaction,
  assertionId: string,
  fromStatus: AssertionStatus | null,
  toStatus: AssertionStatus,
  reason: string,
  runId: string,
): Promise<string> {
  const [change] = await transaction
    .insert(personReligionAtDeathStatusChanges)
    .values({
      assertionId,
      fromStatus,
      toStatus,
      reason,
      createdByRunId: runId,
    })
    .returning({ id: personReligionAtDeathStatusChanges.id })

  if (!change) {
    throw new Error("Failed to record religion-at-death status change.")
  }
  return change.id
}

async function replayReligionAtDeathAssertion(
  transaction: AssertionTransaction,
  runId: string,
): Promise<AssertPersonReligionAtDeathResult> {
  const evidenceRows = await transaction
    .select({
      id: personReligionAtDeathEvidence.id,
      assertionId: personReligionAtDeathEvidence.assertionId,
      status: personReligionAtDeathEvidence.status,
    })
    .from(personReligionAtDeathEvidence)
    .where(eq(personReligionAtDeathEvidence.createdByRunId, runId))
    .orderBy(asc(personReligionAtDeathEvidence.id))
  const firstEvidence = evidenceRows[0]

  if (!firstEvidence) {
    throw new Error(`Religion-at-death run "${runId}" has no evidence.`)
  }

  const [assertion] = await transaction
    .select({
      createdByRunId: personReligionAtDeathAssertions.createdByRunId,
      value: personReligionAtDeathAssertions.value,
    })
    .from(personReligionAtDeathAssertions)
    .where(eq(personReligionAtDeathAssertions.id, firstEvidence.assertionId))
    .limit(1)
  const [statusChange] = await transaction
    .select({ id: personReligionAtDeathStatusChanges.id })
    .from(personReligionAtDeathStatusChanges)
    .where(eq(personReligionAtDeathStatusChanges.createdByRunId, runId))
    .limit(1)

  if (!assertion) {
    throw new Error(
      `Religion-at-death assertion was not found for run "${runId}".`,
    )
  }

  return {
    runId,
    replayed: true,
    assertionId: firstEvidence.assertionId,
    created: assertion.createdByRunId === runId,
    value: assertion.value,
    status: firstEvidence.status,
    evidenceIds: evidenceRows.map(({ id }) => id),
    statusChangeId: statusChange?.id ?? null,
  }
}
