import { eq } from "drizzle-orm"
import { getDatabase } from "@/db/client"
import { ingestionRuns } from "@/db/schema"
import { personRelationshipTypes } from "@/domain/people/relationships"
import { getPerson } from "../queries/get-person"
import { PeopleInputError } from "../shared/errors"
import { prepareEvidence } from "../shared/evidence"
import {
  assertMatchingIdempotentRequest,
  hashRequest,
  preparePerson,
  requireCleanText,
} from "../shared/helpers"
import type {
  ImportedPersonView,
  ImportFamilyBranchInput,
  ImportFamilyBranchResult,
} from "../shared/types"
import { addPersonRelationship } from "./add-person-relationship"
import { importPeople } from "./import-people"

const assertionStatuses = [
  "accepted",
  "uncertain",
  "disputed",
  "retracted",
] as const

export async function importFamilyBranch(
  input: ImportFamilyBranchInput,
): Promise<ImportFamilyBranchResult> {
  const operationKey = requireCleanText(input.operationKey, "operationKey", 240)
  const rootPersonId = requireCleanText(input.rootPersonId, "rootPersonId", 100)

  if (input.members.length === 0 || input.members.length > 200) {
    throw new PeopleInputError(
      "members must contain between 1 and 200 family members.",
    )
  }

  const instruction = input.instruction
    ? requireCleanText(input.instruction, "instruction", 5_000)
    : undefined
  const sourceLabel = input.source?.label
    ? requireCleanText(input.source.label, "source.label", 500)
    : undefined
  const sourceUri = prepareOptionalUri(input.source?.uri)
  const rootPerson = await getPerson(rootPersonId)

  if (!rootPerson) {
    throw new PeopleInputError(`Person "${rootPersonId}" was not found.`)
  }

  if (rootPerson.status === "merged") {
    throw new PeopleInputError(
      `Person "${rootPersonId}" was merged into "${rootPerson.mergedIntoEntityId}".`,
    )
  }

  const preparedMembers = input.members.map((member, index) => {
    const hasExistingPerson =
      typeof member.existingPersonId === "string" &&
      member.existingPersonId.trim().length > 0
    const hasNewPerson = member.person !== undefined

    if (hasExistingPerson === hasNewPerson) {
      throw new PeopleInputError(
        `members[${index}] must provide exactly one of existingPersonId or person.`,
      )
    }

    if (!personRelationshipTypes.includes(member.relationship.type)) {
      throw new PeopleInputError(
        `Unsupported relationship type for members[${index}].`,
      )
    }

    if (
      member.relationship.direction !== "outgoing" &&
      member.relationship.direction !== "incoming"
    ) {
      throw new PeopleInputError(
        `members[${index}].relationship.direction must be outgoing or incoming.`,
      )
    }

    if (!assertionStatuses.includes(member.relationship.status)) {
      throw new PeopleInputError(
        `Unsupported relationship status for members[${index}].`,
      )
    }

    if (
      member.relationship.evidence.length === 0 ||
      member.relationship.evidence.length > 20
    ) {
      throw new PeopleInputError(
        `members[${index}].relationship.evidence must contain between 1 and 20 source passages.`,
      )
    }

    const preparedEvidence = member.relationship.evidence.map(
      (evidence, evidenceIndex) => prepareEvidence(evidence, evidenceIndex),
    )

    if (member.relationship.status === "accepted") {
      for (const [evidenceIndex, evidence] of preparedEvidence.entries()) {
        if (evidence.interpretation !== "explicit") {
          throw new PeopleInputError(
            `members[${index}].relationship.evidence[${evidenceIndex}].interpretation must be explicit for an accepted relationship.`,
          )
        }

        if (evidence.source.category === "context_only") {
          throw new PeopleInputError(
            `members[${index}].relationship.evidence[${evidenceIndex}] cannot use context_only for an accepted relationship.`,
          )
        }
      }
    }

    if (member.person) {
      preparePerson(member.person)
    }

    return {
      ...member,
      existingPersonId: hasExistingPerson
        ? requireCleanText(
            member.existingPersonId ?? "",
            `members[${index}].existingPersonId`,
            100,
          )
        : undefined,
      relationship: {
        ...member.relationship,
        reason: requireCleanText(
          member.relationship.reason,
          `members[${index}].relationship.reason`,
          5_000,
        ),
      },
    }
  })
  const existingPersonByMemberIndex = new Map<number, ImportedPersonView>()

  await Promise.all(
    preparedMembers.map(async (member, index) => {
      if (!member.existingPersonId) {
        return
      }

      existingPersonByMemberIndex.set(
        index,
        await getExistingPerson(member, index),
      )
    }),
  )

  for (const [index, member] of preparedMembers.entries()) {
    const existingPerson = existingPersonByMemberIndex.get(index)
    const memberGender =
      existingPerson?.gender ?? member.person?.gender ?? "unknown"
    const fromGender =
      member.relationship.direction === "outgoing"
        ? rootPerson.gender
        : memberGender
    const toGender =
      member.relationship.direction === "outgoing"
        ? memberGender
        : rootPerson.gender

    if (member.existingPersonId === rootPersonId) {
      throw new PeopleInputError(
        `members[${index}] cannot relate the root person to itself.`,
      )
    }

    if (
      member.relationship.type === "husband_of" &&
      (fromGender !== "male" || toGender !== "female")
    ) {
      throw new PeopleInputError(
        `members[${index}] husband_of requires the canonical from person to be male and the to person to be female.`,
      )
    }
  }

  const requestHash = hashRequest({
    operation: "import_family_branch",
    rootPersonId,
    instruction,
    sourceLabel,
    sourceUri,
    members: preparedMembers,
  })
  const workflow = await registerWorkflow({
    operationKey,
    requestHash,
    rootPersonId,
    instruction,
    sourceLabel,
    sourceUri,
    memberCount: preparedMembers.length,
  })
  const newMemberIndexes = preparedMembers.flatMap((member, index) =>
    member.person ? [index] : [],
  )
  const peopleImport =
    newMemberIndexes.length === 0
      ? null
      : await importPeople({
          batchKey: `${operationKey}:people`,
          instruction,
          source: {
            label: sourceLabel,
            uri: sourceUri,
          },
          people: newMemberIndexes.map((index) => {
            const person = preparedMembers[index]?.person

            if (!person) {
              throw new Error(`Prepared family member ${index} is missing.`)
            }

            return person
          }),
        })
  const importedPersonByMemberIndex = new Map<number, ImportedPersonView>()

  for (const [importIndex, memberIndex] of newMemberIndexes.entries()) {
    const person = peopleImport?.people[importIndex]

    if (!person) {
      throw new Error(
        `Family branch import did not return person for member ${memberIndex}.`,
      )
    }

    importedPersonByMemberIndex.set(memberIndex, person)
  }

  const members: ImportFamilyBranchResult["members"] = []

  for (const [index, member] of preparedMembers.entries()) {
    const createdPerson = importedPersonByMemberIndex.get(index)
    const person = createdPerson ?? existingPersonByMemberIndex.get(index)

    if (!person) {
      throw new Error(`Prepared family member ${index} has no person.`)
    }

    const fromPersonId =
      member.relationship.direction === "outgoing"
        ? rootPersonId
        : person.entityId
    const toPersonId =
      member.relationship.direction === "outgoing"
        ? person.entityId
        : rootPersonId
    const relationship = await addPersonRelationship({
      operationKey: `${operationKey}:relationship:${index}`,
      fromPersonId,
      toPersonId,
      type: member.relationship.type,
      status: member.relationship.status,
      reason: member.relationship.reason,
      instruction,
      evidence: member.relationship.evidence,
    })

    members.push({
      index,
      created: createdPerson !== undefined,
      person,
      relationship,
    })
  }

  return {
    runId: workflow.runId,
    replayed: workflow.replayed,
    rootPersonId,
    peopleRunId: peopleImport?.runId ?? null,
    members,
  }
}

