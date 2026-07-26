import { and, desc, eq } from "drizzle-orm"
import { getDatabase } from "@/db/client"
import { entities, entitySearchTerms, people, personNames } from "@/db/schema"
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
      gender: people.gender,
      createdAt: entities.createdAt,
    })
    .from(entities)
    .innerJoin(people, eq(people.entityId, entities.id))
    .where(and(eq(entities.id, entityId), eq(entities.kind, "person")))
    .limit(1)

  if (!row) {
    return null
  }

  const names = await database
    .select({
      id: personNames.id,
      type: personNames.type,
      nameOriginal: personNames.nameOriginal,
      nameLatin: personNames.nameLatin,
      isPrimary: personNames.isPrimary,
    })
    .from(personNames)
    .where(eq(personNames.entityId, entityId))
    .orderBy(
      desc(personNames.isPrimary),
      personNames.type,
      personNames.nameLatin,
    )

  const keywords = await database
    .select({ term: entitySearchTerms.term })
    .from(entitySearchTerms)
    .where(eq(entitySearchTerms.entityId, entityId))
    .orderBy(entitySearchTerms.weight, entitySearchTerms.term)

  return {
    ...row,
    names,
    keywords: keywords.map(({ term }) => term),
    createdAt: row.createdAt.toISOString(),
  }
}
