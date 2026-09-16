import { describe, expect, it } from "vitest";

import {
  MAX_NEXT_STEPS,
  MAX_REPORT_SECTIONS,
  MAX_SECTION_CITATIONS,
  MAX_SUMMARY_CITATIONS,
  SECTION_BODY_MAX_LENGTH,
  SECTION_HEADING_MIN_LENGTH,
  SUMMARY_MIN_LENGTH,
  modelReportSchema,
} from "./schema";

/**
 * The model's output contract.
 *
 * §6 requires structured output that is validated rather than trusted, and the
 * tests below are divided by what the schema is defending:
 *
 *   - **the shape holds** — a well-formed response is accepted, and every malformed
 *     one that matters is refused rather than quietly repaired;
 *   - **no field carries evidence** — a response that supplies a URL, a source id
 *     or a quotation does not have one carried through, which is §4's
 *     "do not fabricate URLs" made structural;
 *   - **the list caps are absent on purpose** — so a test that expects truncation
 *     rather than rejection is testing the documented behaviour.
 */

/** A response that satisfies every rule, as the base for the mutations below. */
function validResponse() {
  return {
    summary: {
      body: "Costs fell by about 40% between 2019 and 2024 while capacity reached 90 GW.",
      findingIndices: [0, 1],
    },
    sections: [
      {
        heading: "The cost decline",
        body: "Grid-scale pack costs fell by about 40% between 2019 and 2024, according to the survey.",
        findingIndices: [0],
      },
    ],
    nextSteps: [
      { body: "Establish whether the decline continues through 2027.", findingIndices: [2] },
    ],
  };
}

function parse(response: unknown) {
  return modelReportSchema.safeParse(response);
}

describe("modelReportSchema", () => {
  describe("the shape holds", () => {
    it("accepts a well-formed response", () => {
      const result = parse(validResponse());

      expect(result.success).toBe(true);
    });

    it("accepts a response with no next steps", () => {
      const { nextSteps: _nextSteps, ...withoutSteps } = validResponse();

      expect(parse(withoutSteps).success).toBe(true);
    });

    it("accepts an empty section list", () => {
      expect(parse({ ...validResponse(), sections: [] }).success).toBe(true);
    });

    it("refuses a summary below the minimum length", () => {
      const response = validResponse();
      const result = parse({
        ...response,
        summary: { ...response.summary, body: "Too short." },
      });

      expect(result.success).toBe(false);
      expect(result.success ? "" : result.error.issues[0]?.message).toContain(
        `at least ${SUMMARY_MIN_LENGTH} characters`,
      );
    });

    it("refuses a heading below the minimum length", () => {
      const response = validResponse();
      const [section] = response.sections;

      const result = parse({
        ...response,
        sections: [{ ...section, heading: "A" }],
      });

      expect(result.success).toBe(false);
      expect(result.success ? "" : result.error.issues[0]?.message).toContain(
        `at least ${SECTION_HEADING_MIN_LENGTH} characters`,
      );
    });

    it("refuses a section body past the maximum, rather than truncating it", () => {
      // The documented asymmetry: per-string bounds are hard failures because
      // prose cut mid-sentence is a worse document than the deterministic one.
      const response = validResponse();
      const [section] = response.sections;

      const result = parse({
        ...response,
        sections: [
          { ...section, body: "x".repeat(SECTION_BODY_MAX_LENGTH + 1) },
        ],
      });

      expect(result.success).toBe(false);
    });

    it("refuses a negative or fractional finding index", () => {
      const response = validResponse();

      expect(
        parse({
          ...response,
          summary: { ...response.summary, findingIndices: [-1] },
        }).success,
      ).toBe(false);

      expect(
        parse({
          ...response,
          summary: { ...response.summary, findingIndices: [0.5] },
        }).success,
      ).toBe(false);
    });

    it("refuses a response missing the summary entirely", () => {
      const { summary: _summary, ...withoutSummary } = validResponse();

      expect(parse(withoutSummary).success).toBe(false);
    });
  });

  describe("no field carries evidence", () => {
    it("strips a URL supplied at the top level", () => {
      const result = parse({
        ...validResponse(),
        url: "https://invented.example/study",
      });

      expect(result.success).toBe(true);
      expect(result.success && "url" in result.data).toBe(false);
    });

    it("strips a source id supplied alongside a section", () => {
      const response = validResponse();
      const [section] = response.sections;

      const result = parse({
        ...response,
        sections: [{ ...section, sourceId: "src_invented" }],
      });

      expect(result.success).toBe(true);
      expect(result.success && "sourceId" in (result.data.sections[0] ?? {})).toBe(
        false,
      );
    });

    it("strips a quotation supplied alongside a section", () => {
      const response = validResponse();
      const [section] = response.sections;

      const result = parse({
        ...response,
        sections: [{ ...section, quote: "A passage the model wrote itself." }],
      });

      expect(result.success).toBe(true);
      expect(result.success && "quote" in (result.data.sections[0] ?? {})).toBe(
        false,
      );
    });

    it("strips a title supplied at the top level", () => {
      // The title is derived from the question by the server, so a model-authored
      // one has nowhere to land even if it is offered.
      const result = parse({
        ...validResponse(),
        title: "The 2024 Storage Collapse",
      });

      expect(result.success).toBe(true);
      expect(result.success && "title" in result.data).toBe(false);
    });
  });

  describe("the list caps are the generator's, not the schema's", () => {
    it("accepts more sections than the cap, so the generator can truncate", () => {
      const response = validResponse();
      const [section] = response.sections;

      const many = Array.from({ length: MAX_REPORT_SECTIONS + 4 }, () => ({
        ...section,
      }));

      expect(parse({ ...response, sections: many }).success).toBe(true);
    });

    it("accepts more next steps than the cap, for the same reason", () => {
      const response = validResponse();

      const step = {
        body: "Establish whether the decline continues through 2027.",
        findingIndices: [2],
      };

      const many = Array.from({ length: MAX_NEXT_STEPS + 3 }, () => ({ ...step }));

      expect(parse({ ...response, nextSteps: many }).success).toBe(true);
    });

    it("still refuses a single block citing more findings than one may", () => {
      const response = validResponse();
      const [section] = response.sections;

      const overCited = Array.from(
        { length: MAX_SECTION_CITATIONS + 1 },
        (_, index) => index,
      );

      expect(
        parse({
          ...response,
          sections: [{ ...section, findingIndices: overCited }],
        }).success,
      ).toBe(false);
    });

    it("gives the summary a wider citation budget than a section", () => {
      const response = validResponse();

      const wide = Array.from(
        { length: MAX_SECTION_CITATIONS + 1 },
        (_, index) => index,
      );

      expect(wide.length).toBeLessThanOrEqual(MAX_SUMMARY_CITATIONS);
      expect(
        parse({
          ...response,
          summary: { ...response.summary, findingIndices: wide },
        }).success,
      ).toBe(true);
    });
  });
});
