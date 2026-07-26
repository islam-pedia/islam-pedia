import { and, eq, or } from "drizzle-orm"
import { getDatabase } from "@/db/client"
import {
  entities,
  ingestionRuns,
  people,
  personGenderChanges,
  personRelationships,
} from "@/db/schema"
import { cleanDisplayText } from "@/domain/people/normalization"
import { personGenders } from "@/domain/people/relationships"
import { PeopleInputError } from "../shared/errors"
import {
  assertMatchingIdempotentRequest,
  hashRequest,
  requireCleanText,
} from "../shared/helpers"
import type {
  PersonGender,
  SetPersonGenderInput,
  SetPersonGenderResult,
} from "../shared/types"

export async function setPersonGender(
  input: SetPersonGenderInput,
): Promise<SetPersonGenderResult> {
  const operationKey = requireCleanText(input.operationKey, "operationKey", 300)
  const entityId = requireCleanText(input.entityId, "entityId", 100)
  const reason = requireCleanText(input.reason, "reason", 5_000)

  if (!personGenders.includes(input.gender)) {
    throw new PeopleInputError(`Unsupported person gender "${input.gender}".`)
  }

  const instruction = input.instruction
    ? cleanDisplayText(input.instruction)
    : undefined
  const sourceLabel = input.source?.label
    ? cleanDisplayText(input.source.label)
    : undefined
  const sourceUri = input.source?.uri?.trim() || undefined
  const requestHash = hashRequest({
    operation: "set_person_gender",
    entityId,
    gender: input.gender,
    reason,
    instruction,
    sourceLabel,
    sourceUri,
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

      return replayGenderChange(
        transaction,
        existingRun.id,
        entityId,
        existingRun.metadata,
      )
    }

    const [person] = await transaction
      .select({
        gender: people.gender,
        status: entities.status,
        mergedIntoEntityId: entities.mergedIntoEntityId,
      })
      .from(people)
      .innerJoin(entities, eq(entities.id, people.entityId))
      .where(eq(people.entityId, entityId))
      .limit(1)

    if (!person) {
      throw new PeopleInputError(`Person "${entityId}" was not found.`)
    }

    if (person.status === "merged") {
      throw new PeopleInputError(
        `Person "${entityId}" was merged into "${person.mergedIntoEntityId}".`,
      )
    }

    await assertGenderCompatibleWithRelationships(
      transaction,
      entityId,
      input.gender,
    )

    const changed = person.gender !== input.gender
    const [run] = await transaction
      .insert(ingestionRuns)
      .values({
        idempotencyKey: operationKey,
        instruction,
        sourceLabel,
        sourceUri,
        metadata: {
          operation: "set_person_gender",
          requestHash,
          entityId,
          previousGender: person.gender,
          gender: input.gender,
          changed,
        },
      })
      .returning({ id: ingestionRuns.id })

    if (!run) {
      throw new Error("Failed to create gender ingestion run.")
    }

    let genderChangeId: string | null = null

    if (changed) {
      await transaction
        .update(people)
        .set({ gender: input.gender })
        .where(eq(people.entityId, entityId))

      await transaction
        .update(entities)
        .set({ updatedAt: new Date() })
        .where(eq(entities.id, entityId))

      const [change] = await transaction
        .insert(personGenderChanges)
        .values({
          entityId,
          fromGender: person.gender,
          toGender: input.gender,
          reason,
          createdByRunId: run.id,
        })
        .returning({ id: personGenderChanges.id })

      if (!change) {
        throw new Error("Failed to record person gender change.")
      }

      genderChangeId = change.id
    }

    return {
      runId: run.id,
      replayed: false,
      entityId,
      previousGender: person.gender,
      gender: input.gender,
      changed,
      genderChangeId,
    }
  })
}

type GenderTransaction = Parameters<
  Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]
>[0]

async function assertGenderCompatibleWithRelationships(
  transaction: GenderTransaction,
  entityId: string,
  gender: PersonGender,
): Promise<void> {
  const incompatibleCondition =
    gender === "male"
      ? eq(personRelationships.toPersonId, entityId)
      : gender === "female"
        ? eq(personRelationships.fromPersonId, entityId)
        : or(
            eq(personRelationships.fromPersonId, entityId),
            eq(personRelationships.toPersonId, entityId),
          )

  const [relationship] = await transaction
    .select({ id: personRelationships.id })
    .from(personRelationships)
    .where(
      and(eq(personRelationships.type, "husband_of"), incompatibleCondition),
    )
    .limit(1)

  if (relationship) {
    throw new PeopleInputError(
      `Gender "${gender}" conflicts with existing husband_of relationship "${relationship.id}".`,
    )
  }
}

async function replayGenderChange(
  transaction: GenderTransaction,
  runId: string,
  entityId: string,
  metadata: Record<string, unknown>,
): Promise<SetPersonGenderResult> {
  const previousGender = readGenderMetadata(metadata, "previousGender")
  const gender = readGenderMetadata(metadata, "gender")
  const changed = metadata.changed === true
  const [change] = await transaction
    .select({ id: personGenderChanges.id })
    .from(personGenderChanges)
    .where(
      and(
        eq(personGenderChanges.createdByRunId, runId),
        eq(personGenderChanges.entityId, entityId),
      ),
    )
    .limit(1)

  return {
    runId,
    replayed: true,
    entityId,
    previousGender,
    gender,
    changed,
    genderChangeId: change?.id ?? null,
  }
}

function readGenderMetadata(
  metadata: Record<string, unknown>,
  key: "previousGender" | "gender",
): PersonGender {
  const value = metadata[key]

  if (
    typeof value !== "string" ||
    !personGenders.some((gender) => gender === value)
  ) {
    throw new Error(`Gender run metadata is missing "${key}".`)
  }

  return value as PersonGender
}
