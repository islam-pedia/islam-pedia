import { and, eq, inArray, or, sql } from "drizzle-orm"
import { getDatabase } from "../db/client.ts"
import {
  entities,
  entitySearchTerms,
  ingestionRuns,
  people,
} from "../db/schema.ts"
import {
  cleanDisplayText,
  normalizeSearchText,
  prepareSearchTerms,
  SEARCH_NORMALIZATION_VERSION,
} from "../domain/people/normalization.ts"

export interface IngestionSourceInput {
  label?: string
  uri?: string
}

export interface PersonInput {
  nameOriginal: string
  nameLatin: string
  keywords?: string[]
}

export interface ImportPeopleInput {
  batchKey: string
  instruction?: string
  source?: IngestionSourceInput
  people: PersonInput[]
}

export interface AddPersonKeywordsInput {
  operationKey: string
  entityId: string
  keywords: string[]
  instruction?: string
  source?: IngestionSourceInput
}

export interface PersonView {
  entityId: string
  status: "provisional" | "active" | "merged"
  mergedIntoEntityId: string | null
  nameOriginal: string
  nameLatin: string
  keywords: string[]
  createdAt: string
}

export interface ImportedPersonView extends PersonView {
  duplicateCandidateIds: string[]
}

export interface ImportPeopleResult {
  runId: string
  replayed: boolean
  people: ImportedPersonView[]
}

export class PeopleInputError extends Error {
  override name = "PeopleInputError"
}

export class IdempotencyConflictError extends Error {
  override name = "IdempotencyConflictError"
}

interface PreparedPerson {
  nameOriginal: string
  nameOriginalNormalized: string
  nameLatin: string
  nameLatinNormalized: string
  keywords: Array<{
    term: string
    normalizedTerm: string
  }>
}

interface PersonRow {
  entityId: string
  status: "provisional" | "active" | "merged"
  mergedIntoEntityId: string | null
  nameOriginal: string
  nameLatin: string
  keywords: string[]
  createdAt: Date
}

interface SearchRow extends PersonRow, Record<string, unknown> {
  score: number
}

export interface SearchPeopleResult extends PersonView {
  score: number
}

function requireCleanText(value: string, field: string): string {
  const cleaned = cleanDisplayText(value)

  if (!cleaned) {
    throw new PeopleInputError(`${field} must not be blank.`)
  }

  return cleaned
}

function preparePerson(input: PersonInput): PreparedPerson {
  const nameOriginal = requireCleanText(input.nameOriginal, "nameOriginal")
  const nameLatin = requireCleanText(input.nameLatin, "nameLatin")
  const nameOriginalNormalized = normalizeSearchText(nameOriginal)
  const nameLatinNormalized = normalizeSearchText(nameLatin)

  if (!nameOriginalNormalized || !nameLatinNormalized) {
    throw new PeopleInputError(
      "Person names must contain searchable letters or numbers.",
    )
  }

  return {
    nameOriginal,
    nameOriginalNormalized,
    nameLatin,
    nameLatinNormalized,
    keywords: prepareSearchTerms(
      input.keywords ?? [],
      new Set([nameOriginalNormalized, nameLatinNormalized]),
    ),
  }
}

function hashRequest(value: unknown): string {
  return new Bun.CryptoHasher("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
}

function getRequestHash(metadata: Record<string, unknown>): string | undefined {
  const requestHash = metadata.requestHash
  return typeof requestHash === "string" ? requestHash : undefined
}

function assertMatchingIdempotentRequest(
  existingMetadata: Record<string, unknown>,
  requestHash: string,
  key: string,
): void {
  if (getRequestHash(existingMetadata) !== requestHash) {
    throw new IdempotencyConflictError(
      `Idempotency key "${key}" was already used with different input.`,
    )
  }
}

function toPersonView(
  row: PersonRow,
  duplicateCandidateIds: string[] = [],
): ImportedPersonView {
  return {
    entityId: row.entityId,
    status: row.status,
    mergedIntoEntityId: row.mergedIntoEntityId,
    nameOriginal: row.nameOriginal,
    nameLatin: row.nameLatin,
    keywords: row.keywords,
    createdAt: row.createdAt.toISOString(),
    duplicateCandidateIds,
  }
}

async function listPeopleCreatedByRun(
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
        person.nameOriginalNormalized,
        person.nameLatinNormalized,
        ...person.keywords.map(({ normalizedTerm }) => normalizedTerm),
      ]

      const candidateRows = await transaction
        .selectDistinct({ entityId: people.entityId })
        .from(people)
        .leftJoin(
          entitySearchTerms,
          eq(entitySearchTerms.entityId, people.entityId),
        )
        .where(
          or(
            eq(people.nameOriginalNormalized, person.nameOriginalNormalized),
            eq(people.nameLatinNormalized, person.nameLatinNormalized),
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

      await transaction.insert(people).values({
        entityId: entity.id,
        nameOriginal: person.nameOriginal,
        nameOriginalNormalized: person.nameOriginalNormalized,
        nameLatin: person.nameLatin,
        nameLatinNormalized: person.nameLatinNormalized,
        normalizationVersion: SEARCH_NORMALIZATION_VERSION,
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
      ), '[]'::jsonb) AS "keywords"
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
    keywords: row.keywords,
    createdAt: row.createdAt.toISOString(),
    score: row.score,
  }))
}

export async function addPersonKeywords(
  input: AddPersonKeywordsInput,
): Promise<{
  runId: string
  replayed: boolean
  entityId: string
  addedKeywords: string[]
}> {
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
