/** Public and internal contracts for the people application module. */
export type PersonStatus = "provisional" | "active" | "merged"

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
  status: PersonStatus
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

export interface SearchPeopleResult extends PersonView {
  score: number
}

export interface AddPersonKeywordsResult {
  runId: string
  replayed: boolean
  entityId: string
  addedKeywords: string[]
}

export interface PreparedPerson {
  nameOriginal: string
  nameOriginalNormalized: string
  nameLatin: string
  nameLatinNormalized: string
  keywords: Array<{
    term: string
    normalizedTerm: string
  }>
}

export interface PersonRow {
  entityId: string
  status: PersonStatus
  mergedIntoEntityId: string | null
  nameOriginal: string
  nameLatin: string
  keywords: string[]
  createdAt: Date
}

export interface SearchRow extends PersonRow, Record<string, unknown> {
  score: number
}
