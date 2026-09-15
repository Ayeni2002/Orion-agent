import { describe, expect, it } from "vitest";

import {
  FINDING_STATEMENT_MAX_LENGTH,
  FINDING_STATEMENT_MIN_LENGTH,
  MAX_CONFLICTS_PER_TASK,
  MAX_FINDINGS_PER_TASK,
  extractedConflictSchema,
  extractedFindingSchema,
  findingsResponseSchema,
  normalizeForComparison,
  verifyQuote,
} from "./schema";

/**
 * The §12 check, tested as arithmetic rather than as intent.
 *
 * `verifyQuote` is the only thing standing between "the model was asked not to
 * invent facts" and "the system can tell when it did". So the tests below are
 * divided by what they must guarantee:
 *
 *   - quotes that are genuinely present match, including across the cosmetic
 *     differences between a page as rendered and a page as retrieved;
 *   - quotes that changed a *word* do not match, however small the change;
 *   - the schema accepts a claim with no quote at all, because the useful
 *     outcome for an unsupported claim is to keep it and label it.
 */

const SOURCE =
  "Grid-scale battery pack costs fell by about 40% between 2019 and 2024, " +
  "according to BloombergNEF. Analysts disagree about whether the decline " +
  "continues through 2027.";

describe("verifyQuote", () => {
  describe("quotes that are present", () => {
    it("matches a verbatim span", () => {
      expect(
        verifyQuote(SOURCE, "battery pack costs fell by about 40%"),
      ).toBe(true);
    });

    it("matches a whole sentence", () => {
      expect(
        verifyQuote(
          SOURCE,
          "Grid-scale battery pack costs fell by about 40% between 2019 and 2024, according to BloombergNEF.",
        ),
      ).toBe(true);
    });

    it("matches when the quote differs only in case", () => {
      expect(verifyQuote(SOURCE, "GRID-SCALE BATTERY PACK COSTS")).toBe(true);
    });

    it("matches when the quote differs only in whitespace", () => {
      expect(verifyQuote(SOURCE, "battery   pack\n\tcosts")).toBe(true);
    });

    it("matches across a line break the source happens to have", () => {
      const wrapped = "costs fell by about 40%\nbetween 2019 and 2024";

      expect(verifyQuote(SOURCE, "costs fell by about 40% between 2019")).toBe(
        true,
      );
      // The same test from the other side: the source's own newline is
      // collapsed, so a quote spanning it still matches.
      expect(verifyQuote("a\nb", "a b")).toBe(true);
      expect(verifyQuote(wrapped, "about 40% between")).toBe(true);
    });

    it.each([
      ["curly single quotes", "Analysts’ view", "Analysts' view"],
      ["curly double quotes", 'the “decline”', 'the "decline"'],
      ["an en dash", "2019–2024", "2019-2024"],
      ["an em dash", "2019—2024", "2019-2024"],
      ["a non-breaking space", "about 40%", "about 40%"],
      ["an ellipsis character", "continues…", "continues..."],
    ])("folds %s", (_label, sourceForm, quoteForm) => {
      expect(verifyQuote(sourceForm, quoteForm)).toBe(true);
    });

    it("folds full-width characters through NFKC", () => {
      // A quote that passed through a formatter which widened the ASCII.
      expect(verifyQuote("costs fell by 40%", "costs fell by ４０%")).toBe(true);
    });
  });

  describe("quotes that are not present", () => {
    it("rejects a fluent paraphrase that appears nowhere in the source", () => {
      expect(
        verifyQuote(SOURCE, "battery prices halved over the same period"),
      ).toBe(false);
    });

    it("rejects a quote with a word inserted", () => {
      expect(
        verifyQuote(SOURCE, "battery pack costs did not fall by about 40%"),
      ).toBe(false);
    });

    it("rejects a quote with a number changed", () => {
      expect(verifyQuote(SOURCE, "fell by about 60% between 2019 and 2024")).toBe(
        false,
      );
    });

    it("rejects a quote with a name swapped for a similar one", () => {
      expect(
        verifyQuote(SOURCE, "according to Wood Mackenzie"),
      ).toBe(false);
    });

    it("rejects a quote assembled from two separate parts of the source", () => {
      // Both halves are present; the sentence joining them is not. This is the
      // shape a model produces when it compresses rather than copies, and it is
      // the reason the check is a substring test and not a bag of words.
      expect(
        verifyQuote(SOURCE, "battery pack costs fell by about 40% continues through 2027"),
      ).toBe(false);
    });

    it("rejects an empty or whitespace-only quote", () => {
      expect(verifyQuote(SOURCE, "")).toBe(false);
      expect(verifyQuote(SOURCE, "   ")).toBe(false);
    });

    it("rejects anything at all when the source has no text", () => {
      expect(verifyQuote("", "battery pack costs")).toBe(false);
    });
  });
});

