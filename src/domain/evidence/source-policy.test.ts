import { expect, test } from "bun:test"
import {
  getActivationPolicyViolations,
  type PolicyEvidence,
} from "./source-policy"

function evidence(overrides: Partial<PolicyEvidence> = {}): PolicyEvidence {
  return {
    source: {
      category: "quran",
      label: "Al-Quran",
      methodologyBasis:
        "Primary revelation understood according to the tafsir of the Salaf.",
      verification: {},
      ...overrides.source,
    },
    locator: {
      chapter: "33",
      verse: "40",
      ...overrides.locator,
    },
    interpretation: overrides.interpretation ?? "explicit",
  }
}

test("accepts explicit Quran evidence with surah and verse", () => {
  expect(getActivationPolicyViolations([evidence()])).toEqual([])
})

test("rejects Quran evidence without an exact verse locator", () => {
  const item = evidence()
  item.locator = { chapter: "33" }

  expect(getActivationPolicyViolations([item])).toContain(
    "evidence[0] Quran evidence requires locator.chapter and locator.verse.",
  )
})

test("accepts an explicitly graded authentic hadith", () => {
  expect(
    getActivationPolicyViolations([
      evidence({
        source: {
          category: "hadith",
          label: "Sahih al-Bukhari",
          workTitle: "Sahih al-Bukhari",
          methodologyBasis:
            "Accepted hadith collection with an explicit authenticity assessment.",
          verification: {
            hadithGrade: "sahih",
            gradedBy: "Muhammad al-Bukhari",
          },
        },
        locator: { hadithNumber: "1" },
      }),
    ]),
  ).toEqual([])
})

test("rejects weak or ungraded hadith as activation evidence", () => {
  const violations = getActivationPolicyViolations([
    evidence({
      source: {
        category: "hadith",
        label: "Hadith source",
        workTitle: "Hadith work",
        methodologyBasis: "Hadith evidence under review.",
        verification: { hadithGrade: "daif" },
      },
      locator: { hadithNumber: "10" },
    }),
  ])

  expect(violations).toContain(
    "evidence[0] hadith evidence must be graded sahih or hasan.",
  )
  expect(violations).toContain(
    "evidence[0] hadith evidence requires source.verification.gradedBy.",
  )
})

test("accepts two independent qualifying secondary sources", () => {
  const first = evidence({
    source: {
      category: "salaf_report",
      label: "First report",
      author: "First author",
      workTitle: "First work",
      methodologyBasis: "Report transmitted from the Salaf.",
      verification: {},
    },
    locator: { volume: "1", page: "10" },
  })
  const second = evidence({
    source: {
      category: "salafiyyun_scholar",
      label: "Second explanation",
      author: "Second author",
      workTitle: "Second work",
      methodologyBasis: "Explanation by a scholar following the Salaf.",
      verification: {},
    },
    locator: { section: "Biography" },
  })

  expect(getActivationPolicyViolations([first, second])).toEqual([])
})

test("does not count two editions of the same work as independent", () => {
  const first = evidence({
    source: {
      category: "salafiyyun_scholar",
      label: "First edition",
      author: "One author",
      workTitle: "One work",
      edition: "First edition",
      methodologyBasis: "Explanation by a scholar following the Salaf.",
      verification: {},
    },
    locator: { page: "10" },
  })
  const second = evidence({
    source: {
      category: "salafiyyun_scholar",
      label: "Second edition",
      author: "One author",
      workTitle: "One work",
      edition: "Second edition",
      methodologyBasis: "Explanation by a scholar following the Salaf.",
      verification: {},
    },
    locator: { page: "12" },
  })

  expect(getActivationPolicyViolations([first, second])).toContain(
    "Activation requires one qualifying Quran/authentic-hadith passage or at least two independent salaf_report/salafiyyun_scholar sources.",
  )
})

test("rejects one secondary source and context-only evidence", () => {
  const secondary = evidence({
    source: {
      category: "salaf_report",
      label: "Only report",
      author: "One author",
      workTitle: "One work",
      methodologyBasis: "Report transmitted from the Salaf.",
      verification: {},
    },
    locator: { page: "10" },
  })
  const contextual = evidence({
    source: {
      category: "context_only",
      label: "Contextual source",
      methodologyBasis: "Retained only to document another viewpoint.",
      verification: {},
    },
    locator: {},
  })

  expect(getActivationPolicyViolations([secondary])).toContain(
    "Activation requires one qualifying Quran/authentic-hadith passage or at least two independent salaf_report/salafiyyun_scholar sources.",
  )
  expect(getActivationPolicyViolations([contextual])).toContain(
    "evidence[0].source.category context_only cannot support activation.",
  )
})

test("rejects inferred evidence for activation", () => {
  expect(
    getActivationPolicyViolations([
      evidence({
        interpretation: "inferred",
      }),
    ]),
  ).toContain("evidence[0].interpretation must be explicit for activation.")
})
