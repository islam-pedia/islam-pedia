import { eq, inArray, or } from "drizzle-orm"
import { getDatabase } from "@/db/client"
import {
  people,
  personEncounterAssertions,
  personEncounterEvidence,
  personEncounterStatusChanges,
  sourcePassages,
  sources,
} from "@/db/schema"
import type {
  GetPersonEncountersResult,
  PersonAssertionStatusChangeView,
  PersonEncounterAssertionView,
  PersonEncounterView,
  PersonRelationshipEvidenceView,
  RelatedPersonView,
} from "../shared/types"

export async function getPersonEncounters(
  personId: string,
): Promise<GetPersonEncountersResult | null> {
  const database = getDatabase()
  const [person] = await database
    .select({ personId: people.entityId })
    .from(people)
    .where(eq(people.entityId, personId))
    .limit(1)

  if (!person) {
    return null
  }

  const assertions = await database
    .select()
    .from(personEncounterAssertions)
    .where(
      or(
        eq(personEncounterAssertions.firstPersonId, personId),
        eq(personEncounterAssertions.secondPersonId, personId),
      ),
    )
    .orderBy(personEncounterAssertions.createdAt, personEncounterAssertions.id)

  if (assertions.length === 0) {
    return { personId, encounters: [] }
  }

  const hydrated = await hydrateEncounterAssertions(assertions)
  const byOtherPerson = new Map<string, PersonEncounterAssertionView[]>()

  for (const assertion of hydrated) {
    const otherPerson =
      assertion.firstPerson.entityId === personId
        ? assertion.secondPerson
        : assertion.firstPerson
    const grouped = byOtherPerson.get(otherPerson.entityId) ?? []
    grouped.push(assertion)
    byOtherPerson.set(otherPerson.entityId, grouped)
  }

  const encounters: PersonEncounterView[] = []

  for (const assertionsForPair of byOtherPerson.values()) {
    const first = assertionsForPair[0]

    if (!first) {
      continue
    }

    const otherPerson =
      first.firstPerson.entityId === personId
        ? first.secondPerson
        : first.firstPerson
    const accepted = assertionsForPair.find(
      ({ status }) => status === "accepted",
    )
    encounters.push({
      otherPerson,
      conclusion: accepted?.outcome ?? "unknown",
      assertions: assertionsForPair,
    })
  }

  encounters.sort((left, right) =>
    left.otherPerson.nameLatin.localeCompare(right.otherPerson.nameLatin),
  )
  return { personId, encounters }
}

