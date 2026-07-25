import { describe, expect, test } from "bun:test"
import {
  cleanDisplayText,
  normalizeSearchText,
  prepareSearchTerms,
} from "./normalization"

describe("person search normalization", () => {
  test("preserves display text while collapsing whitespace", () => {
    expect(cleanDisplayText("  Umar   ibn\nal-Khattab  ")).toBe(
      "Umar ibn al-Khattab",
    )
  })

  test("normalizes Latin transliteration and punctuation", () => {
    expect(normalizeSearchText("ʿUmar ibn al-Khaṭṭāb")).toBe(
      "ʿumar ibn al khattab",
    )
  })

  test("removes Arabic harakat and tatweel", () => {
    expect(normalizeSearchText("عُمَــر بْن ٱلْخَطَّاب")).toBe("عمر بن ٱلخطاب")
  })

  test("deduplicates keywords and excludes canonical names", () => {
    const excluded = new Set(["umar ibn al khattab"])

    expect(
      prepareSearchTerms(
        [" Omar ", "omar", "Umar ibn al-Khattab", "", "ابن الخطاب"],
        excluded,
      ),
    ).toEqual([
      { term: "Omar", normalizedTerm: "omar" },
      { term: "ابن الخطاب", normalizedTerm: "ابن الخطاب" },
    ])
  })
})
