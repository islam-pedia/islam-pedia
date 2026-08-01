import { eq, inArray } from "drizzle-orm"
import { getDatabase } from "@/db/client"
import {
  people,
  personReligionAtDeathAssertions,
  personReligionAtDeathEvidence,
  personReligionAtDeathStatusChanges,
  sourcePassages,
  sources,
} from "@/db/schema"
import type {
  GetPersonReligionAtDeathResult,
  PersonAssertionStatusChangeView,
  PersonRelationshipEvidenceView,
  PersonReligionAtDeathAssertionView,
} from "../shared/types"

export async function getPersonReligionAtDeath(
  personId: string,
): Promise<GetPersonReligionAtDeathResult | null> {
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
    .from(personReligionAtDeathAssertions)
    .where(eq(personReligionAtDeathAssertions.personId, personId))
    .orderBy(
      personReligionAtDeathAssertions.createdAt,
      personReligionAtDeathAssertions.id,
    )

  if (assertions.length === 0) {
    return { personId, conclusion: "unknown", assertions: [] }
  }

  const hydrated = await hydrateReligionAssertions(assertions)
  const accepted = hydrated.find(({ status }) => status === "accepted")

  return {
    personId,
    conclusion: accepted?.value ?? "unknown",
    assertions: hydrated,
  }
}

async function hydrateReligionAssertions(
  assertions: Array<typeof personReligionAtDeathAssertions.$inferSelect>,
): Promise<PersonReligionAtDeathAssertionView[]> {
  const database = getDatabase()
  const assertionIds = assertions.map(({ id }) => id)
  const evidenceRows = await database
    .select({
      assertionId: personReligionAtDeathEvidence.assertionId,
      evidenceId: personReligionAtDeathEvidence.id,
      assertion: personReligionAtDeathEvidence.assertion,
      interpretation: personReligionAtDeathEvidence.interpretation,
      status: personReligionAtDeathEvidence.status,
      notes: personReligionAtDeathEvidence.notes,
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
      createdAt: personReligionAtDeathEvidence.createdAt,
    })
    .from(personReligionAtDeathEvidence)
    .innerJoin(
      sourcePassages,
      eq(sourcePassages.id, personReligionAtDeathEvidence.passageId),
    )
    .innerJoin(sources, eq(sources.id, sourcePassages.sourceId))
    .where(inArray(personReligionAtDeathEvidence.assertionId, assertionIds))
    .orderBy(
      personReligionAtDeathEvidence.assertionId,
      personReligionAtDeathEvidence.createdAt,
      personReligionAtDeathEvidence.id,
    )
  const statusRows = await database
    .select({
      assertionId: personReligionAtDeathStatusChanges.assertionId,
      statusChangeId: personReligionAtDeathStatusChanges.id,
      fromStatus: personReligionAtDeathStatusChanges.fromStatus,
      toStatus: personReligionAtDeathStatusChanges.toStatus,
      reason: personReligionAtDeathStatusChanges.reason,
      runId: personReligionAtDeathStatusChanges.createdByRunId,
      createdAt: personReligionAtDeathStatusChanges.createdAt,
    })
    .from(personReligionAtDeathStatusChanges)
    .where(
      inArray(personReligionAtDeathStatusChanges.assertionId, assertionIds),
    )
    .orderBy(
      personReligionAtDeathStatusChanges.assertionId,
      personReligionAtDeathStatusChanges.createdAt,
      personReligionAtDeathStatusChanges.id,
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
    value: assertion.value,
    status: assertion.status,
    evidence: evidenceByAssertion.get(assertion.id) ?? [],
    statusHistory: statusByAssertion.get(assertion.id) ?? [],
    createdAt: assertion.createdAt.toISOString(),
    updatedAt: assertion.updatedAt.toISOString(),
  }))
}
