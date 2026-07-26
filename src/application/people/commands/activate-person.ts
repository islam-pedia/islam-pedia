import { and, asc, eq } from "drizzle-orm"
import { getDatabase } from "@/db/client"
import {
  entities,
  entityEvidence,
  entityStatusChanges,
  ingestionRuns,
  people,
} from "@/db/schema"
import {
  getActivationPolicyViolations,
  SOURCE_POLICY_VERSION,
} from "@/domain/evidence/source-policy"
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
import type { ActivatePersonInput, ActivatePersonResult } from "../shared/types"

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
  const instruction =
    input.instruction === undefined
      ? undefined
      : requireCleanText(input.instruction, "instruction", 5_000)

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

    const sourceSummary = getEvidenceSourceSummary(preparedEvidence)
    const [run] = await transaction
      .insert(ingestionRuns)
      .values({
        idempotencyKey: operationKey,
        instruction,
        sourceLabel: sourceSummary.sourceLabel,
        sourceUri: sourceSummary.sourceUri,
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
      const { passageId } = await insertEvidenceSourcePassage(
        transaction,
        evidence,
        run.id,
      )

      const [evidenceRow] = await transaction
        .insert(entityEvidence)
        .values({
          entityId,
          passageId,
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
