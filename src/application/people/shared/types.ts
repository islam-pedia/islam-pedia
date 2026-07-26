/** Public and internal contracts for the people application module. */
import type {
  SourceCategory,
  SourceMethodology,
  SourceVerification,
} from "@/domain/evidence/source-policy"

export type {
  HadithGrade,
  SourceCategory,
  SourceMethodology,
  SourceVerification,
} from "@/domain/evidence/source-policy"

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

export interface EvidenceSourceInput {
  category: SourceCategory
  label: string
  uri?: string
  author?: string
  workTitle?: string
  edition?: string
  methodologyBasis: string
  verification?: SourceVerification
}

export interface EvidenceLocatorInput {
  volume?: string
  page?: string
  chapter?: string
  verse?: string
  hadithNumber?: string
  section?: string
  url?: string
}

export type EvidenceInterpretation = "explicit" | "inferred"

export type AssertionStatus =
  | "accepted"
  | "uncertain"
  | "disputed"
  | "retracted"

export interface ActivatePersonEvidenceInput {
  source: EvidenceSourceInput
  passage: string
  language?: string
  locator?: EvidenceLocatorInput
  assertion: string
  interpretation: EvidenceInterpretation
  notes?: string
}

export interface ActivatePersonInput {
  operationKey: string
  entityId: string
  reason: string
  instruction?: string
  evidence: ActivatePersonEvidenceInput[]
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

export interface ActivatePersonResult extends Record<string, unknown> {
  runId: string
  replayed: boolean
  entityId: string
  status: "active"
  evidenceIds: string[]
  statusChangeId: string
}

export interface PersonEvidenceView {
  evidenceId: string
  assertion: string
  interpretation: EvidenceInterpretation
  status: AssertionStatus
  notes: string | null
  source: {
    sourceId: string
    category: SourceCategory
    label: string
    uri: string | null
    author: string | null
    workTitle: string | null
    edition: string | null
    methodology: SourceMethodology
    methodologyBasis: string
    policyVersion: string
    verification: SourceVerification
  }
  passage: {
    passageId: string
    text: string
    language: string | null
    locator: EvidenceLocatorInput
  }
  createdAt: string
}

export interface PersonStatusChangeView {
  statusChangeId: string
  fromStatus: PersonStatus | null
  toStatus: PersonStatus
  reason: string
  runId: string
  createdAt: string
}

export interface GetPersonEvidenceResult extends Record<string, unknown> {
  entityId: string
  evidence: PersonEvidenceView[]
  statusHistory: PersonStatusChangeView[]
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
