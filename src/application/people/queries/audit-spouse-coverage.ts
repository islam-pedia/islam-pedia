import { and, eq, inArray } from "drizzle-orm"
import { getDatabase } from "@/db/client"
import { people, personRelationships } from "@/db/schema"
import { PeopleInputError } from "../shared/errors"
import type {
  AssertionStatus,
  AuditSpouseCoverageInput,
  AuditSpouseCoverageResult,
  PersonRelationshipView,
  SpouseCoverageStatus,
} from "../shared/types"
import { hydratePersonRelationshipRows } from "./get-person-relationships"

const assertionStatuses = [
  "accepted",
  "uncertain",
  "disputed",
  "retracted",
] as const
const spouseCoverageStatuses = [...assertionStatuses, "missing"] as const
const coverageSortOrder = new Map<SpouseCoverageStatus, number>([
  ["missing", 0],
  ["uncertain", 1],
  ["disputed", 2],
  ["retracted", 3],
  ["accepted", 4],
])

type ParentRelationshipRow = typeof personRelationships.$inferSelect

interface ParentPairAccumulator {
  maleParentId: string
  femaleParentId: string
  children: Array<{
    childId: string
    maleParentRelationshipId: string
    femaleParentRelationshipId: string
  }>
}

export async function auditSpouseCoverage(
  input: AuditSpouseCoverageInput = {},
): Promise<AuditSpouseCoverageResult> {
  const parentStatuses = prepareAssertionStatuses(input.parentStatuses)
  const coverageStatuses = prepareCoverageStatuses(input.coverageStatuses)
  const offset = boundedInteger(input.offset ?? 0, "offset", 0, 100_000)
  const limit = boundedInteger(input.limit ?? 100, "limit", 1, 500)
  const database = getDatabase()
  const parentRows = await database
    .select()
    .from(personRelationships)
    .where(
      and(
        eq(personRelationships.type, "biological_parent_of"),
        inArray(personRelationships.status, parentStatuses),
      ),
    )
    .orderBy(
      personRelationships.toPersonId,
      personRelationships.fromPersonId,
      personRelationships.id,
    )

  if (parentRows.length === 0) {
    return emptyResult(parentStatuses, coverageStatuses, offset, limit)
  }

  const parentIds = [...new Set(parentRows.map((row) => row.fromPersonId))]
  const parentPeople = await database
    .select({ entityId: people.entityId, gender: people.gender })
    .from(people)
    .where(inArray(people.entityId, parentIds))
  const genderByParentId = new Map(
    parentPeople.map((person) => [person.entityId, person.gender]),
  )
  const parentsByChildId = new Map<
    string,
    { male: ParentRelationshipRow[]; female: ParentRelationshipRow[] }
  >()
  let unclassifiedParentRelationships = 0

  for (const relationship of parentRows) {
    const gender = genderByParentId.get(relationship.fromPersonId)

    if (gender !== "male" && gender !== "female") {
      unclassifiedParentRelationships += 1
      continue
    }

    const parents = parentsByChildId.get(relationship.toPersonId) ?? {
      male: [],
      female: [],
    }
    parents[gender].push(relationship)
    parentsByChildId.set(relationship.toPersonId, parents)
  }

  const pairAccumulators = new Map<string, ParentPairAccumulator>()
  let childrenWithBothParentGenders = 0

  for (const [childId, parents] of parentsByChildId) {
    if (parents.male.length === 0 || parents.female.length === 0) {
      continue
    }

    childrenWithBothParentGenders += 1

    for (const maleParent of parents.male) {
      for (const femaleParent of parents.female) {
        const key = `${maleParent.fromPersonId}:${femaleParent.fromPersonId}`
        const pair = pairAccumulators.get(key) ?? {
          maleParentId: maleParent.fromPersonId,
          femaleParentId: femaleParent.fromPersonId,
          children: [],
        }
        pair.children.push({
          childId,
          maleParentRelationshipId: maleParent.id,
          femaleParentRelationshipId: femaleParent.id,
        })
        pairAccumulators.set(key, pair)
      }
    }
  }

  const maleParentIds = [
    ...new Set(
      [...pairAccumulators.values()].map(({ maleParentId }) => maleParentId),
    ),
  ]
  const spouseRows =
    maleParentIds.length === 0
      ? []
      : await database
          .select()
          .from(personRelationships)
          .where(
            and(
              eq(personRelationships.type, "husband_of"),
              inArray(personRelationships.fromPersonId, maleParentIds),
            ),
          )
          .orderBy(
            personRelationships.fromPersonId,
            personRelationships.toPersonId,
            personRelationships.id,
          )
  const relationshipViews = await hydratePersonRelationshipRows([
    ...parentRows,
    ...spouseRows,
  ])
  const relationshipById = new Map(
    relationshipViews.map((relationship) => [
      relationship.relationshipId,
      relationship,
    ]),
  )

  const pairs: AuditSpouseCoverageResult["pairs"] = []

  for (const pair of pairAccumulators.values()) {
    const spouseRow = spouseRows.find(
      (relationship) =>
        relationship.fromPersonId === pair.maleParentId &&
        relationship.toPersonId === pair.femaleParentId,
    )
    const spouseRelationship = spouseRow
      ? requireRelationship(relationshipById, spouseRow.id)
      : null
    const maleParent = requireRelationship(
      relationshipById,
      pair.children[0]?.maleParentRelationshipId,
    ).fromPerson
    const femaleParent = requireRelationship(
      relationshipById,
      pair.children[0]?.femaleParentRelationshipId,
    ).fromPerson

    pairs.push({
      coverage: spouseRelationship?.status ?? "missing",
      maleParent,
      femaleParent,
      spouseRelationship,
      sharedChildren: pair.children
        .map((child) => {
          const maleParentRelationship = requireRelationship(
            relationshipById,
            child.maleParentRelationshipId,
          )
          const femaleParentRelationship = requireRelationship(
            relationshipById,
            child.femaleParentRelationshipId,
          )

          return {
            child: maleParentRelationship.toPerson,
            maleParentRelationship,
            femaleParentRelationship,
          }
        })
        .sort(
          (left, right) =>
            left.child.nameLatin.localeCompare(right.child.nameLatin) ||
            left.child.entityId.localeCompare(right.child.entityId),
        ),
    })
  }

  pairs.sort(
    (left, right) =>
      (coverageSortOrder.get(left.coverage) ?? 99) -
        (coverageSortOrder.get(right.coverage) ?? 99) ||
      left.maleParent.nameLatin.localeCompare(right.maleParent.nameLatin) ||
      left.femaleParent.nameLatin.localeCompare(right.femaleParent.nameLatin) ||
      left.maleParent.entityId.localeCompare(right.maleParent.entityId) ||
      left.femaleParent.entityId.localeCompare(right.femaleParent.entityId),
  )

  const summary = {
    biologicalParentRelationships: parentRows.length,
    childrenWithBothParentGenders,
    coParentPairs: pairs.length,
    unclassifiedParentRelationships,
    accepted: countCoverage(pairs, "accepted"),
    uncertain: countCoverage(pairs, "uncertain"),
    disputed: countCoverage(pairs, "disputed"),
    retracted: countCoverage(pairs, "retracted"),
    missing: countCoverage(pairs, "missing"),
  }
  const filteredPairs = pairs.filter(({ coverage }) =>
    coverageStatuses.includes(coverage),
  )
  const page = filteredPairs.slice(offset, offset + limit)

  return {
    parentStatuses,
    coverageStatuses,
    offset,
    limit,
    matchingPairs: filteredPairs.length,
    returnedPairs: page.length,
    hasMore: offset + page.length < filteredPairs.length,
    summary,
    pairs: page,
  }
}

