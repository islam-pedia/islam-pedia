import { PeopleInputError } from "../shared/errors"
import { requireCleanText } from "../shared/helpers"
import type {
  AssertionStatus,
  AuditFamilyFactsInput,
  AuditFamilyFactsResult,
  ExtendedFamilyRole,
  FamilyFactDerivationPath,
  FamilySide,
  PersonGender,
  PersonRelationshipView,
  PersonView,
} from "../shared/types"
import { getPerson } from "./get-person"
import { getPersonFactsBatch } from "./get-person-facts-batch"
import { getPersonRelationships } from "./get-person-relationships"

const allSides = ["paternal", "maternal", "unknown"] as const
const allStatuses = ["accepted", "uncertain", "disputed", "retracted"] as const
const allRoles = [
  "paternal_uncle",
  "paternal_aunt",
  "paternal_parent_sibling",
  "maternal_uncle",
  "maternal_aunt",
  "maternal_parent_sibling",
  "unknown_side_uncle",
  "unknown_side_aunt",
  "unknown_side_parent_sibling",
  "paternal_cousin",
  "maternal_cousin",
  "unknown_side_cousin",
] as const satisfies readonly ExtendedFamilyRole[]

interface DerivedMember {
  role: ExtendedFamilyRole
  person: PersonView
  derivationPaths: FamilyFactDerivationPath[]
}

export async function auditFamilyFacts(
  input: AuditFamilyFactsInput,
): Promise<AuditFamilyFactsResult | null> {
  const rootPersonId = requireCleanText(input.rootPersonId, "rootPersonId", 100)
  const sides = prepareSides(input.sides)
  const relationshipStatuses = prepareStatuses(input.relationshipStatuses)
  const rootPerson = await getPerson(rootPersonId)

  if (!rootPerson) {
    return null
  }

  const statusSet = new Set(relationshipStatuses)
  const sideSet = new Set(sides)
  const rootParentRelationships = await biologicalRelationships(
    rootPersonId,
    "incoming",
    statusSet,
  )
  const membersById = new Map<string, DerivedMember>()

  for (const rootParentRelationship of rootParentRelationships) {
    const parent = rootParentRelationship.relatedPerson
    const side = sideFromGender(parent.gender)

    if (!sideSet.has(side)) {
      continue
    }

    const grandparentRelationships = await biologicalRelationships(
      parent.entityId,
      "incoming",
      statusSet,
    )

    for (const grandparentRelationship of grandparentRelationships) {
      const siblingRelationships = await biologicalRelationships(
        grandparentRelationship.relatedPerson.entityId,
        "outgoing",
        statusSet,
      )

      for (const siblingRelationship of siblingRelationships) {
        const siblingId = siblingRelationship.relatedPerson.entityId

        if (
          siblingId === parent.entityId ||
          siblingId === rootPersonId ||
          rootParentRelationships.some(
            ({ relatedPerson }) => relatedPerson.entityId === siblingId,
          )
        ) {
          continue
        }

        const sibling = await getPerson(siblingId)

        if (!sibling) {
          continue
        }

        const parentSiblingPath = makePath(side, [
          rootParentRelationship,
          grandparentRelationship,
          siblingRelationship,
        ])
        addDerivedMember(
          membersById,
          sibling,
          parentSiblingRole(side, sibling.gender),
          parentSiblingPath,
        )

        const cousinRelationships = await biologicalRelationships(
          siblingId,
          "outgoing",
          statusSet,
        )

        for (const cousinRelationship of cousinRelationships) {
          const cousinId = cousinRelationship.relatedPerson.entityId

          if (cousinId === rootPersonId) {
            continue
          }

          const cousin = await getPerson(cousinId)

          if (!cousin) {
            continue
          }

          addDerivedMember(
            membersById,
            cousin,
            cousinRole(side),
            makePath(side, [
              rootParentRelationship,
              grandparentRelationship,
              siblingRelationship,
              cousinRelationship,
            ]),
          )
        }
      }
    }
  }

  const derivedMembers = [...membersById.values()]
  const factsByPersonId = new Map<
    string,
    Awaited<ReturnType<typeof getPersonFactsBatch>>["items"][number]
  >()

  for (let index = 0; index < derivedMembers.length; index += 100) {
    const batch = derivedMembers.slice(index, index + 100)
    const facts = await getPersonFactsBatch({
      personIds: batch.map(({ person }) => person.entityId),
      encounterWithPersonId: rootPersonId,
    })

    for (const item of facts.items) {
      factsByPersonId.set(item.personId, item)
    }
  }

  const members: AuditFamilyFactsResult["members"] = derivedMembers
    .map((member) => {
      const facts = factsByPersonId.get(member.person.entityId)

      if (!facts?.religionAtDeath || !facts.encounterWith) {
        throw new Error(
          `Facts were not loaded for family member "${member.person.entityId}".`,
        )
      }

      return {
        ...member,
        religionAtDeath: facts.religionAtDeath,
        encounterWithRoot: {
          conclusion: facts.encounterWith.conclusion,
          assertions: facts.encounterWith.assertions,
        },
      }
    })
    .sort(
      (left, right) =>
        left.role.localeCompare(right.role) ||
        left.person.nameLatin.localeCompare(right.person.nameLatin),
    )
  const byRole = Object.fromEntries(
    allRoles.map((role) => [
      role,
      members.filter((member) => member.role === role).length,
    ]),
  ) as Record<ExtendedFamilyRole, number>
  const religionKnown = members.filter(
    ({ religionAtDeath }) => religionAtDeath.conclusion !== "unknown",
  ).length
  const encounterKnown = members.filter(
    ({ encounterWithRoot }) => encounterWithRoot.conclusion !== "unknown",
  ).length

  return {
    rootPerson,
    sides,
    relationshipStatuses,
    summary: {
      totalMembers: members.length,
      byRole,
      religionKnown,
      religionUnknown: members.length - religionKnown,
      encounterKnown,
      encounterUnknown: members.length - encounterKnown,
    },
    members,
  }
}

