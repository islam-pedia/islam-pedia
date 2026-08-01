import { and, asc, eq, inArray, ne } from "drizzle-orm"
import { getDatabase } from "@/db/client"
import {
  entities,
  ingestionRuns,
  people,
  personEncounterAssertions,
  personEncounterEvidence,
  personEncounterStatusChanges,
} from "@/db/schema"
import { SOURCE_POLICY_VERSION } from "@/domain/evidence/source-policy"
import { personEncounterOutcomes } from "@/domain/people/assertions"
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
  AssertPersonEncounterInput,
  AssertPersonEncounterResult,
} from "../shared/types"

const assertionStatuses = [
  "accepted",
  "uncertain",
  "disputed",
  "retracted",
] as const

export async function assertPersonEncounter(
  input: AssertPersonEncounterInput,
): Promise<AssertPersonEncounterResult> {
  const operationKey = requireCleanText(input.operationKey, "operationKey", 300)
  const requestedFirstPersonId = requireCleanText(
    input.firstPersonId,
    "firstPersonId",
    100,
  )
  const requestedSecondPersonId = requireCleanText(
    input.secondPersonId,
    "secondPersonId",
    100,
  )
  const reason = requireCleanText(input.reason, "reason", 5_000)
  const instruction =
    input.instruction === undefined
      ? undefined
      : requireCleanText(input.instruction, "instruction", 5_000)

  if (requestedFirstPersonId === requestedSecondPersonId) {
    throw new PeopleInputError(
      "A person encounter requires two different people.",
    )
  }

  if (!personEncounterOutcomes.includes(input.outcome)) {
    throw new PeopleInputError(
      `Unsupported person encounter outcome "${input.outcome}".`,
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

  const [firstPersonId, secondPersonId] = canonicalizePersonPair(
    requestedFirstPersonId,
    requestedSecondPersonId,
  )
  const preparedEvidence = input.evidence.map(prepareEvidence)
  assertEvidenceSupportsAcceptedStatus(
    preparedEvidence,
    input.status,
    "person encounter assertion",
  )

  const requestHash = hashRequest({
    operation: "assert_person_encounter",
    sourcePolicyVersion: SOURCE_POLICY_VERSION,
    firstPersonId,
    secondPersonId,
    outcome: input.outcome,
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
      return replayEncounterAssertion(transaction, existingRun.id)
    }

    const personRows = await transaction
      .select({
        entityId: people.entityId,
        status: entities.status,
        mergedIntoEntityId: entities.mergedIntoEntityId,
      })
      .from(people)
      .innerJoin(entities, eq(entities.id, people.entityId))
      .where(inArray(people.entityId, [firstPersonId, secondPersonId]))
    const peopleById = new Map(
      personRows.map((person) => [person.entityId, person]),
    )

    for (const personId of [firstPersonId, secondPersonId]) {
      const person = peopleById.get(personId)

      if (!person) {
        throw new PeopleInputError(`Person "${personId}" was not found.`)
      }

      if (person.status === "merged") {
        throw new PeopleInputError(
          `Person "${personId}" was merged into "${person.mergedIntoEntityId}".`,
        )
      }
    }

    if (input.status === "accepted") {
      const [conflictingAccepted] = await transaction
        .select({
          id: personEncounterAssertions.id,
          outcome: personEncounterAssertions.outcome,
        })
        .from(personEncounterAssertions)
        .where(
          and(
            eq(personEncounterAssertions.firstPersonId, firstPersonId),
            eq(personEncounterAssertions.secondPersonId, secondPersonId),
            eq(personEncounterAssertions.status, "accepted"),
            ne(personEncounterAssertions.outcome, input.outcome),
          ),
        )
        .limit(1)

      if (conflictingAccepted) {
        throw new PeopleInputError(
          `This person pair already has accepted encounter outcome "${conflictingAccepted.outcome}". Mark that assertion disputed or retracted before accepting "${input.outcome}".`,
        )
      }
    }

    const [existingAssertion] = await transaction
      .select()
      .from(personEncounterAssertions)
      .where(
        and(
          eq(personEncounterAssertions.firstPersonId, firstPersonId),
          eq(personEncounterAssertions.secondPersonId, secondPersonId),
          eq(personEncounterAssertions.outcome, input.outcome),
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
          operation: "assert_person_encounter",
          requestHash,
          requestedFirstPersonId,
          requestedSecondPersonId,
          firstPersonId,
          secondPersonId,
          outcome: input.outcome,
          status: input.status,
          evidenceCount: preparedEvidence.length,
          sourcePolicyVersion: SOURCE_POLICY_VERSION,
        },
      })
      .returning({ id: ingestionRuns.id })

    if (!run) {
      throw new Error("Failed to create person-encounter ingestion run.")
    }

    let assertionId: string
    let created = false
    let statusChangeId: string | null = null

    if (existingAssertion) {
      assertionId = existingAssertion.id

      if (existingAssertion.status !== input.status) {
        await transaction
          .update(personEncounterAssertions)
          .set({ status: input.status, updatedAt: new Date() })
          .where(eq(personEncounterAssertions.id, assertionId))
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
        .insert(personEncounterAssertions)
        .values({
          firstPersonId,
          secondPersonId,
          outcome: input.outcome,
          status: input.status,
          createdByRunId: run.id,
        })
        .returning({ id: personEncounterAssertions.id })

      if (!assertion) {
        throw new Error("Failed to create person encounter assertion.")
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
        .insert(personEncounterEvidence)
        .values({
          assertionId,
          passageId,
          assertion: evidence.assertion,
          interpretation: evidence.interpretation,
          status: input.status,
          notes: evidence.notes,
          createdByRunId: run.id,
        })
        .returning({ id: personEncounterEvidence.id })

      if (!evidenceRow) {
        throw new Error("Failed to attach person encounter evidence.")
      }
      evidenceIds.push(evidenceRow.id)
    }

    return {
      runId: run.id,
      replayed: false,
      assertionId,
      created,
      firstPersonId,
      secondPersonId,
      outcome: input.outcome,
      status: input.status,
      evidenceIds,
      statusChangeId,
    }
  })
}

export function canonicalizePersonPair(
  firstPersonId: string,
  secondPersonId: string,
): [string, string] {
  return firstPersonId < secondPersonId
    ? [firstPersonId, secondPersonId]
    : [secondPersonId, firstPersonId]
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
    .insert(personEncounterStatusChanges)
    .values({
      assertionId,
      fromStatus,
      toStatus,
      reason,
      createdByRunId: runId,
    })
    .returning({ id: personEncounterStatusChanges.id })

  if (!change) {
    throw new Error("Failed to record person encounter status change.")
  }
  return change.id
}

async function replayEncounterAssertion(
  transaction: AssertionTransaction,
  runId: string,
): Promise<AssertPersonEncounterResult> {
  const evidenceRows = await transaction
    .select({
      id: personEncounterEvidence.id,
      assertionId: personEncounterEvidence.assertionId,
      status: personEncounterEvidence.status,
    })
    .from(personEncounterEvidence)
    .where(eq(personEncounterEvidence.createdByRunId, runId))
    .orderBy(asc(personEncounterEvidence.id))
  const firstEvidence = evidenceRows[0]

  if (!firstEvidence) {
    throw new Error(`Person encounter run "${runId}" has no evidence.`)
  }

  const [assertion] = await transaction
    .select({
      createdByRunId: personEncounterAssertions.createdByRunId,
      firstPersonId: personEncounterAssertions.firstPersonId,
      secondPersonId: personEncounterAssertions.secondPersonId,
      outcome: personEncounterAssertions.outcome,
    })
    .from(personEncounterAssertions)
    .where(eq(personEncounterAssertions.id, firstEvidence.assertionId))
    .limit(1)
  const [statusChange] = await transaction
    .select({ id: personEncounterStatusChanges.id })
    .from(personEncounterStatusChanges)
    .where(eq(personEncounterStatusChanges.createdByRunId, runId))
    .limit(1)

  if (!assertion) {
    throw new Error(
      `Person encounter assertion was not found for run "${runId}".`,
    )
  }

  return {
    runId,
    replayed: true,
    assertionId: firstEvidence.assertionId,
    created: assertion.createdByRunId === runId,
    firstPersonId: assertion.firstPersonId,
    secondPersonId: assertion.secondPersonId,
    outcome: assertion.outcome,
    status: firstEvidence.status,
    evidenceIds: evidenceRows.map(({ id }) => id),
    statusChangeId: statusChange?.id ?? null,
  }
}