async function hydrateEncounterAssertions(
  assertions: Array<typeof personEncounterAssertions.$inferSelect>,
): Promise<PersonEncounterAssertionView[]> {
  const database = getDatabase()
  const assertionIds = assertions.map(({ id }) => id)
  const personIds = [
    ...new Set(
      assertions.flatMap(({ firstPersonId, secondPersonId }) => [
        firstPersonId,
        secondPersonId,
      ]),
    ),
  ]
  const personRows = await database
    .select({
      entityId: people.entityId,
      gender: people.gender,
      nameOriginal: people.nameOriginal,
      nameLatin: people.nameLatin,
    })
    .from(people)
    .where(inArray(people.entityId, personIds))
  const peopleById = new Map(
    personRows.map((person) => [person.entityId, person]),
  )
  const evidenceRows = await database
    .select({
      assertionId: personEncounterEvidence.assertionId,
      evidenceId: personEncounterEvidence.id,
      assertion: personEncounterEvidence.assertion,
      interpretation: personEncounterEvidence.interpretation,
      status: personEncounterEvidence.status,
      notes: personEncounterEvidence.notes,
      sourceId: sources.id,
      sourceCategory: sources.category,
      sourceLabel: sources.label,
      sourceUri: sources.uri,
      sourceAuthor: sources.author,
      sourceWorkTitle: sources.workTitle,
      sourceEdition: sources.edition,
      sourceMethodology: sources.methodology,
      sourceMethodologyBasis: sources.methodologyBasis,
      sourcePolicyVersion: sources.policyVersion,
      sourceVerification: sources.verification,
      passageId: sourcePassages.id,
      passage: sourcePassages.passage,
      passageLanguage: sourcePassages.language,
      passageLocator: sourcePassages.locator,
      createdAt: personEncounterEvidence.createdAt,
    })
    .from(personEncounterEvidence)
    .innerJoin(
      sourcePassages,
      eq(sourcePassages.id, personEncounterEvidence.passageId),
    )
    .innerJoin(sources, eq(sources.id, sourcePassages.sourceId))
    .where(inArray(personEncounterEvidence.assertionId, assertionIds))
    .orderBy(
      personEncounterEvidence.assertionId,
      personEncounterEvidence.createdAt,
      personEncounterEvidence.id,
    )
  const statusRows = await database
    .select({
      assertionId: personEncounterStatusChanges.assertionId,
      statusChangeId: personEncounterStatusChanges.id,
      fromStatus: personEncounterStatusChanges.fromStatus,
      toStatus: personEncounterStatusChanges.toStatus,
      reason: personEncounterStatusChanges.reason,
      runId: personEncounterStatusChanges.createdByRunId,
      createdAt: personEncounterStatusChanges.createdAt,
    })
    .from(personEncounterStatusChanges)
    .where(inArray(personEncounterStatusChanges.assertionId, assertionIds))
    .orderBy(
      personEncounterStatusChanges.assertionId,
      personEncounterStatusChanges.createdAt,
      personEncounterStatusChanges.id,
    )
  const evidenceByAssertion = new Map<
    string,
    PersonRelationshipEvidenceView[]
  >()
  const statusByAssertion = new Map<string, PersonAssertionStatusChangeView[]>()

  for (const row of evidenceRows) {
    const evidence = evidenceByAssertion.get(row.assertionId) ?? []
    evidence.push({
      evidenceId: row.evidenceId,
      assertion: row.assertion,
      interpretation: row.interpretation,
      status: row.status,
      notes: row.notes,
      source: {
        sourceId: row.sourceId,
        category: row.sourceCategory,
        label: row.sourceLabel,
        uri: row.sourceUri,
        author: row.sourceAuthor,
        workTitle: row.sourceWorkTitle,
        edition: row.sourceEdition,
        methodology: row.sourceMethodology,
        methodologyBasis: row.sourceMethodologyBasis,
        policyVersion: row.sourcePolicyVersion,
        verification: row.sourceVerification,
      },
      passage: {
        passageId: row.passageId,
        text: row.passage,
        language: row.passageLanguage,
        locator: row.passageLocator,
      },
      createdAt: row.createdAt.toISOString(),
    })
    evidenceByAssertion.set(row.assertionId, evidence)
  }

  for (const { assertionId, createdAt, ...row } of statusRows) {
    const history = statusByAssertion.get(assertionId) ?? []
    history.push({ ...row, createdAt: createdAt.toISOString() })
    statusByAssertion.set(assertionId, history)
  }

  return assertions.map((assertion) => ({
    assertionId: assertion.id,
    outcome: assertion.outcome,
    status: assertion.status,
    firstPerson: requireRelatedPerson(
      peopleById.get(assertion.firstPersonId),
      assertion.firstPersonId,
    ),
    secondPerson: requireRelatedPerson(
      peopleById.get(assertion.secondPersonId),
      assertion.secondPersonId,
    ),
    evidence: evidenceByAssertion.get(assertion.id) ?? [],
    statusHistory: statusByAssertion.get(assertion.id) ?? [],
    createdAt: assertion.createdAt.toISOString(),
    updatedAt: assertion.updatedAt.toISOString(),
  }))
}

function requireRelatedPerson(
  person: RelatedPersonView | undefined,
  personId: string,
): RelatedPersonView {
  if (!person) {
    throw new Error(`Encounter person "${personId}" was not found.`)
  }
  return person
}
