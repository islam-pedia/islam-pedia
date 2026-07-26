import { and, eq } from "drizzle-orm"
import { getDatabase } from "@/db/client"
import { ingestionRuns, personNames } from "@/db/schema"
import {
  cleanDisplayText,
  SEARCH_NORMALIZATION_VERSION,
} from "@/domain/people/normalization"
import { getPerson } from "../queries/get-person"
import { PeopleInputError } from "../shared/errors"
import {
  assertMatchingIdempotentRequest,
  hashRequest,
  preparePersonNames,
  requireCleanText,
} from "../shared/helpers"
import type {
  AddPersonNamesInput,
  AddPersonNamesResult,
  PersonNameView,
} from "../shared/types"

export async function addPersonNames(
  input: AddPersonNamesInput,
): Promise<AddPersonNamesResult> {
  const operationKey = requireCleanText(input.operationKey, "operationKey")
  const entityId = requireCleanText(input.entityId, "entityId")

  if (input.names.length === 0) {
    throw new PeopleInputError("names must contain at least one person name.")
  }

  const existingPerson = await getPerson(entityId)

  if (!existingPerson) {
    throw new PeopleInputError(`Person "${entityId}" was not found.`)
  }

  if (existingPerson.status === "merged") {
    throw new PeopleInputError(
      `Person "${entityId}" was merged into "${existingPerson.mergedIntoEntityId}".`,
    )
  }

  const names = preparePersonNames(input.names)
  const instruction = input.instruction
    ? cleanDisplayText(input.instruction)
    : undefined
  const sourceLabel = input.source?.label
    ? cleanDisplayText(input.source.label)
    : undefined
  const sourceUri = input.source?.uri?.trim() || undefined
  const requestHash = hashRequest({
    operation: "add_person_names",
    entityId,
    instruction,
    sourceLabel,
    sourceUri,
    names: [...names].sort((left, right) =>
      [left.type, left.nameOriginalNormalized, left.nameLatinNormalized]
        .join("\u0000")
        .localeCompare(
          [
            right.type,
            right.nameOriginalNormalized,
            right.nameLatinNormalized,
          ].join("\u0000"),
        ),
    ),
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

      return {
        runId: existingRun.id,
        replayed: true,
        entityId,
        addedNames: await listNamesCreatedByRun(
          transaction,
          existingRun.id,
          entityId,
        ),
      }
    }

    const [run] = await transaction
      .insert(ingestionRuns)
      .values({
        idempotencyKey: operationKey,
        instruction,
        sourceLabel,
        sourceUri,
        metadata: {
          operation: "add_person_names",
          requestHash,
          entityId,
          itemCount: names.length,
        },
      })
      .returning({ id: ingestionRuns.id })

    if (!run) {
      throw new Error("Failed to create person-name ingestion run.")
    }

    const addedNames =
      names.length === 0
        ? []
        : await transaction
            .insert(personNames)
            .values(
              names.map((name) => ({
                entityId,
                type: name.type,
                nameOriginal: name.nameOriginal,
                nameOriginalNormalized: name.nameOriginalNormalized,
                nameLatin: name.nameLatin,
                nameLatinNormalized: name.nameLatinNormalized,
                isPrimary: false,
                normalizationVersion: SEARCH_NORMALIZATION_VERSION,
                createdByRunId: run.id,
              })),
            )
            .onConflictDoNothing()
            .returning({
              id: personNames.id,
              type: personNames.type,
              nameOriginal: personNames.nameOriginal,
              nameLatin: personNames.nameLatin,
              isPrimary: personNames.isPrimary,
            })

    return {
      runId: run.id,
      replayed: false,
      entityId,
      addedNames,
    }
  })
}

type PersonNameTransaction = Parameters<
  Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]
>[0]

async function listNamesCreatedByRun(
  transaction: PersonNameTransaction,
  runId: string,
  entityId: string,
): Promise<PersonNameView[]> {
  return transaction
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
        eq(personNames.createdByRunId, runId),
        eq(personNames.entityId, entityId),
      ),
    )
    .orderBy(personNames.type, personNames.nameLatin, personNames.id)
}
