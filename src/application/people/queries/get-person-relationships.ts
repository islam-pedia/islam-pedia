import { eq, inArray, or } from "drizzle-orm"
import { getDatabase } from "@/db/client"
import {
  people,
  personRelationshipEvidence,
  personRelationshipStatusChanges,
  personRelationships,
  sourcePassages,
  sources,
} from "@/db/schema"
import { getPersonRelationshipLabel } from "@/domain/people/relationships"
import type {
  GetPersonRelationshipsResult,
  PersonRelationshipEvidenceView,
  PersonRelationshipStatusChangeView,
  PersonRelationshipView,
  RelatedPersonView,
} from "../shared/types"

export async function getPersonRelationships(
  entityId: string,
): Promise<GetPersonRelationshipsResult | null> {
  const database = getDatabase()
  const [personExists] = await database
    .select({ entityId: people.entityId })
    .from(people)
    .where(eq(people.entityId, entityId))
    .limit(1)

  if (!personExists) {
    return null
  }

  const relationships = await database
    .select()
    .from(personRelationships)
    .where(
      or(
        eq(personRelationships.fromPersonId, entityId),
        eq(personRelationships.toPersonId, entityId),
      ),
    )
    .orderBy(
      personRelationships.type,
      personRelationships.createdAt,
      personRelationships.id,
    )

  if (relationships.length === 0) {
    return { entityId, relationships: [] }
  }

  return {
    entityId,
    relationships: await hydratePersonRelationshipRows(relationships, entityId),
  }
}

export async function hydratePersonRelationshipRows(
  relationships: Array<typeof personRelationships.$inferSelect>,
  perspectivePersonId?: string,
): Promise<PersonRelationshipView[]> {
  if (relationships.length === 0) {
    return []
  }

  const database = getDatabase()
  const relationshipIds = relationships.map(({ id }) => id)
  const personIds = [
    ...new Set(
      relationships.flatMap(({ fromPersonId, toPersonId }) => [
        fromPersonId,
        toPersonId,
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
      relationshipId: personRelationshipEvidence.relationshipId,
      evidenceId: personRelationshipEvidence.id,
      assertion: personRelationshipEvidence.assertion,
      interpretation: personRelationshipEvidence.interpretation,
      status: personRelationshipEvidence.status,
      notes: personRelationshipEvidence.notes,
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
      createdAt: personRelationshipEvidence.createdAt,
    })
    .from(personRelationshipEvidence)
    .innerJoin(
      sourcePassages,
      eq(sourcePassages.id, personRelationshipEvidence.passageId),
    )
    .innerJoin(sources, eq(sources.id, sourcePassages.sourceId))
    .where(inArray(personRelationshipEvidence.relationshipId, relationshipIds))
    .orderBy(
      personRelationshipEvidence.relationshipId,
      personRelationshipEvidence.createdAt,
      personRelationshipEvidence.id,
    )
  const statusRows = await database
    .select({
      relationshipId: personRelationshipStatusChanges.relationshipId,
      statusChangeId: personRelationshipStatusChanges.id,
      fromStatus: personRelationshipStatusChanges.fromStatus,
      toStatus: personRelationshipStatusChanges.toStatus,
      reason: personRelationshipStatusChanges.reason,
      runId: personRelationshipStatusChanges.createdByRunId,
      createdAt: personRelationshipStatusChanges.createdAt,
    })
    .from(personRelationshipStatusChanges)
    .where(
      inArray(personRelationshipStatusChanges.relationshipId, relationshipIds),
    )
    .orderBy(
      personRelationshipStatusChanges.relationshipId,
      personRelationshipStatusChanges.createdAt,
      personRelationshipStatusChanges.id,
    )
  const evidenceByRelationship = new Map<
    string,
    PersonRelationshipEvidenceView[]
  >()
  const statusByRelationship = new Map<
    string,
    PersonRelationshipStatusChangeView[]
  >()

  for (const row of evidenceRows) {
    const evidence = evidenceByRelationship.get(row.relationshipId) ?? []
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
    evidenceByRelationship.set(row.relationshipId, evidence)
  }

  for (const { relationshipId, createdAt, ...row } of statusRows) {
    const history = statusByRelationship.get(relationshipId) ?? []
    history.push({ ...row, createdAt: createdAt.toISOString() })
    statusByRelationship.set(relationshipId, history)
  }

  return relationships.map((relationship) => {
    const fromPerson = requireRelatedPerson(
      peopleById.get(relationship.fromPersonId),
      relationship.fromPersonId,
    )
    const toPerson = requireRelatedPerson(
      peopleById.get(relationship.toPersonId),
      relationship.toPersonId,
    )
    const direction =
      perspectivePersonId === undefined ||
      relationship.fromPersonId === perspectivePersonId
        ? "outgoing"
        : "incoming"
    const relatedPerson = direction === "outgoing" ? toPerson : fromPerson

    return {
      relationshipId: relationship.id,
      type: relationship.type,
      status: relationship.status,
      direction,
      label: getPersonRelationshipLabel(
        relationship.type,
        direction,
        relatedPerson.gender,
      ),
      fromPerson,
      toPerson,
      relatedPerson,
      evidence: evidenceByRelationship.get(relationship.id) ?? [],
      statusHistory: statusByRelationship.get(relationship.id) ?? [],
      createdAt: relationship.createdAt.toISOString(),
      updatedAt: relationship.updatedAt.toISOString(),
    }
  })
}

function requireRelatedPerson(
  person: RelatedPersonView | undefined,
  entityId: string,
): RelatedPersonView {
  if (!person) {
    throw new Error(`Related person "${entityId}" was not found.`)
  }

  return person
}