interface WorkflowInput {
  operationKey: string
  requestHash: string
  rootPersonId: string
  instruction?: string
  sourceLabel?: string
  sourceUri?: string
  memberCount: number
}

async function registerWorkflow(
  input: WorkflowInput,
): Promise<{ runId: string; replayed: boolean }> {
  const database = getDatabase()

  return database.transaction(async (transaction) => {
    const [existingRun] = await transaction
      .select()
      .from(ingestionRuns)
      .where(eq(ingestionRuns.idempotencyKey, input.operationKey))
      .limit(1)

    if (existingRun) {
      assertMatchingIdempotentRequest(
        existingRun.metadata,
        input.requestHash,
        input.operationKey,
      )

      return { runId: existingRun.id, replayed: true }
    }

    const [run] = await transaction
      .insert(ingestionRuns)
      .values({
        idempotencyKey: input.operationKey,
        instruction: input.instruction,
        sourceLabel: input.sourceLabel,
        sourceUri: input.sourceUri,
        metadata: {
          operation: "import_family_branch",
          requestHash: input.requestHash,
          rootPersonId: input.rootPersonId,
          memberCount: input.memberCount,
        },
      })
      .returning({ id: ingestionRuns.id })

    if (!run) {
      throw new Error("Failed to create family branch workflow run.")
    }

    return { runId: run.id, replayed: false }
  })
}

async function getExistingPerson(
  member: ImportFamilyBranchInput["members"][number],
  index: number,
): Promise<ImportedPersonView> {
  const existingPersonId = member.existingPersonId

  if (!existingPersonId) {
    throw new Error(`Prepared family member ${index} has no person ID.`)
  }

  const person = await getPerson(existingPersonId)

  if (!person) {
    throw new PeopleInputError(
      `Person "${existingPersonId}" for members[${index}] was not found.`,
    )
  }

  if (person.status === "merged") {
    throw new PeopleInputError(
      `Person "${existingPersonId}" for members[${index}] was merged into "${person.mergedIntoEntityId}".`,
    )
  }

  return { ...person, duplicateCandidateIds: [] }
}

function prepareOptionalUri(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }

  const uri = value.trim()

  if (!uri) {
    throw new PeopleInputError("source.uri must not be blank when provided.")
  }

  if (uri.length > 2_000) {
    throw new PeopleInputError(
      "source.uri must contain at most 2000 characters.",
    )
  }

  return uri
}
