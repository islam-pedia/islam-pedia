import {
  cleanDisplayText,
  normalizeSearchText,
  prepareSearchTerms,
} from "@/domain/people/normalization"

import { IdempotencyConflictError, PeopleInputError } from "./errors"
import type {
  ImportedPersonView,
  PersonInput,
  PersonRow,
  PreparedPerson,
} from "./types"

export function requireCleanText(
  value: string,
  field: string,
  maxLength?: number,
): string {
  const cleaned = cleanDisplayText(value)

  if (!cleaned) {
    throw new PeopleInputError(`${field} must not be blank.`)
  }

  if (maxLength !== undefined && cleaned.length > maxLength) {
    throw new PeopleInputError(
      `${field} must contain at most ${maxLength} characters.`,
    )
  }

  return cleaned
}

export function preparePerson(input: PersonInput): PreparedPerson {
  const nameOriginal = requireCleanText(input.nameOriginal, "nameOriginal")
  const nameLatin = requireCleanText(input.nameLatin, "nameLatin")
  const nameOriginalNormalized = normalizeSearchText(nameOriginal)
  const nameLatinNormalized = normalizeSearchText(nameLatin)

  if (!nameOriginalNormalized || !nameLatinNormalized) {
    throw new PeopleInputError(
      "Person names must contain searchable letters or numbers.",
    )
  }

  return {
    nameOriginal,
    nameOriginalNormalized,
    nameLatin,
    nameLatinNormalized,
    keywords: prepareSearchTerms(
      input.keywords ?? [],
      new Set([nameOriginalNormalized, nameLatinNormalized]),
    ),
  }
}

export function hashRequest(value: unknown): string {
  return new Bun.CryptoHasher("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
}

export function assertMatchingIdempotentRequest(
  existingMetadata: Record<string, unknown>,
  requestHash: string,
  key: string,
): void {
  if (existingMetadata.requestHash !== requestHash) {
    throw new IdempotencyConflictError(
      `Idempotency key "${key}" was already used with different input.`,
    )
  }
}

export function toPersonView(
  row: PersonRow,
  duplicateCandidateIds: string[] = [],
): ImportedPersonView {
  return {
    entityId: row.entityId,
    status: row.status,
    mergedIntoEntityId: row.mergedIntoEntityId,
    nameOriginal: row.nameOriginal,
    nameLatin: row.nameLatin,
    keywords: row.keywords,
    createdAt: row.createdAt.toISOString(),
    duplicateCandidateIds,
  }
}
