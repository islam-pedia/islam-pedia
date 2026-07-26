import { eq, inArray, or } from "drizzle-orm"
import { getDatabase } from "@/db/client"
import {
  entities,
  entitySearchTerms,
  entityStatusChanges,
  ingestionRuns,
  people,
  personNames,
} from "@/db/schema"
import {
  cleanDisplayText,
  SEARCH_NORMALIZATION_VERSION,
} from "@/domain/people/normalization"
import { listPeopleCreatedByRun } from "../queries/list-people-created-by-run"
import { PeopleInputError } from "../shared/errors"
import {
  assertMatchingIdempotentRequest,
  hashRequest,
  preparePerson,
  requireCleanText,
  toPersonView,
} from "../shared/helpers"
import type {
  ImportedPersonView,
  ImportPeopleInput,
  ImportPeopleResult,
} from "../shared/types"

export async function importPeople(
  input: ImportPeopleInput,
): Promise<ImportPeopleResult> {
  const batchKey = requireCleanText(input.batchKey, "batchKey")

  if (input.people.length === 0) {
    throw new PeopleInputError("people must contain at least one person.")
  }

  const preparedPeople = input.people.map(preparePerson)
  const instruction = input.instruction
    ? cleanDisplayText(input.instruction)
    : undefined
  const sourceLabel = input.source?.label
    ? cleanDisplayText(input.source.label)
    : undefined
  const sourceUri = input.source?.uri?.trim() || undefined
  const requestHash = hashRequest({
    operation: "import_people",
    instruction,
    sourceLabel,
    sourceUri,
    people: preparedPeople.map((person) => ({
      ...person,
      names: [...person.names].sort((left, right) =>
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
      keywords: [...person.keywords].sort((left, right) =>
        left.normalizedTerm.localeCompare(right.normalizedTerm),
      ),
    })),
  })

  const database = getDatabase()
  const transactionResult = await database.transaction(async (transaction) => {
    const [existingRun] = await transaction
      .select()
      .from(ingestionRuns)
      .where(eq(ingestionRuns.idempotencyKey, batchKey))
      .limit(1)

    if (existingRun) {
      assertMatchingIdempotentRequest(
        existingRun.metadata,
        requestHash,
        batchKey,
      )

      return {
        runId: existingRun.id,
        replayed: true as const,
        people: [] as ImportedPersonView[],
      }
    }

    const [run] = await transaction
      .insert(ingestionRuns)
      .values({
        idempotencyKey: batchKey,
        instruction,
        sourceLabel,
        sourceUri,
        metadata: {
          operation: "import_people",
          requestHash,
          itemCount: preparedPeople.length,
        },
      })
      .returning({ id: ingestionRuns.id })

    if (!run) {
      throw new Error("Failed to create ingestion run.")
    }

    const importedPeople: ImportedPersonView[] = []

    for (const person of preparedPeople) {
      const candidateTerms = [
        ...person.names.flatMap((name) => [
          name.nameOriginalNormalized,
          name.nameLatinNormalized,
        ]),
        ...person.keywords.map(({ normalizedTerm }) => normalizedTerm),
      ]

      const candidateRows = await transaction
        .selectDistinct({ entityId: people.entityId })
        .from(people)
        .leftJoin(personNames, eq(personNames.entityId, people.entityId))
        .leftJoin(
          entitySearchTerms,
          eq(entitySearchTerms.entityId, people.entityId),
        )
        .where(
          or(
            eq(people.nameOriginalNormalized, person.nameOriginalNormalized),
            eq(people.nameLatinNormalized, person.nameLatinNormalized),
            inArray(personNames.nameOriginalNormalized, candidateTerms),
            inArray(personNames.nameLatinNormalized, candidateTerms),
            inArray(entitySearchTerms.normalizedTerm, candidateTerms),
          ),
        )
        .limit(20)

      const [entity] = await transaction
        .insert(entities)
        .values({
          kind: "person",
          status: "provisional",
          createdByRunId: run.id,
        })
        .returning({
          id: entities.id,
          status: entities.status,
          mergedIntoEntityId: entities.mergedIntoEntityId,
          createdAt: entities.createdAt,
        })

      if (!entity) {
        throw new Error("Failed to create person entity.")
      }

      await transaction.insert(entityStatusChanges).values({
        entityId: entity.id,
        fromStatus: null,
        toStatus: "provisional",
        reason: "Entity created pending identity verification.",
        createdByRunId: run.id,
      })

      await transaction.insert(people).values({
        entityId: entity.id,
        nameOriginal: person.nameOriginal,
        nameOriginalNormalized: person.nameOriginalNormalized,
        nameLatin: person.nameLatin,
        nameLatinNormalized: person.nameLatinNormalized,
        normalizationVersion: SEARCH_NORMALIZATION_VERSION,
      })

      const insertedNames = await transaction
        .insert(personNames)
        .values(
          person.names.map((name) => ({
            entityId: entity.id,
            type: name.type,
            nameOriginal: name.nameOriginal,
            nameOriginalNormalized: name.nameOriginalNormalized,
            nameLatin: name.nameLatin,
            nameLatinNormalized: name.nameLatinNormalized,
            isPrimary: name.isPrimary,
            normalizationVersion: SEARCH_NORMALIZATION_VERSION,
            createdByRunId: run.id,
          })),
        )
        .returning({
          id: personNames.id,
          type: personNames.type,
          nameOriginal: personNames.nameOriginal,
          nameLatin: personNames.nameLatin,
          isPrimary: personNames.isPrimary,
        })

      if (person.keywords.length > 0) {
        await transaction.insert(entitySearchTerms).values(
          person.keywords.map((keyword) => ({
            entityId: entity.id,
            term: keyword.term,
            normalizedTerm: keyword.normalizedTerm,
            normalizationVersion: SEARCH_NORMALIZATION_VERSION,
            createdByRunId: run.id,
          })),
        )
      }

      importedPeople.push(
        toPersonView(
          {
            entityId: entity.id,
            status: entity.status,
            mergedIntoEntityId: entity.mergedIntoEntityId,
            nameOriginal: person.nameOriginal,
            nameLatin: person.nameLatin,
            names: insertedNames,
            keywords: person.keywords.map(({ term }) => term),
            createdAt: entity.createdAt,
          },
          candidateRows.map(({ entityId }) => entityId),
        ),
      )
    }

    return {
      runId: run.id,
      replayed: false as const,
      people: importedPeople,
    }
  })

  if (!transactionResult.replayed) {
    return transactionResult
  }

  return {
    runId: transactionResult.runId,
    replayed: true,
    people: await listPeopleCreatedByRun(transactionResult.runId),
  }
}
