import type { getDatabase } from "@/db/client"
import { sourcePassages, sources } from "@/db/schema"
import {
  hadithGrades,
  SOURCE_POLICY_VERSION,
  type SourceVerification,
  sourceCategories,
} from "@/domain/evidence/source-policy"
import { cleanDisplayText } from "@/domain/people/normalization"
import { PeopleInputError } from "./errors"
import { requireCleanText } from "./helpers"
import type {
  ActivatePersonEvidenceInput,
  AssertionStatus,
  EvidenceLocatorInput,
} from "./types"

export interface PreparedEvidence {
  source: {
    category: (typeof sourceCategories)[number]
    label: string
    uri?: string
    author?: string
    workTitle?: string
    edition?: string
    methodologyBasis: string
    verification: SourceVerification
  }
  passage: string
  language?: string
  locator: EvidenceLocatorInput
  assertion: string
  interpretation: "explicit" | "inferred"
  notes?: string
}

export function prepareEvidence(
  evidence: ActivatePersonEvidenceInput,
  index: number,
): PreparedEvidence {
  if (
    !sourceCategories.some((category) => category === evidence.source.category)
  ) {
    throw new PeopleInputError(`evidence[${index}].source.category is invalid.`)
  }

  if (
    evidence.interpretation !== "explicit" &&
    evidence.interpretation !== "inferred"
  ) {
    throw new PeopleInputError(
      `evidence[${index}].interpretation must be explicit or inferred.`,
    )
  }

  return {
    source: {
      category: evidence.source.category,
      label: requireCleanText(
        evidence.source.label,
        `evidence[${index}].source.label`,
        500,
      ),
      uri: cleanOptionalUri(
        evidence.source.uri,
        `evidence[${index}].source.uri`,
      ),
      author: cleanOptionalText(
        evidence.source.author,
        `evidence[${index}].source.author`,
        500,
      ),
      workTitle: cleanOptionalText(
        evidence.source.workTitle,
        `evidence[${index}].source.workTitle`,
        500,
      ),
      edition: cleanOptionalText(
        evidence.source.edition,
        `evidence[${index}].source.edition`,
        500,
      ),
      methodologyBasis: requireCleanText(
        evidence.source.methodologyBasis,
        `evidence[${index}].source.methodologyBasis`,
        5_000,
      ),
      verification: prepareVerification(evidence.source.verification, index),
    },
    passage: requireCleanText(
      evidence.passage,
      `evidence[${index}].passage`,
      20_000,
    ),
    language: cleanOptionalText(
      evidence.language,
      `evidence[${index}].language`,
      100,
    ),
    locator: prepareLocator(evidence.locator, index),
    assertion: requireCleanText(
      evidence.assertion,
      `evidence[${index}].assertion`,
      5_000,
    ),
    interpretation: evidence.interpretation,
    notes: cleanOptionalText(evidence.notes, `evidence[${index}].notes`, 5_000),
  }
}

export function getEvidenceSourceSummary(evidence: PreparedEvidence[]): {
  sourceLabel: string
  sourceUri?: string
} {
  const labels = [...new Set(evidence.map(({ source }) => source.label))]
  const uris = [
    ...new Set(
      evidence
        .map(({ source }) => source.uri)
        .filter((uri): uri is string => uri !== undefined),
    ),
  ]

  return {
    sourceLabel:
      labels.length === 1 ? (labels[0] ?? "") : `${labels.length} sources`,
    sourceUri: uris.length === 1 ? uris[0] : undefined,
  }
}

export function assertEvidenceSupportsAcceptedStatus(
  evidence: PreparedEvidence[],
  status: AssertionStatus,
  factLabel: string,
): void {
  if (status !== "accepted") {
    return
  }

  for (const [index, item] of evidence.entries()) {
    if (item.interpretation !== "explicit") {
      throw new PeopleInputError(
        `evidence[${index}].interpretation must be explicit for an accepted ${factLabel}.`,
      )
    }

    if (item.source.category === "context_only") {
      throw new PeopleInputError(
        `evidence[${index}].source.category context_only cannot establish an accepted ${factLabel}.`,
      )
    }
  }
}

