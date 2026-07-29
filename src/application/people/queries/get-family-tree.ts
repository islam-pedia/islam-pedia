import { personRelationshipTypes } from "@/domain/people/relationships"
import { PeopleInputError } from "../shared/errors"
import { requireCleanText } from "../shared/helpers"
import type {
  AssertionStatus,
  GetFamilyTreeInput,
  GetFamilyTreeResult,
  PersonRelationshipType,
} from "../shared/types"
import { getPerson } from "./get-person"
import { getPersonRelationships } from "./get-person-relationships"

const assertionStatuses = [
  "accepted",
  "uncertain",
  "disputed",
  "retracted",
] as const

export async function getFamilyTree(
  input: GetFamilyTreeInput,
): Promise<GetFamilyTreeResult | null> {
  const rootPersonId = requireCleanText(input.rootPersonId, "rootPersonId", 100)
  const maxDepth = boundedInteger(input.maxDepth ?? 2, "maxDepth", 1, 6)
  const maxNodes = boundedInteger(input.maxNodes ?? 100, "maxNodes", 1, 500)
  const relationshipTypes = prepareRelationshipTypes(input.relationshipTypes)
  const statuses = prepareStatuses(input.statuses)
  const rootPerson = await getPerson(rootPersonId)

  if (!rootPerson) {
    return null
  }

  const nodesById = new Map([[rootPersonId, { depth: 0, person: rootPerson }]])
  const edgesById = new Map<string, GetFamilyTreeResult["edges"][number]>()
  const queue: Array<{ entityId: string; depth: number }> = [
    { entityId: rootPersonId, depth: 0 },
  ]
  let truncated = false

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]

    if (!current || current.depth >= maxDepth) {
      continue
    }

    const relationshipResult = await getPersonRelationships(current.entityId)

    if (!relationshipResult) {
      continue
    }

    for (const relationship of relationshipResult.relationships) {
      if (
        !relationshipTypes.has(relationship.type) ||
        !statuses.has(relationship.status)
      ) {
        continue
      }

      const relatedId = relationship.relatedPerson.entityId
      const nextDepth = current.depth + 1

      if (!nodesById.has(relatedId)) {
        if (nodesById.size >= maxNodes) {
          truncated = true
          continue
        }

        const relatedPerson = await getPerson(relatedId)

        if (!relatedPerson) {
          continue
        }

        nodesById.set(relatedId, {
          depth: nextDepth,
          person: relatedPerson,
        })
        queue.push({ entityId: relatedId, depth: nextDepth })
      }

      edgesById.set(relationship.relationshipId, {
        relationshipId: relationship.relationshipId,
        type: relationship.type,
        status: relationship.status,
        fromPersonId: relationship.fromPerson.entityId,
        toPersonId: relationship.toPerson.entityId,
      })
    }
  }

  return {
    rootPersonId,
    maxDepth,
    maxNodes,
    truncated,
    nodes: [...nodesById.values()].sort(
      (left, right) =>
        left.depth - right.depth ||
        left.person.nameLatin.localeCompare(right.person.nameLatin) ||
        left.person.entityId.localeCompare(right.person.entityId),
    ),
    edges: [...edgesById.values()].sort(
      (left, right) =>
        left.type.localeCompare(right.type) ||
        left.fromPersonId.localeCompare(right.fromPersonId) ||
        left.toPersonId.localeCompare(right.toPersonId),
    ),
  }
}

function boundedInteger(
  value: number,
  field: string,
  minimum: number,
  maximum: number,
): number {
  const integer = Math.trunc(value)

  if (!Number.isFinite(value) || integer < minimum || integer > maximum) {
    throw new PeopleInputError(
      `${field} must be an integer between ${minimum} and ${maximum}.`,
    )
  }

  return integer
}

function prepareRelationshipTypes(
  requested: PersonRelationshipType[] | undefined,
): Set<PersonRelationshipType> {
  const relationshipTypes = requested ?? [...personRelationshipTypes]

  if (
    relationshipTypes.length === 0 ||
    relationshipTypes.some((type) => !personRelationshipTypes.includes(type))
  ) {
    throw new PeopleInputError(
      "relationshipTypes must contain supported relationship types.",
    )
  }

  return new Set(relationshipTypes)
}

function prepareStatuses(
  requested: AssertionStatus[] | undefined,
): Set<AssertionStatus> {
  const statuses = requested ?? ["accepted", "uncertain", "disputed"]

  if (
    statuses.length === 0 ||
    statuses.some((status) => !assertionStatuses.includes(status))
  ) {
    throw new PeopleInputError(
      "statuses must contain accepted, uncertain, disputed, or retracted.",
    )
  }

  return new Set(statuses)
}
