import { desc, eq, inArray } from "drizzle-orm"
import { getDatabase } from "@/db/client"
import { entities, entitySearchTerms, people, personNames } from "@/db/schema"
import { toPersonView } from "../shared/helpers"
import type { ImportedPersonView, PersonNameView } from "../shared/types"

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

  const entityIds = rows.map(({ entityId }) => entityId)
  const nameRows = await database
    .select({
      id: personNames.id,
      entityId: personNames.entityId,
      type: personNames.type,
      nameOriginal: personNames.nameOriginal,
      nameLatin: personNames.nameLatin,
      isPrimary: personNames.isPrimary,
    })
    .from(personNames)
    .where(inArray(personNames.entityId, entityIds))
    .orderBy(
      personNames.entityId,
      desc(personNames.isPrimary),
      personNames.type,
      personNames.nameLatin,
    )

  const keywordRows = await database
    .select({
      entityId: entitySearchTerms.entityId,
      term: entitySearchTerms.term,
    })
    .from(entitySearchTerms)
    .where(inArray(entitySearchTerms.entityId, entityIds))
    .orderBy(entitySearchTerms.weight, entitySearchTerms.term)

  const keywordsByEntity = new Map<string, string[]>()
  const namesByEntity = new Map<string, PersonNameView[]>()

  for (const { entityId, ...name } of nameRows) {
    const names = namesByEntity.get(entityId) ?? []
    names.push(name)
    namesByEntity.set(entityId, names)
  }

  for (const keyword of keywordRows) {
    const keywords = keywordsByEntity.get(keyword.entityId) ?? []
    keywords.push(keyword.term)
    keywordsByEntity.set(keyword.entityId, keywords)
  }

  return rows.map((row) =>
    toPersonView({
      ...row,
      names: namesByEntity.get(row.entityId) ?? [],
      keywords: keywordsByEntity.get(row.entityId) ?? [],
    }),
  )
}