type EvidenceTransaction = Parameters<
  Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]
>[0]

export async function insertEvidenceSourcePassage(
  transaction: EvidenceTransaction,
  evidence: PreparedEvidence,
  runId: string,
): Promise<{ sourceId: string; passageId: string }> {
  const [source] = await transaction
    .insert(sources)
    .values({
      ...evidence.source,
      methodology:
        evidence.source.category === "context_only"
          ? "context_only"
          : "salafiyyun",
      policyVersion: SOURCE_POLICY_VERSION,
      createdByRunId: runId,
    })
    .returning({ id: sources.id })

  if (!source) {
    throw new Error("Failed to create evidence source.")
  }

  const [passage] = await transaction
    .insert(sourcePassages)
    .values({
      sourceId: source.id,
      passage: evidence.passage,
      language: evidence.language,
      locator: evidence.locator,
      createdByRunId: runId,
    })
    .returning({ id: sourcePassages.id })

  if (!passage) {
    throw new Error("Failed to create source passage.")
  }

  return { sourceId: source.id, passageId: passage.id }
}

function prepareVerification(
  verification: SourceVerification | undefined,
  index: number,
): SourceVerification {
  if (!verification) {
    return {}
  }

  if (
    verification.hadithGrade !== undefined &&
    !hadithGrades.some((grade) => grade === verification.hadithGrade)
  ) {
    throw new PeopleInputError(
      `evidence[${index}].source.verification.hadithGrade is invalid.`,
    )
  }

  return {
    hadithGrade: verification.hadithGrade,
    gradedBy: cleanOptionalText(
      verification.gradedBy,
      `evidence[${index}].source.verification.gradedBy`,
      500,
    ),
    notes: cleanOptionalText(
      verification.notes,
      `evidence[${index}].source.verification.notes`,
      5_000,
    ),
  }
}

function cleanOptionalText(
  value: string | undefined,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) {
    return undefined
  }

  const cleaned = cleanDisplayText(value)

  if (!cleaned) {
    throw new PeopleInputError(`${field} must not be blank when provided.`)
  }

  if (cleaned.length > maxLength) {
    throw new PeopleInputError(
      `${field} must contain at most ${maxLength} characters.`,
    )
  }

  return cleaned
}

function cleanOptionalUri(
  value: string | undefined,
  field: string,
  maxLength = 2_000,
): string | undefined {
  if (value === undefined) {
    return undefined
  }

  const cleaned = value.trim()

  if (!cleaned) {
    throw new PeopleInputError(`${field} must not be blank when provided.`)
  }

  if (cleaned.length > maxLength) {
    throw new PeopleInputError(
      `${field} must contain at most ${maxLength} characters.`,
    )
  }

  return cleaned
}

function prepareLocator(
  locator: EvidenceLocatorInput | undefined,
  index: number,
): EvidenceLocatorInput {
  if (!locator) {
    return {}
  }

  return {
    volume: cleanOptionalText(
      locator.volume,
      `evidence[${index}].locator.volume`,
      100,
    ),
    page: cleanOptionalText(
      locator.page,
      `evidence[${index}].locator.page`,
      100,
    ),
    chapter: cleanOptionalText(
      locator.chapter,
      `evidence[${index}].locator.chapter`,
      500,
    ),
    verse: cleanOptionalText(
      locator.verse,
      `evidence[${index}].locator.verse`,
      100,
    ),
    hadithNumber: cleanOptionalText(
      locator.hadithNumber,
      `evidence[${index}].locator.hadithNumber`,
      100,
    ),
    section: cleanOptionalText(
      locator.section,
      `evidence[${index}].locator.section`,
      500,
    ),
    url: cleanOptionalUri(locator.url, `evidence[${index}].locator.url`),
  }
}