function emptyResult(
  parentStatuses: AssertionStatus[],
  coverageStatuses: SpouseCoverageStatus[],
  offset: number,
  limit: number,
): AuditSpouseCoverageResult {
  return {
    parentStatuses,
    coverageStatuses,
    offset,
    limit,
    matchingPairs: 0,
    returnedPairs: 0,
    hasMore: false,
    summary: {
      biologicalParentRelationships: 0,
      childrenWithBothParentGenders: 0,
      coParentPairs: 0,
      unclassifiedParentRelationships: 0,
      accepted: 0,
      uncertain: 0,
      disputed: 0,
      retracted: 0,
      missing: 0,
    },
    pairs: [],
  }
}

function prepareAssertionStatuses(
  requested: AssertionStatus[] | undefined,
): AssertionStatus[] {
  const statuses: AssertionStatus[] = [
    ...new Set(requested ?? (["accepted"] satisfies AssertionStatus[])),
  ]

  if (
    statuses.length === 0 ||
    statuses.some((status) => !assertionStatuses.includes(status))
  ) {
    throw new PeopleInputError(
      "parentStatuses must contain accepted, uncertain, disputed, or retracted.",
    )
  }

  return statuses
}

function prepareCoverageStatuses(
  requested: SpouseCoverageStatus[] | undefined,
): SpouseCoverageStatus[] {
  const statuses = [...new Set(requested ?? spouseCoverageStatuses)]

  if (
    statuses.length === 0 ||
    statuses.some((status) => !spouseCoverageStatuses.includes(status))
  ) {
    throw new PeopleInputError(
      "coverageStatuses must contain accepted, uncertain, disputed, retracted, or missing.",
    )
  }

  return statuses
}

function boundedInteger(
  value: number,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new PeopleInputError(
      `${field} must be an integer between ${minimum} and ${maximum}.`,
    )
  }

  return value
}

function requireRelationship(
  relationshipsById: Map<string, PersonRelationshipView>,
  relationshipId: string | undefined,
): PersonRelationshipView {
  const relationship = relationshipId
    ? relationshipsById.get(relationshipId)
    : undefined

  if (!relationship) {
    throw new Error(
      `Relationship "${relationshipId ?? "unknown"}" was not found during spouse coverage audit.`,
    )
  }

  return relationship
}

function countCoverage(
  pairs: AuditSpouseCoverageResult["pairs"],
  coverage: SpouseCoverageStatus,
): number {
  return pairs.filter((pair) => pair.coverage === coverage).length
}
