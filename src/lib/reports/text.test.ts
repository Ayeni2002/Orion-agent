import { describe, expect, it } from "vitest";

import { splitAroundFlagged, splitSentences } from "./text";

/**
 * The splitter, and the reason it is shared.
 *
 * These tests are short because the function is, and they matter more than their
 * length suggests: this is the single place where "which sentence did the
 * generator flag?" becomes "which sentence does the reader see marked?". The
 * generator and the renderer both call it, and every test below is really asking
 * one question — does the same input produce the same sentences on both sides?
 */

describe("splitSentences", () => {
  it("splits on sentence-ending punctuation followed by whitespace", () => {
    expect(splitSentences("One. Two! Three?")).toStrictEqual([
      "One.",
      "Two!",
      "Three?",
    ]);
  });

  it("keeps a decimal point inside its sentence", () => {
    expect(splitSentences("Costs fell 40.5% in 2024. Capacity rose.")).toStrictEqual([
      "Costs fell 40.5% in 2024.",
      "Capacity rose.",
    ]);
  });

  it("trims each sentence and drops empty pieces", () => {
    expect(splitSentences("  One.   Two.  ")).toStrictEqual(["One.", "Two."]);
  });

  it("returns nothing for text with no content", () => {
    expect(splitSentences("")).toStrictEqual([]);
    expect(splitSentences("   ")).toStrictEqual([]);
  });

  it("returns the whole text when it holds a single sentence", () => {
    expect(splitSentences("A single claim with no full stop")).toStrictEqual([
      "A single claim with no full stop",
    ]);
  });
});

describe("splitAroundFlagged", () => {
  it("returns the text whole when nothing was flagged", () => {
    // Not one segment per sentence: the ordinary case must render as a single
    // run of text, and splitting it would change the paragraph's spacing for no
    // reason.
    expect(splitAroundFlagged("One. Two.", [])).toStrictEqual([
      { text: "One. Two.", flagged: false },
    ]);
  });

  it("marks only the flagged sentence", () => {
    expect(splitAroundFlagged("One. Two. Three.", ["Two."])).toStrictEqual([
      { text: "One.", flagged: false },
      { text: "Two.", flagged: true },
      { text: "Three.", flagged: false },
    ]);
  });

  it("marks every occurrence of a flagged sentence", () => {
    expect(splitAroundFlagged("Same. Same.", ["Same."])).toStrictEqual([
      { text: "Same.", flagged: true },
      { text: "Same.", flagged: true },
    ]);
  });

  it("leaves a flagged string that is not in the text unmarked", () => {
    // The conservative failure. A flag that does not match produces no mark
    // rather than a mark on the wrong sentence — the alternative would put the
    // warning on prose that was never flagged.
    expect(splitAroundFlagged("One. Two.", ["Three."])).toStrictEqual([
      { text: "One.", flagged: false },
      { text: "Two.", flagged: false },
    ]);
  });

  it("round-trips: rejoining the segments with a space restores the text", () => {
    const text = "One sentence. Another sentence. A third.";

    expect(
      splitAroundFlagged(text, [])
        .map((segment) => segment.text)
        .join(" "),
    ).toBe(text);
    expect(
      splitAroundFlagged(text, ["Another sentence."])
        .map((segment) => segment.text)
        .join(" "),
    ).toBe(text);
  });
});
