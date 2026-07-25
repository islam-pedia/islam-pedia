import { and, eq } from "drizzle-orm"
import { getDatabase } from "@/db/client"
import { entitySearchTerms, ingestionRuns } from "@/db/schema"
import {
  cleanDisplayText,
  normalizeSearchText,
  prepareSearchTerms,
  SEARCH_NORMALIZATION_VERSION,
} from "@/domain/people/normalization"
import { getPerson } from "../queries/get-person"
import { PeopleInputError } from "../shared/errors"
import {
  assertMatchingIdempotentRequest,
  hashRequest,
  requireCleanText,
} from "../shared/helpers"
import type {
  AddPersonKeywordsInput,
  AddPersonKeywordsResult,
} from "../shared/types"

export async function addPersonKeywords(
  input: AddPersonKeywordsInput,
): Promise<AddPersonKeywordsResult> {
  const operationKey = requireCleanText(input.operationKey, "operationKey")
  const entityId = requireCleanText(input.entityId, "entityId")
  const instruction = input.instruction
    ? cleanDisplayText(input.instruction)
    : undefined
  const sourceLabel = input.source?.label
    ? cleanDisplayText(input.source.label)
    : undefined
  const sourceUri = input.source?.uri?.trim() || undefined
  const existingPerson = await getPerson(entityId)

  if (!existingPerson) {
    throw new PeopleInputError(`Person "${entityId}" was not found.`)
  }

  if (existingPerson.status === "merged") {
    throw new PeopleInputError(
      `Person "${entityId}" was merged into "${existingPerson.mergedIntoEntityId}".`,
    )
  }

  const keywords = prepareSearchTerms(
    input.keywords,
    new Set([
      normalizeSearchText(existingPerson.nameOriginal),
      normalizeSearchText(existingPerson.nameLatin),
      ...existingPerson.keywords.map(normalizeSearchText),
    ]),
  )
  const requestHash = hashRequest({
    operation: "add_person_keywords",
    entityId,
    instruction,
    sourceLabel,
    sourceUri,
    keywords: [...keywords].sort((left, right) =>
      left.normalizedTerm.localeCompare(right.normalizedTerm),
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

      const existingKeywords = await transaction
        .select({ term: entitySearchTerms.term })
        .from(entitySearchTerms)
        .where(
          and(
            eq(entitySearchTerms.entityId, entityId),
            eq(entitySearchTerms.createdByRunId, existingRun.id),
          ),
        )

      return {
        runId: existingRun.id,
        replayed: true,
        entityId,
        addedKeywords: existingKeywords.map(({ term }) => term),
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
          operation: "add_person_keywords",
          requestHash,
          entityId,
          itemCount: keywords.length,
        },
      })
      .returning({ id: ingestionRuns.id })

    if (!run) {
      throw new Error("Failed to create keyword ingestion run.")
    }

    if (keywords.length === 0) {
      return {
        runId: run.id,
        replayed: false,
        entityId,
        addedKeywords: [],
      }
    }

    const addedKeywords = await transaction
      .insert(entitySearchTerms)
      .values(
        keywords.map((keyword) => ({
          entityId,
          term: keyword.term,
          normalizedTerm: keyword.normalizedTerm,
          normalizationVersion: SEARCH_NORMALIZATION_VERSION,
          createdByRunId: run.id,
        })),
      )
      .onConflictDoNothing()
      .returning({ term: entitySearchTerms.term })

    return {
      runId: run.id,
      replayed: false,
      entityId,
      addedKeywords: addedKeywords.map(({ term }) => term),
    }
  })
}
