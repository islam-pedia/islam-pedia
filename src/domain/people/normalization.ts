export const SEARCH_NORMALIZATION_VERSION = 1

export function cleanDisplayText(value: string): string {
  return value.trim().replace(/\s+/gu, " ")
}

export function normalizeSearchText(value: string): string {
  return cleanDisplayText(
    value
      .normalize("NFKD")
      .toLowerCase()
      .replace(/\p{M}+/gu, "")
      .replace(/\u0640/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, " "),
  )
}

export interface PreparedSearchTerm {
  term: string
  normalizedTerm: string
}

export function prepareSearchTerms(
  values: readonly string[],
  excludedNormalizedTerms: ReadonlySet<string> = new Set(),
): PreparedSearchTerm[] {
  const termsByNormalizedValue = new Map<string, PreparedSearchTerm>()

  for (const value of values) {
    const term = cleanDisplayText(value)
    const normalizedTerm = normalizeSearchText(term)

    if (
      !term ||
      !normalizedTerm ||
      excludedNormalizedTerms.has(normalizedTerm) ||
      termsByNormalizedValue.has(normalizedTerm)
    ) {
      continue
    }

    termsByNormalizedValue.set(normalizedTerm, {
      term,
      normalizedTerm,
    })
  }

  return [...termsByNormalizedValue.values()]
}
