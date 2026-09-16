import { z } from "zod";

/**
 * The contract a model's report output must satisfy, and the bounds it lives in.
 *
 * **What the model is allowed to say.** Three things, and all three are prose:
 * a summary, a list of analysis sections, and a list of next steps. It is not
 * asked for a title, a source, a URL, a quotation or a date, and there is no
 * field below through which one could arrive. §6 of the Phase 6 brief rules out
 * letting a model return the report's source of truth; this goes further and
 * makes the model's contribution *only* prose, wrapped around material the
 * server assembled on its own.
 *
 * **How it refers to the world.** Exclusively by index into a numbered list of
 * findings the server gave it — the same device Phase 5's finding extractor uses
 * and for the same reason: *"a model cannot know ids the engine has not minted"*
 * (`research/findings/schema.ts`). Indices are resolved against that list, so a
 * reference the model invented resolves to nothing and is dropped.
 *
 * **Why the per-string bounds are hard failures and the list caps are not.** A
 * section twice the permitted length is a model that ignored its instructions,
 * not a section that needs shortening — and silently cutting prose produces an
 * unreadable document that ends mid-sentence, which is a worse outcome than the
 * deterministic report. A list past its cap is different: dropping whole entries
 * loses material but leaves every sentence that remains intact, so
 * `MAX_REPORT_SECTIONS` and `MAX_NEXT_STEPS` are applied by the generator as a
 * truncation it counts, and are deliberately absent from the array schemas
 * below. Section count is also capped to bound the response, and therefore the
 * cost, of every report generated from here on.
 *
 * **Why `findingIndices` may be empty.** Requiring at least one would turn every
 * unprompted preamble into a schema failure that loses the whole response, when
 * the useful outcome is to keep the prose and mark it. This is the disposition
 * Phase 5 settled on for an unverifiable quote: keep the claim, remove the false
 * attribution, count it. A section with no surviving citation is rendered as
 * untraced prose rather than presented as part of the evidence.
 */

/**
 * Most analysis sections a model may return.
 *
 * Not expressed on the array below. The generator keeps the first
 * `MAX_REPORT_SECTIONS` and counts the rest as truncated, because dropping whole
 * sections leaves every retained one readable while failing the response would
 * lose all of them.
 */
export const MAX_REPORT_SECTIONS = 8;
/** Findings one analysis section may cite. */
export const MAX_SECTION_CITATIONS = 12;
/** Findings the summary may cite — wider, because a summary spans the run. */
export const MAX_SUMMARY_CITATIONS = 24;
/**
 * Suggested next steps. Applied by the generator as a truncation, like the
 * section cap and for the same reason.
 */
export const MAX_NEXT_STEPS = 6;

export const SUMMARY_MIN_LENGTH = 20;
export const SUMMARY_MAX_LENGTH = 1_500;
export const SECTION_HEADING_MIN_LENGTH = 3;
export const SECTION_HEADING_MAX_LENGTH = 120;
export const SECTION_BODY_MIN_LENGTH = 20;
export const SECTION_BODY_MAX_LENGTH = 2_000;
export const NEXT_STEP_MIN_LENGTH = 8;
export const NEXT_STEP_MAX_LENGTH = 300;

/**
 * Indices into the findings the server supplied.
 *
 * Non-negative integers, matching the contract the server builds when it numbers
 * them from zero. A negative or fractional value is a shape error rather than an
 * out-of-range one, and the schema rejects it so the two stay distinguishable:
 * an index that is *valid but wrong* is a model citing something that is not
 * there, which is worth counting, while a malformed one is a model that did not
 * follow the contract at all.
 */
function indices(max: number) {
  return z.array(z.number().int().nonnegative()).max(max);
}

export const modelReportSchema = z.object({
  summary: z.object({
    body: z
      .string()
      .trim()
      .min(
        SUMMARY_MIN_LENGTH,
        `A summary is at least ${SUMMARY_MIN_LENGTH} characters.`,
      )
      .max(
        SUMMARY_MAX_LENGTH,
        `A summary is at most ${SUMMARY_MAX_LENGTH} characters.`,
      ),
    findingIndices: indices(MAX_SUMMARY_CITATIONS),
  }),

  sections: z.array(
    z.object({
      heading: z
        .string()
        .trim()
        .min(
          SECTION_HEADING_MIN_LENGTH,
          `A heading is at least ${SECTION_HEADING_MIN_LENGTH} characters.`,
        )
        .max(
          SECTION_HEADING_MAX_LENGTH,
          `A heading is at most ${SECTION_HEADING_MAX_LENGTH} characters.`,
        ),
      body: z
        .string()
        .trim()
        .min(
          SECTION_BODY_MIN_LENGTH,
          `A section is at least ${SECTION_BODY_MIN_LENGTH} characters.`,
        )
        .max(
          SECTION_BODY_MAX_LENGTH,
          `A section is at most ${SECTION_BODY_MAX_LENGTH} characters.`,
        ),
      findingIndices: indices(MAX_SECTION_CITATIONS),
    }),
  ),

  nextSteps: z
    .array(
      z.object({
        body: z
          .string()
          .trim()
          .min(
            NEXT_STEP_MIN_LENGTH,
            `A next step is at least ${NEXT_STEP_MIN_LENGTH} characters.`,
          )
          .max(
            NEXT_STEP_MAX_LENGTH,
            `A next step is at most ${NEXT_STEP_MAX_LENGTH} characters.`,
          ),
        findingIndices: indices(MAX_SECTION_CITATIONS),
      }),
    )
    .optional(),
});

export type ModelReport = z.infer<typeof modelReportSchema>;
export type ModelReportSection = ModelReport["sections"][number];
export type ModelNextStep = NonNullable<ModelReport["nextSteps"]>[number];
