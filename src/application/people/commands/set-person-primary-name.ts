import { and, eq } from "drizzle-orm"
import { getDatabase } from "@/db/client"
import {
  entities,
  ingestionRuns,
  people,
  personNames,
  personPrimaryNameChanges,
} from "@/db/schema"
import { primaryPersonNameTypes } from "@/domain/people/names"
import {
  cleanDisplayText,
  SEARCH_NORMALIZATION_VERSION,
} from "@/domain/people/normalization"
import { PeopleInputError } from "../shared/errors"
import {
  assertMatchingIdempotentRequest,
  hashRequest,
  preparePersonNames,
  requireCleanText,
} from "../shared/helpers"
import type {
  PersonNameView,
  SetPersonPrimaryNameInput,
  SetPersonPrimaryNameResult,
} from "../shared/types"

export async function setPersonPrimaryName(
  input: SetPersonPrimaryNameInput,
): Promise<SetPersonPrimaryNameResult> {
  const operationKey = requireCleanText(input.operationKey, "operationKey", 300)
  const entityId = requireCleanText(input.entityId, "entityId", 100)
  const reason = requireCleanText(input.reason, "reason", 5_000)

  if (!primaryPersonNameTypes.some((type) => type === input.name.type)) {
    throw new PeopleInputError(
      `Primary display names must use the person's original ism as type "personal" or an ism-based "nasab", not "${input.name.type}". Store kunyah, laqab, nisbah, and aliases as additional names.`,
    )
  }

  const [preparedName] = preparePersonNames([input.name])

  if (!preparedName) {
    throw new PeopleInputError("name must contain one person name.")
  }

  const instruction = input.instruction
    ? cleanDisplayText(input.instruction)
    : undefined
  const sourceLabel = input.source?.label
    ? cleanDisplayText(input.source.label)
    : undefined
  const sourceUri = input.source?.uri?.trim() || undefined
  const requestHash = hashRequest({
    operation: "set_person_primary_name",
    entityId,
    name: {
      type: preparedName.type,
      nameOriginal: preparedName.nameOriginal,
      nameOriginalNormalized: preparedName.nameOriginalNormalized,
      nameLatin: preparedName.nameLatin,
      nameLatinNormalized: preparedName.nameLatinNormalized,
    },
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

      return readStoredResult(existingRun.id, existingRun.metadata, true)
    }

    const [person] = await transaction
      .select({
        status: entities.status,
        mergedIntoEntityId: entities.mergedIntoEntityId,
        nameOriginal: people.nameOriginal,
        nameLatin: people.nameLatin,
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

    const [currentPrimaryName] = await transaction
      .select({
        id: personNames.id,
        type: personNames.type,
        nameOriginal: personNames.nameOriginal,
        nameLatin: personNames.nameLatin,
        isPrimary: personNames.isPrimary,
      })
      .from(personNames)
      .where(
        and(
          eq(personNames.entityId, entityId),
          eq(personNames.isPrimary, true),
        ),
      )
      .limit(1)

    if (!currentPrimaryName) {
      throw new Error(`Person "${entityId}" has no primary structured name.`)
    }

    const [matchingName] = await transaction
      .select({
        id: personNames.id,
        type: personNames.type,
        nameOriginal: personNames.nameOriginal,
        nameLatin: personNames.nameLatin,
        isPrimary: personNames.isPrimary,
      })
      .from(personNames)
      .where(
        and(
          eq(personNames.entityId, entityId),
          eq(personNames.type, preparedName.type),
          eq(
            personNames.nameOriginalNormalized,
            preparedName.nameOriginalNormalized,
          ),
          eq(personNames.nameLatinNormalized, preparedName.nameLatinNormalized),
        ),
      )
      .limit(1)

    const changed =
      currentPrimaryName.type !== preparedName.type ||
      currentPrimaryName.nameOriginal !== preparedName.nameOriginal ||
      currentPrimaryName.nameLatin !== preparedName.nameLatin ||
      person.nameOriginal !== preparedName.nameOriginal ||
      person.nameLatin !== preparedName.nameLatin

    const [run] = await transaction
      .insert(ingestionRuns)
      .values({
        idempotencyKey: operationKey,
        instruction,
        sourceLabel,
        sourceUri,
        metadata: {
          operation: "set_person_primary_name",
          requestHash,
          entityId,
        },
      })
      .returning({ id: ingestionRuns.id })

    if (!run) {
      throw new Error("Failed to create primary-name ingestion run.")
    }

    let primaryName: PersonNameView = currentPrimaryName
    let primaryNameChangeId: string | null = null

    if (changed) {
      if (!matchingName || matchingName.id !== currentPrimaryName.id) {
        await transaction
          .update(personNames)
          .set({ isPrimary: false })
          .where(eq(personNames.id, currentPrimaryName.id))
      }

      if (matchingName) {
        const [updatedName] = await transaction
          .update(personNames)
          .set({
            nameOriginal: preparedName.nameOriginal,
            nameOriginalNormalized: preparedName.nameOriginalNormalized,
            nameLatin: preparedName.nameLatin,
            nameLatinNormalized: preparedName.nameLatinNormalized,
            isPrimary: true,
            normalizationVersion: SEARCH_NORMALIZATION_VERSION,
          })
          .where(eq(personNames.id, matchingName.id))
          .returning({
            id: personNames.id,
            type: personNames.type,
            nameOriginal: personNames.nameOriginal,
            nameLatin: personNames.nameLatin,
            isPrimary: personNames.isPrimary,
          })

        if (!updatedName) {
          throw new Error("Failed to promote the existing structured name.")
        }

        primaryName = updatedName
      } else {
        const [insertedName] = await transaction
          .insert(personNames)
          .values({
            entityId,
            type: preparedName.type,
            nameOriginal: preparedName.nameOriginal,
            nameOriginalNormalized: preparedName.nameOriginalNormalized,
            nameLatin: preparedName.nameLatin,
            nameLatinNormalized: preparedName.nameLatinNormalized,
            isPrimary: true,
            normalizationVersion: SEARCH_NORMALIZATION_VERSION,
            createdByRunId: run.id,
          })
          .returning({
            id: personNames.id,
            type: personNames.type,
            nameOriginal: personNames.nameOriginal,
            nameLatin: personNames.nameLatin,
            isPrimary: personNames.isPrimary,
          })

        if (!insertedName) {
          throw new Error("Failed to create the new primary structured name.")
        }

        primaryName = insertedName
      }

      await transaction
        .update(people)
        .set({
          nameOriginal: preparedName.nameOriginal,
          nameOriginalNormalized: preparedName.nameOriginalNormalized,
          nameLatin: preparedName.nameLatin,
          nameLatinNormalized: preparedName.nameLatinNormalized,
          normalizationVersion: SEARCH_NORMALIZATION_VERSION,
        })
        .where(eq(people.entityId, entityId))

      await transaction
        .update(entities)
        .set({ updatedAt: new Date() })
        .where(eq(entities.id, entityId))

      const [change] = await transaction
        .insert(personPrimaryNameChanges)
        .values({
          entityId,
          fromNameId: currentPrimaryName.id,
          toNameId: primaryName.id,
          fromType: currentPrimaryName.type,
          fromNameOriginal: currentPrimaryName.nameOriginal,
          fromNameLatin: currentPrimaryName.nameLatin,
          toType: primaryName.type,
          toNameOriginal: primaryName.nameOriginal,
          toNameLatin: primaryName.nameLatin,
          reason,
          createdByRunId: run.id,
        })
        .returning({ id: personPrimaryNameChanges.id })

      if (!change) {
        throw new Error("Failed to record the primary-name change.")
      }

      primaryNameChangeId = change.id
    }

    const result: SetPersonPrimaryNameResult = {
      runId: run.id,
      replayed: false,
      entityId,
      previousPrimaryName: currentPrimaryName,
      primaryName,
      changed,
      primaryNameChangeId,
    }

    await transaction
      .update(ingestionRuns)
      .set({
        metadata: {
          operation: "set_person_primary_name",
          requestHash,
          entityId,
          result,
        },
      })
      .where(eq(ingestionRuns.id, run.id))

    return result
  })
}

function readStoredResult(
  runId: string,
  metadata: Record<string, unknown>,
  replayed: boolean,
): SetPersonPrimaryNameResult {
  const result = metadata.result

  if (!isStoredResult(result)) {
    throw new Error(`Primary-name run "${runId}" has invalid result metadata.`)
  }

  return {
    ...result,
    runId,
    replayed,
  }
}

function isStoredResult(value: unknown): value is SetPersonPrimaryNameResult {
  if (!value || typeof value !== "object") {
    return false
  }

  const result = value as Partial<SetPersonPrimaryNameResult>

  return (
    typeof result.entityId === "string" &&
    typeof result.changed === "boolean" &&
    (typeof result.primaryNameChangeId === "string" ||
      result.primaryNameChangeId === null) &&
    isPersonNameView(result.previousPrimaryName) &&
    isPersonNameView(result.primaryName)
  )
}

function isPersonNameView(value: unknown): value is PersonNameView {
  if (!value || typeof value !== "object") {
    return false
  }

  const name = value as Partial<PersonNameView>

  return (
    typeof name.id === "string" &&
    typeof name.type === "string" &&
    typeof name.nameOriginal === "string" &&
    typeof name.nameLatin === "string" &&
    typeof name.isPrimary === "boolean"
  )
}