async function biologicalRelationships(
  personId: string,
  direction: "incoming" | "outgoing",
  statuses: Set<AssertionStatus>,
): Promise<PersonRelationshipView[]> {
  const result = await getPersonRelationships(personId)
  return (
    result?.relationships.filter(
      (relationship) =>
        relationship.type === "biological_parent_of" &&
        relationship.direction === direction &&
        statuses.has(relationship.status),
    ) ?? []
  )
}

function addDerivedMember(
  membersById: Map<string, DerivedMember>,
  person: PersonView,
  role: ExtendedFamilyRole,
  path: FamilyFactDerivationPath,
): void {
  const existing = membersById.get(person.entityId)

  if (!existing) {
    membersById.set(person.entityId, {
      role,
      person,
      derivationPaths: [path],
    })
    return
  }

  if (
    !existing.derivationPaths.some(
      ({ relationshipIds }) =>
        relationshipIds.join("\u0000") === path.relationshipIds.join("\u0000"),
    )
  ) {
    existing.derivationPaths.push(path)
  }
}

function makePath(
  side: FamilySide,
  relationships: PersonRelationshipView[],
): FamilyFactDerivationPath {
  return {
    side,
    relationshipIds: relationships.map(({ relationshipId }) => relationshipId),
    relationshipStatuses: relationships.map(({ status }) => status),
  }
}

function sideFromGender(gender: PersonGender): FamilySide {
  if (gender === "male") return "paternal"
  if (gender === "female") return "maternal"
  return "unknown"
}

function parentSiblingRole(
  side: FamilySide,
  gender: PersonGender,
): ExtendedFamilyRole {
  if (side === "paternal") {
    if (gender === "male") return "paternal_uncle"
    if (gender === "female") return "paternal_aunt"
    return "paternal_parent_sibling"
  }

  if (side === "maternal") {
    if (gender === "male") return "maternal_uncle"
    if (gender === "female") return "maternal_aunt"
    return "maternal_parent_sibling"
  }

  if (gender === "male") return "unknown_side_uncle"
  if (gender === "female") return "unknown_side_aunt"
  return "unknown_side_parent_sibling"
}

function cousinRole(side: FamilySide): ExtendedFamilyRole {
  if (side === "paternal") return "paternal_cousin"
  if (side === "maternal") return "maternal_cousin"
  return "unknown_side_cousin"
}

function prepareSides(requested: FamilySide[] | undefined): FamilySide[] {
  const sides = requested ?? [...allSides]

  if (sides.length === 0 || sides.some((side) => !allSides.includes(side))) {
    throw new PeopleInputError(
      "sides must contain paternal, maternal, or unknown.",
    )
  }

  return [...new Set(sides)]
}

function prepareStatuses(
  requested: AssertionStatus[] | undefined,
): AssertionStatus[] {
  const statuses = requested ?? ["accepted", "uncertain", "disputed"]

  if (
    statuses.length === 0 ||
    statuses.some((status) => !allStatuses.includes(status))
  ) {
    throw new PeopleInputError(
      "relationshipStatuses must contain accepted, uncertain, disputed, or retracted.",
    )
  }

  return [...new Set(statuses)]
}
