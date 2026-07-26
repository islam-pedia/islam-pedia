import { asc, eq } from "drizzle-orm"
import { getDatabase } from "@/db/client"
import {
  entities,
  entityEvidence,
  entityStatusChanges,
  people,
  sourcePassages,
  sources,
} from "@/db/schema"
import type {
  EvidenceLocatorInput,
  GetPersonEvidenceResult,
} from "../shared/types"

export async function getPersonEvidence(
  entityId: string,
): Promise<GetPersonEvidenceResult | null> {
  const database = getDatabase()
  const [person] = await database
    .select({ entityId: entities.id })
    .from(entities)
    .innerJoin(people, eq(people.entityId, entities.id))
    .where(eq(entities.id, entityId))
    .limit(1)

  if (!person) {
    return null
  }

  const [evidenceRows, statusRows] = await Promise.all([
    database
      .select({
        evidenceId: entityEvidence.id,
        assertion: entityEvidence.assertion,
        interpretation: entityEvidence.interpretation,
        status: entityEvidence.status,
        notes: entityEvidence.notes,
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
        language: sourcePassages.language,
        locator: sourcePassages.locator,
        createdAt: entityEvidence.createdAt,
      })
      .from(entityEvidence)
      .innerJoin(
        sourcePassages,
        eq(sourcePassages.id, entityEvidence.passageId),
      )
      .innerJoin(sources, eq(sources.id, sourcePassages.sourceId))
      .where(eq(entityEvidence.entityId, entityId))
      .orderBy(asc(entityEvidence.createdAt), asc(entityEvidence.id)),
    database
      .select({
        statusChangeId: entityStatusChanges.id,
        fromStatus: entityStatusChanges.fromStatus,
        toStatus: entityStatusChanges.toStatus,
        reason: entityStatusChanges.reason,
        runId: entityStatusChanges.createdByRunId,
        createdAt: entityStatusChanges.createdAt,
      })
      .from(entityStatusChanges)
      .where(eq(entityStatusChanges.entityId, entityId))
      .orderBy(asc(entityStatusChanges.createdAt), asc(entityStatusChanges.id)),
  ])

  return {
    entityId,
    evidence: evidenceRows.map((row) => ({
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
        language: row.language,
        locator: row.locator as EvidenceLocatorInput,
      },
      createdAt: row.createdAt.toISOString(),
    })),
    statusHistory: statusRows.map((row) => ({
      statusChangeId: row.statusChangeId,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      reason: row.reason,
      runId: row.runId,
      createdAt: row.createdAt.toISOString(),
    })),
  }
}