describe("normalizeForComparison", () => {
  it("lowercases, collapses whitespace and trims", () => {
    expect(normalizeForComparison("  The  Costs\n Fell ")).toBe("the costs fell");
  });

  it("folds typographic variants to their ASCII forms", () => {
    expect(normalizeForComparison("“A” — B… C")).toBe(
      '"a" - b... c',
    );
  });

  it("leaves a word unchanged, which is what the check turns on", () => {
    expect(normalizeForComparison("costs")).not.toBe(normalizeForComparison("cost"));
  });
});

describe("extractedFindingSchema", () => {
  it("accepts a claim with a source index and a quote", () => {
    const parsed = extractedFindingSchema.safeParse({
      statement: "Costs fell by about 40%.",
      sourceIndex: 0,
      quote: "costs fell by about 40%",
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts a claim with neither, because an inference is permitted", () => {
    const parsed = extractedFindingSchema.safeParse({
      statement: "Costs will probably keep falling.",
    });

    expect(parsed.success).toBe(true);
  });

  it("refuses a statement too short to be a claim", () => {
    const parsed = extractedFindingSchema.safeParse({
      statement: "a".repeat(FINDING_STATEMENT_MIN_LENGTH - 1),
    });

    expect(parsed.success).toBe(false);
  });

  it("refuses a statement too long to be one sentence", () => {
    const parsed = extractedFindingSchema.safeParse({
      statement: "a".repeat(FINDING_STATEMENT_MAX_LENGTH + 1),
    });

    expect(parsed.success).toBe(false);
  });

  it("refuses a negative source index", () => {
    const parsed = extractedFindingSchema.safeParse({
      statement: "Costs fell by about 40%.",
      sourceIndex: -1,
    });

    expect(parsed.success).toBe(false);
  });

  it("refuses a non-integer source index", () => {
    const parsed = extractedFindingSchema.safeParse({
      statement: "Costs fell by about 40%.",
      sourceIndex: 1.5,
    });

    expect(parsed.success).toBe(false);
  });
});

describe("extractedConflictSchema", () => {
  it("accepts a conflict naming two findings", () => {
    expect(
      extractedConflictSchema.safeParse({
        description: "The two sources disagree about the trend.",
        findingIndices: [0, 1],
      }).success,
    ).toBe(true);
  });

  it("refuses a conflict naming only one finding", () => {
    expect(
      extractedConflictSchema.safeParse({
        description: "This contradicts itself.",
        findingIndices: [0],
      }).success,
    ).toBe(false);
  });

  it("refuses a conflict naming no findings", () => {
    expect(
      extractedConflictSchema.safeParse({
        description: "Something disagrees somewhere.",
        findingIndices: [],
      }).success,
    ).toBe(false);
  });
});

describe("findingsResponseSchema", () => {
  it("accepts an empty finding list, which is an honest outcome", () => {
    expect(findingsResponseSchema.safeParse({ findings: [] }).success).toBe(true);
  });

  it("accepts a response with no conflicts and no gaps", () => {
    expect(
      findingsResponseSchema.safeParse({
        findings: [{ statement: "Grid-scale costs fell by about 40%." }],
      }).success,
    ).toBe(true);
  });

  it("caps how many findings one task may contribute", () => {
    const one = { statement: "Grid-scale costs fell by about 40%." };

    expect(
      findingsResponseSchema.safeParse({
        findings: Array.from({ length: MAX_FINDINGS_PER_TASK }, () => one),
      }).success,
    ).toBe(true);

    expect(
      findingsResponseSchema.safeParse({
        findings: Array.from({ length: MAX_FINDINGS_PER_TASK + 1 }, () => one),
      }).success,
    ).toBe(false);
  });

  it("caps how many conflicts one task may declare", () => {
    const conflict = { description: "They disagree.", findingIndices: [0, 1] };

    expect(
      findingsResponseSchema.safeParse({
        findings: [],
        conflicts: Array.from({ length: MAX_CONFLICTS_PER_TASK }, () => conflict),
      }).success,
    ).toBe(true);

    expect(
      findingsResponseSchema.safeParse({
        findings: [],
        conflicts: Array.from(
          { length: MAX_CONFLICTS_PER_TASK + 1 },
          () => conflict,
        ),
      }).success,
    ).toBe(false);
  });

  it("refuses a gap too short to say anything", () => {
    expect(
      findingsResponseSchema.safeParse({ findings: [], gaps: ["none"] }).success,
    ).toBe(false);
  });

  it("refuses a response with no findings key at all", () => {
    expect(findingsResponseSchema.safeParse({}).success).toBe(false);
  });
});
