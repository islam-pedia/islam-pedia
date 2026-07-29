import { normalizeSearchText } from "@/domain/people/normalization"
import { personRelationshipTypes } from "@/domain/people/relationships"
import { PeopleInputError } from "../shared/errors"
import { requireCleanText } from "../shared/helpers"
import type {
  AuditFamilyBranchInput,
  AuditFamilyBranchResult,
  FamilyBranchSourceMemberInput,
  SearchPeopleResult,
} from "../shared/types"
import { getPerson } from "./get-person"
import { getPersonRelationships } from "./get-person-relationships"
import { searchPeople } from "./search-people"

export async function auditFamilyBranch(
  input: AuditFamilyBranchInput,
): Promise<AuditFamilyBranchResult | null> {
  const rootPersonId = requireCleanText(input.rootPersonId, "rootPersonId", 100)

  if (!personRelationshipTypes.includes(input.relationshipType)) {
    throw new PeopleInputError(
      `Unsupported person relationship type "${input.relationshipType}".`,
    )
  }

  if (input.direction !== "outgoing" && input.direction !== "incoming") {
    throw new PeopleInputError(
      'direction must be either "outgoing" or "incoming".',
    )
  }

  if (input.sourceMembers.length === 0 || input.sourceMembers.length > 100) {
    throw new PeopleInputError(
      "sourceMembers must contain between 1 and 100 people.",
    )
  }

  const rootPerson = await getPerson(rootPersonId)

  if (!rootPerson) {
    return null
  }

  const relationshipResult = await getPersonRelationships(rootPersonId)

  if (!relationshipResult) {
    return null
  }

  const directRelationships = relationshipResult.relationships.filter(
    (relationship) =>
      relationship.type === input.relationshipType &&
      relationship.direction === input.direction,
  )
  const relationshipByPersonId = new Map(
    directRelationships.map((relationship) => [
      relationship.relatedPerson.entityId,
      relationship,
    ]),
  )
  const matchedPersonIds = new Set<string>()
  const matched: AuditFamilyBranchResult["matched"] = []
  const unlinked: AuditFamilyBranchResult["unlinked"] = []
  const ambiguous: AuditFamilyBranchResult["ambiguous"] = []
  const missing: AuditFamilyBranchResult["missing"] = []

  const auditedMembers = await Promise.all(
    input.sourceMembers.map(async (sourceMember, sourceIndex) => {
      const preparedMember = prepareSourceMember(sourceMember, sourceIndex)
      const candidates = await findCandidates(preparedMember)
      const exactCandidates = candidates.filter((candidate) =>
        matchesSourceMember(candidate, preparedMember),
      )

      return {
        sourceIndex,
        sourceMember: preparedMember,
        candidates,
        exactCandidates,
      }
    }),
  )

  for (const {
    sourceIndex,
    sourceMember,
    candidates,
    exactCandidates,
  } of auditedMembers) {
    if (exactCandidates.length > 1) {
      ambiguous.push({
        sourceIndex,
        sourceMember,
        candidates: exactCandidates,
      })
      continue
    }

    const exactCandidate = exactCandidates[0]

    if (!exactCandidate) {
      missing.push({
        sourceIndex,
        sourceMember,
        fuzzyCandidates: candidates.slice(0, 5),
      })
      continue
    }

    const relationship = relationshipByPersonId.get(exactCandidate.entityId)

    if (!relationship) {
      unlinked.push({
        sourceIndex,
        sourceMember,
        candidates: [exactCandidate],
      })
      continue
    }

    matchedPersonIds.add(exactCandidate.entityId)
    matched.push({
      sourceIndex,
      sourceMember,
      person: exactCandidate,
      relationship,
    })
  }

  return {
    rootPerson,
    relationshipType: input.relationshipType,
    direction: input.direction,
    matched,
    unlinked,
    ambiguous,
    missing,
    databaseOnly: directRelationships.filter(
      (relationship) =>
        !matchedPersonIds.has(relationship.relatedPerson.entityId),
    ),
  }
}

async function findCandidates(
  sourceMember: FamilyBranchSourceMemberInput,
): Promise<SearchPeopleResult[]> {
  const queryResults = await Promise.all([
    searchPeople(sourceMember.nameOriginal, 100),
    searchPeople(sourceMember.nameLatin, 100),
    ...(sourceMember.names ?? []).flatMap((name) => [
      searchPeople(name.nameOriginal, 100),
      searchPeople(name.nameLatin, 100),
    ]),
  ])
  const candidatesById = new Map<string, SearchPeopleResult>()

  for (const candidate of queryResults.flat()) {
    const existing = candidatesById.get(candidate.entityId)

    if (!existing || candidate.score > existing.score) {
      candidatesById.set(candidate.entityId, candidate)
    }
  }

  return [...candidatesById.values()].sort(
    (left, right) =>
      right.score - left.score ||
      left.nameLatin.localeCompare(right.nameLatin) ||
      left.entityId.localeCompare(right.entityId),
  )
}

function matchesSourceMember(
  candidate: SearchPeopleResult,
  sourceMember: FamilyBranchSourceMemberInput,
): boolean {
  const candidateNames = [
    ...candidate.names,
    {
      type:
        candidate.names.find(({ isPrimary }) => isPrimary)?.type ?? "personal",
      nameOriginal: candidate.nameOriginal,
      nameLatin: candidate.nameLatin,
      isPrimary: true,
      id: "",
    },
  ]
  const primaryMatches = candidateNames.some(
    (name) =>
      normalizeSearchText(name.nameOriginal) ===
        normalizeSearchText(sourceMember.nameOriginal) ||
      normalizeSearchText(name.nameLatin) ===
        normalizeSearchText(sourceMember.nameLatin),
  )

  if (!primaryMatches) {
    return false
  }

  return (sourceMember.names ?? []).every((expectedName) =>
    candidateNames.some(
      (candidateName) =>
        candidateName.type === expectedName.type &&
        (normalizeSearchText(candidateName.nameOriginal) ===
          normalizeSearchText(expectedName.nameOriginal) ||
          normalizeSearchText(candidateName.nameLatin) ===
            normalizeSearchText(expectedName.nameLatin)),
    ),
  )
}

function prepareSourceMember(
  sourceMember: FamilyBranchSourceMemberInput,
  index: number,
): FamilyBranchSourceMemberInput {
  return {
    nameOriginal: requireCleanText(
      sourceMember.nameOriginal,
      `sourceMembers[${index}].nameOriginal`,
      500,
    ),
    nameLatin: requireCleanText(
      sourceMember.nameLatin,
      `sourceMembers[${index}].nameLatin`,
      500,
    ),
    names: sourceMember.names?.map((name, nameIndex) => ({
      type: name.type,
      nameOriginal: requireCleanText(
        name.nameOriginal,
        `sourceMembers[${index}].names[${nameIndex}].nameOriginal`,
        500,
      ),
      nameLatin: requireCleanText(
        name.nameLatin,
        `sourceMembers[${index}].names[${nameIndex}].nameLatin`,
        500,
      ),
    })),
  }
}
