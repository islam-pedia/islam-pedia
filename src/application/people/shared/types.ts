/** Public and internal contracts for the people application module. */
import type {
  SourceCategory,
  SourceMethodology,
  SourceVerification,
} from "@/domain/evidence/source-policy"
import type { PersonNameType } from "@/domain/people/names"
import type {
  PersonGender,
  PersonRelationshipDirection,
  PersonRelationshipType,
} from "@/domain/people/relationships"

export type {
  HadithGrade,
  SourceCategory,
  SourceMethodology,
  SourceVerification,
} from "@/domain/evidence/source-policy"
export type { PersonNameType } from "@/domain/people/names"
export type {
  PersonGender,
  PersonRelationshipDirection,
  PersonRelationshipType,
} from "@/domain/people/relationships"

export type PersonStatus = "provisional" | "active" | "merged"

export interface IngestionSourceInput {
  label?: string
  uri?: string
}

export interface PersonInput {
  nameOriginal: string
  nameLatin: string
  gender?: PersonGender
  nameType?: PersonNameType
  names?: PersonNameInput[]
  keywords?: string[]
}

export interface PersonNameInput {
  type: PersonNameType
  nameOriginal: string
  nameLatin: string
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

export interface AddPersonNamesInput {
  operationKey: string
  entityId: string
  names: PersonNameInput[]
  instruction?: string
  source?: IngestionSourceInput
}

export interface SetPersonPrimaryNameInput {
  operationKey: string
  entityId: string
  name: PersonNameInput
  reason: string
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

export interface SetPersonGenderInput {
  operationKey: string
  entityId: string
  gender: PersonGender
  reason: string
  instruction?: string
  source?: IngestionSourceInput
}

export interface AddPersonRelationshipInput {
  operationKey: string
  fromPersonId: string
  toPersonId: string
  type: PersonRelationshipType
  status: AssertionStatus
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
  gender: PersonGender
  names: PersonNameView[]
  keywords: string[]
  createdAt: string
}

export interface PersonNameView {
  id: string
  type: PersonNameType
  nameOriginal: string
  nameLatin: string
  isPrimary: boolean
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

export interface AddPersonNamesResult extends Record<string, unknown> {
  runId: string
  replayed: boolean
  entityId: string
  addedNames: PersonNameView[]
}

export interface ActivatePersonResult extends Record<string, unknown> {
  runId: string
  replayed: boolean
  entityId: string
  status: "active"
  evidenceIds: string[]
  statusChangeId: string
}

export interface SetPersonGenderResult extends Record<string, unknown> {
  runId: string
  replayed: boolean
  entityId: string
  previousGender: PersonGender
  gender: PersonGender
  changed: boolean
  genderChangeId: string | null
}

export interface SetPersonPrimaryNameResult extends Record<string, unknown> {
  runId: string
  replayed: boolean
  entityId: string
  previousPrimaryName: PersonNameView
  primaryName: PersonNameView
  changed: boolean
  primaryNameChangeId: string | null
}

export interface AddPersonRelationshipResult extends Record<string, unknown> {
  runId: string
  replayed: boolean
  relationshipId: string
  created: boolean
  status: AssertionStatus
  evidenceIds: string[]
  statusChangeId: string | null
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

export interface RelatedPersonView {
  entityId: string
  gender: PersonGender
  nameOriginal: string
  nameLatin: string
}

export interface PersonRelationshipEvidenceView {
  evidenceId: string
  assertion: string
  interpretation: EvidenceInterpretation
  status: AssertionStatus
  notes: string | null
  source: PersonEvidenceView["source"]
  passage: PersonEvidenceView["passage"]
  createdAt: string
}

export interface PersonRelationshipStatusChangeView {
  statusChangeId: string
  fromStatus: AssertionStatus | null
  toStatus: AssertionStatus
  reason: string
  runId: string
  createdAt: string
}

export interface PersonRelationshipView {
  relationshipId: string
  type: PersonRelationshipType
  status: AssertionStatus
  direction: PersonRelationshipDirection
  label: string
  fromPerson: RelatedPersonView
  toPerson: RelatedPersonView
  relatedPerson: RelatedPersonView
  evidence: PersonRelationshipEvidenceView[]
  statusHistory: PersonRelationshipStatusChangeView[]
  createdAt: string
  updatedAt: string
}

export interface GetPersonRelationshipsResult extends Record<string, unknown> {
  entityId: string
  relationships: PersonRelationshipView[]
}

export interface FamilyBranchMemberNameInput {
  type: PersonNameType
  nameOriginal: string
  nameLatin: string
}

export interface FamilyBranchSourceMemberInput {
  nameOriginal: string
  nameLatin: string
  names?: FamilyBranchMemberNameInput[]
}

export interface AuditFamilyBranchInput {
  rootPersonId: string
  relationshipType: PersonRelationshipType
  direction: PersonRelationshipDirection
  sourceMembers: FamilyBranchSourceMemberInput[]
}

export interface FamilyBranchAuditMatch {
  sourceIndex: number
  sourceMember: FamilyBranchSourceMemberInput
  person: SearchPeopleResult
  relationship: PersonRelationshipView
}

export interface FamilyBranchAuditCandidateGroup {
  sourceIndex: number
  sourceMember: FamilyBranchSourceMemberInput
  candidates: SearchPeopleResult[]
}

export interface FamilyBranchAuditMissing {
  sourceIndex: number
  sourceMember: FamilyBranchSourceMemberInput
  fuzzyCandidates: SearchPeopleResult[]
}

export interface AuditFamilyBranchResult extends Record<string, unknown> {
  rootPerson: PersonView
  relationshipType: PersonRelationshipType
  direction: PersonRelationshipDirection
  matched: FamilyBranchAuditMatch[]
  unlinked: FamilyBranchAuditCandidateGroup[]
  ambiguous: FamilyBranchAuditCandidateGroup[]
  missing: FamilyBranchAuditMissing[]
  databaseOnly: PersonRelationshipView[]
}

export interface ImportFamilyBranchRelationshipInput {
  type: PersonRelationshipType
  direction: PersonRelationshipDirection
  status: AssertionStatus
  reason: string
  evidence: ActivatePersonEvidenceInput[]
}

export interface ImportFamilyBranchMemberInput {
  existingPersonId?: string
  person?: PersonInput
  relationship: ImportFamilyBranchRelationshipInput
}

export interface ImportFamilyBranchInput {
  operationKey: string
  rootPersonId: string
  instruction?: string
  source?: IngestionSourceInput
  members: ImportFamilyBranchMemberInput[]
}

export interface ImportFamilyBranchMemberResult {
  index: number
  created: boolean
  person: ImportedPersonView
  relationship: AddPersonRelationshipResult
}

export interface ImportFamilyBranchResult extends Record<string, unknown> {
  runId: string
  replayed: boolean
  rootPersonId: string
  peopleRunId: string | null
  members: ImportFamilyBranchMemberResult[]
}

export interface GetFamilyTreeInput {
  rootPersonId: string
  maxDepth?: number
  maxNodes?: number
  relationshipTypes?: PersonRelationshipType[]
  statuses?: AssertionStatus[]
}

export interface FamilyTreeNode {
  depth: number
  person: PersonView
}

export interface FamilyTreeEdge {
  relationshipId: string
  type: PersonRelationshipType
  status: AssertionStatus
  fromPersonId: string
  toPersonId: string
}

export interface GetFamilyTreeResult extends Record<string, unknown> {
  rootPersonId: string
  maxDepth: number
  maxNodes: number
  truncated: boolean
  nodes: FamilyTreeNode[]
  edges: FamilyTreeEdge[]
}

export interface PreparedPerson {
  nameOriginal: string
  nameOriginalNormalized: string
  nameLatin: string
  nameLatinNormalized: string
  gender: PersonGender
  names: PreparedPersonName[]
  keywords: Array<{
    term: string
    normalizedTerm: string
  }>
}

export interface PreparedPersonName {
  type: PersonNameType
  nameOriginal: string
  nameOriginalNormalized: string
  nameLatin: string
  nameLatinNormalized: string
  isPrimary: boolean
}

export interface PersonRow {
  entityId: string
  status: PersonStatus
  mergedIntoEntityId: string | null
  nameOriginal: string
  nameLatin: string
  gender: PersonGender
  names: PersonNameView[]
  keywords: string[]
  createdAt: Date
}

export interface SearchRow extends PersonRow, Record<string, unknown> {
  score: number
}
