import { eq, inArray } from "drizzle-orm"
import { getDatabase } from "@/db/client"
import { entities, entitySearchTerms, people } from "@/db/schema"
import { toPersonView } from "../shared/helpers"
import type { ImportedPersonView } from "../shared/types"

export async function listPeopleCreatedByRun(
  runId: string,
): Promise<ImportedPersonView[]> {
  const database = getDatabase()
  const rows = await database
    .select({
      entityId: entities.id,
      status: entities.status,
      mergedIntoEntityId: entities.mergedIntoEntityId,
      nameOriginal: people.nameOriginal,
      nameLatin: people.nameLatin,
      createdAt: entities.createdAt,
    })
    .from(entities)
    .innerJoin(people, eq(people.entityId, entities.id))
    .where(eq(entities.createdByRunId, runId))
    .orderBy(entities.createdAt, entities.id)

  if (rows.length === 0) {
    return []
  }

  const keywordRows = await database
    .select({
      entityId: entitySearchTerms.entityId,
      term: entitySearchTerms.term,
    })
    .from(entitySearchTerms)
    .where(
      inArray(
        entitySearchTerms.entityId,
        rows.map(({ entityId }) => entityId),
      ),
    )
    .orderBy(entitySearchTerms.weight, entitySearchTerms.term)

  const keywordsByEntity = new Map<string, string[]>()

  for (const keyword of keywordRows) {
    const keywords = keywordsByEntity.get(keyword.entityId) ?? []
    keywords.push(keyword.term)
    keywordsByEntity.set(keyword.entityId, keywords)
  }

  return rows.map((row) =>
    toPersonView({
      ...row,
      keywords: keywordsByEntity.get(row.entityId) ?? [],
    }),
  )
}
