import { personNameTypes } from "@/domain/people/names"
import {
  cleanDisplayText,
  normalizeSearchText,
  prepareSearchTerms,
} from "@/domain/people/normalization"

import { IdempotencyConflictError, PeopleInputError } from "./errors"
import type {
  ImportedPersonView,
  PersonInput,
  PersonNameInput,
  PersonRow,
  PreparedPerson,
  PreparedPersonName,
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
  const primaryName = preparePersonName(
    {
      type: input.nameType ?? "personal",
      nameOriginal: input.nameOriginal,
      nameLatin: input.nameLatin,
    },
    true,
  )
  const names = deduplicatePreparedNames([
    primaryName,
    ...preparePersonNames(input.names ?? []),
  ])
  const excludedSearchTerms = new Set(
    names.flatMap((name) => [
      name.nameOriginalNormalized,
      name.nameLatinNormalized,
    ]),
  )

  return {
    nameOriginal: primaryName.nameOriginal,
    nameOriginalNormalized: primaryName.nameOriginalNormalized,
    nameLatin: primaryName.nameLatin,
    nameLatinNormalized: primaryName.nameLatinNormalized,
    names,
    keywords: prepareSearchTerms(input.keywords ?? [], excludedSearchTerms),
  }
}

export function preparePersonNames(
  inputs: readonly PersonNameInput[],
): PreparedPersonName[] {
  return deduplicatePreparedNames(
    inputs.map((input) => preparePersonName(input, false)),
  )
}

function preparePersonName(
  input: PersonNameInput,
  isPrimary: boolean,
): PreparedPersonName {
  if (!personNameTypes.includes(input.type)) {
    throw new PeopleInputError(`Unsupported person name type "${input.type}".`)
  }

  const nameOriginal = requireCleanText(input.nameOriginal, "nameOriginal", 500)
  const nameLatin = requireCleanText(input.nameLatin, "nameLatin", 500)
  const nameOriginalNormalized = normalizeSearchText(nameOriginal)
  const nameLatinNormalized = normalizeSearchText(nameLatin)

  if (!nameOriginalNormalized || !nameLatinNormalized) {
    throw new PeopleInputError(
      "Person names must contain searchable letters or numbers.",
    )
  }

  return {
    type: input.type,
    nameOriginal,
    nameOriginalNormalized,
    nameLatin,
    nameLatinNormalized,
    isPrimary,
  }
}

function deduplicatePreparedNames(
  names: readonly PreparedPersonName[],
): PreparedPersonName[] {
  const namesByIdentity = new Map<string, PreparedPersonName>()

  for (const name of names) {
    const key = [
      name.type,
      name.nameOriginalNormalized,
      name.nameLatinNormalized,
    ].join("\u0000")

    if (!namesByIdentity.has(key)) {
      namesByIdentity.set(key, name)
    }
  }

  return [...namesByIdentity.values()]
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
    names: row.names,
    keywords: row.keywords,
    createdAt: row.createdAt.toISOString(),
    duplicateCandidateIds,
  }
}
