export const SOURCE_POLICY_VERSION = "salafiyyun-v1" as const
export const SOURCE_METHODOLOGY = "salafiyyun" as const

export const sourceCategories = [
  "quran",
  "hadith",
  "salaf_report",
  "salafiyyun_scholar",
  "context_only",
] as const

export const sourceMethodologies = [SOURCE_METHODOLOGY, "context_only"] as const

export const hadithGrades = [
  "sahih",
  "hasan",
  "daif",
  "mawdu",
  "disputed",
] as const

export type SourceCategory = (typeof sourceCategories)[number]
export type SourceMethodology = (typeof sourceMethodologies)[number]
export type HadithGrade = (typeof hadithGrades)[number]

export interface SourceVerification {
  hadithGrade?: HadithGrade
  gradedBy?: string
  notes?: string
}

export interface PolicyEvidence {
  source: {
    category: SourceCategory
    label: string
    uri?: string
    author?: string
    workTitle?: string
    edition?: string
    methodologyBasis: string
    verification: SourceVerification
  }
  locator: {
    volume?: string
    page?: string
    chapter?: string
    verse?: string
    hadithNumber?: string
    section?: string
    url?: string
  }
  interpretation: "explicit" | "inferred"
}

export const sourcePolicy = {
  version: SOURCE_POLICY_VERSION,
  methodology: SOURCE_METHODOLOGY,
  principle:
    "Islam Pedia conclusions follow the Salafiyyun methodology; citations remain mandatory and the methodology label alone is never treated as evidence.",
  activationRules: {
    interpretation: "explicit",
    primaryEvidence:
      "One Quran passage with surah and verse, or one sahih/hasan hadith with collection, hadith number, and named grader.",
    secondaryEvidence:
      "At least two independent salaf reports and/or Salafiyyun scholar sources, each with author, work, precise locator, and methodology basis.",
    contextOnly:
      "Sources outside the accepted methodology may be retained for documentation but cannot activate an entity or establish an accepted conclusion.",
  },
  conflictPolicy:
    "Preserve disagreements and contrary reports with uncertain, disputed, or retracted status instead of deleting them.",
} as const

function hasPreciseSecondaryLocator(
  locator: PolicyEvidence["locator"],
): boolean {
  return Boolean(locator.page || locator.section)
}

function independentSourceKey(evidence: PolicyEvidence): string {
  const { source } = evidence

  return [
    source.author?.toLocaleLowerCase("und") ?? "",
    source.workTitle?.toLocaleLowerCase("und") ?? "",
  ].join("\u0000")
}

export function getActivationPolicyViolations(
  evidenceItems: PolicyEvidence[],
): string[] {
  const violations: string[] = []

  for (const [index, evidence] of evidenceItems.entries()) {
    const prefix = `evidence[${index}]`
    const { source, locator } = evidence

    if (evidence.interpretation !== "explicit") {
      violations.push(
        `${prefix}.interpretation must be explicit for activation.`,
      )
    }

    if (!source.methodologyBasis.trim()) {
      violations.push(`${prefix}.source.methodologyBasis must not be blank.`)
    }

    if (source.category === "context_only") {
      violations.push(
        `${prefix}.source.category context_only cannot support activation.`,
      )
    }

    if (source.category === "quran" && (!locator.chapter || !locator.verse)) {
      violations.push(
        `${prefix} Quran evidence requires locator.chapter and locator.verse.`,
      )
    }

    if (source.category === "hadith") {
      if (!source.workTitle || !locator.hadithNumber) {
        violations.push(
          `${prefix} hadith evidence requires source.workTitle and locator.hadithNumber.`,
        )
      }

      if (
        source.verification.hadithGrade !== "sahih" &&
        source.verification.hadithGrade !== "hasan"
      ) {
        violations.push(
          `${prefix} hadith evidence must be graded sahih or hasan.`,
        )
      }

      if (!source.verification.gradedBy?.trim()) {
        violations.push(
          `${prefix} hadith evidence requires source.verification.gradedBy.`,
        )
      }
    }

    if (
      source.category === "salaf_report" ||
      source.category === "salafiyyun_scholar"
    ) {
      if (
        !source.author ||
        !source.workTitle ||
        !hasPreciseSecondaryLocator(locator)
      ) {
        violations.push(
          `${prefix} ${source.category} evidence requires source.author, source.workTitle, and locator.page or locator.section.`,
        )
      }
    }
  }

  if (violations.length > 0) {
    return violations
  }

  const hasPrimaryEvidence = evidenceItems.some(({ source }) => {
    if (source.category === "quran") {
      return true
    }

    return (
      source.category === "hadith" &&
      (source.verification.hadithGrade === "sahih" ||
        source.verification.hadithGrade === "hasan")
    )
  })

  if (hasPrimaryEvidence) {
    return []
  }

  const independentSecondarySources = new Set(
    evidenceItems
      .filter(
        ({ source }) =>
          source.category === "salaf_report" ||
          source.category === "salafiyyun_scholar",
      )
      .map(independentSourceKey),
  )

  if (independentSecondarySources.size < 2) {
    violations.push(
      "Activation requires one qualifying Quran/authentic-hadith passage or at least two independent salaf_report/salafiyyun_scholar sources.",
    )
  }

  return violations
}
