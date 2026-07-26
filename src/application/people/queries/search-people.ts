import { sql } from "drizzle-orm"
import { getDatabase } from "@/db/client"
import { entities, entitySearchTerms, people, personNames } from "@/db/schema"
import { normalizeSearchText } from "@/domain/people/normalization"
import { PeopleInputError } from "../shared/errors"
import type { SearchPeopleResult, SearchRow } from "../shared/types"

export async function searchPeople(
  query: string,
  requestedLimit = 20,
): Promise<SearchPeopleResult[]> {
  const normalizedQuery = normalizeSearchText(query)

  if (!normalizedQuery) {
    throw new PeopleInputError(
      "query must contain searchable letters or numbers.",
    )
  }

  const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 100)
  const database = getDatabase()
  const rows = await database.execute<SearchRow>(sql`
    WITH ranked AS (
      SELECT
        ${entities.id} AS "entityId",
        ${entities.status} AS "status",
        ${entities.mergedIntoEntityId} AS "mergedIntoEntityId",
        ${people.nameOriginal} AS "nameOriginal",
        ${people.nameLatin} AS "nameLatin",
        ${people.gender} AS "gender",
        ${entities.createdAt} AS "createdAt",
        greatest(
          CASE
            WHEN ${people.nameOriginalNormalized} = ${normalizedQuery} THEN 1.0
            ELSE similarity(${people.nameOriginalNormalized}, ${normalizedQuery})
          END,
          CASE
            WHEN ${people.nameLatinNormalized} = ${normalizedQuery} THEN 1.0
            ELSE similarity(${people.nameLatinNormalized}, ${normalizedQuery})
          END,
          coalesce((
            SELECT max(greatest(
              CASE
                WHEN person_name.name_original_normalized = ${normalizedQuery}
                  THEN 1.0
                ELSE similarity(
                  person_name.name_original_normalized,
                  ${normalizedQuery}
                )
              END,
              CASE
                WHEN person_name.name_latin_normalized = ${normalizedQuery}
                  THEN 1.0
                ELSE similarity(
                  person_name.name_latin_normalized,
                  ${normalizedQuery}
                )
              END
            ))
            FROM ${personNames} AS person_name
            WHERE person_name.entity_id = ${entities.id}
          ), 0),
          coalesce((
            SELECT max(
              CASE
                WHEN term.normalized_term = ${normalizedQuery}
                  THEN term.weight::real / 100.0
                ELSE similarity(term.normalized_term, ${normalizedQuery})
                  * term.weight::real / 100.0
              END
            )
            FROM ${entitySearchTerms} AS term
            WHERE term.entity_id = ${entities.id}
          ), 0)
        )::real AS "score"
      FROM ${entities}
      INNER JOIN ${people} ON ${people.entityId} = ${entities.id}
      WHERE
        ${entities.kind} = 'person'
        AND ${entities.status} <> 'merged'
        AND (
          ${people.nameOriginalNormalized} = ${normalizedQuery}
          OR ${people.nameLatinNormalized} = ${normalizedQuery}
          OR ${people.nameOriginalNormalized} % ${normalizedQuery}
          OR ${people.nameLatinNormalized} % ${normalizedQuery}
          OR position(${normalizedQuery} IN ${people.nameOriginalNormalized}) > 0
          OR position(${normalizedQuery} IN ${people.nameLatinNormalized}) > 0
          OR EXISTS (
            SELECT 1
            FROM ${personNames} AS matching_name
            WHERE
              matching_name.entity_id = ${entities.id}
              AND (
                matching_name.name_original_normalized = ${normalizedQuery}
                OR matching_name.name_latin_normalized = ${normalizedQuery}
                OR matching_name.name_original_normalized % ${normalizedQuery}
                OR matching_name.name_latin_normalized % ${normalizedQuery}
                OR position(
                  ${normalizedQuery}
                  IN matching_name.name_original_normalized
                ) > 0
                OR position(
                  ${normalizedQuery}
                  IN matching_name.name_latin_normalized
                ) > 0
              )
          )
          OR EXISTS (
            SELECT 1
            FROM ${entitySearchTerms} AS matching_term
            WHERE
              matching_term.entity_id = ${entities.id}
              AND (
                matching_term.normalized_term = ${normalizedQuery}
                OR matching_term.normalized_term % ${normalizedQuery}
                OR position(
                  ${normalizedQuery} IN matching_term.normalized_term
                ) > 0
              )
          )
        )
    )
    SELECT
      ranked.*,
      coalesce((
        SELECT jsonb_agg(term.term ORDER BY term.weight DESC, term.term)
        FROM ${entitySearchTerms} AS term
        WHERE term.entity_id = ranked."entityId"
      ), '[]'::jsonb) AS "keywords",
      coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', person_name.id,
            'type', person_name.type,
            'nameOriginal', person_name.name_original,
            'nameLatin', person_name.name_latin,
            'isPrimary', person_name.is_primary
          )
          ORDER BY
            person_name.is_primary DESC,
            person_name.type,
            person_name.name_latin
        )
        FROM ${personNames} AS person_name
        WHERE person_name.entity_id = ranked."entityId"
      ), '[]'::jsonb) AS "names"
    FROM ranked
    ORDER BY ranked."score" DESC, ranked."nameLatin", ranked."entityId"
    LIMIT ${limit}
  `)

  return rows.map((row) => ({
    entityId: row.entityId,
    status: row.status,
    mergedIntoEntityId: row.mergedIntoEntityId,
    nameOriginal: row.nameOriginal,
    nameLatin: row.nameLatin,
    gender: row.gender,
    names: row.names,
    keywords: row.keywords,
    createdAt: row.createdAt.toISOString(),
    score: row.score,
  }))
}
