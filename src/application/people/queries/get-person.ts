import { and, eq } from "drizzle-orm"
import { getDatabase } from "@/db/client"
import { entities, entitySearchTerms, people } from "@/db/schema"
import type { PersonView } from "../shared/types"

export async function getPerson(entityId: string): Promise<PersonView | null> {
  const database = getDatabase()
  const [row] = await database
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
    .where(and(eq(entities.id, entityId), eq(entities.kind, "person")))
    .limit(1)

  if (!row) {
    return null
  }

  const keywords = await database
    .select({ term: entitySearchTerms.term })
    .from(entitySearchTerms)
    .where(eq(entitySearchTerms.entityId, entityId))
    .orderBy(entitySearchTerms.weight, entitySearchTerms.term)

  return {
    ...row,
    keywords: keywords.map(({ term }) => term),
    createdAt: row.createdAt.toISOString(),
  }
}
