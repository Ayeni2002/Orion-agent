import { z } from "zod";

/**
 * Validation for a report generation request.
 *
 * The counterpart of `research.ts`, and shaped by the same rule: the request
 * contract carries only what a caller legitimately decides. Here that is *which*
 * research record to report on and how the report should be produced — never
 * anything about the report's content.
 *
 * **`researchId` is an id and not a payload.** A caller names a record that
 * already exists; it does not supply sources, findings or a title. That is the
 * same structural property `services/research.ts` describes about itself, and it
 * matters more here than anywhere else in the application: a report is meant to
 * be evidence, so a client able to hand in the evidence could manufacture a
 * document that looks like a finding of fact. Nothing below has a field for one.
 *
 * **Why `useModel` is exposed but a model id is not.** Choosing whether prose is
 * written by a model is a real, reproducible choice a caller may need — a
 * deterministic report is stable, free and citable. Choosing *which* model is
 * not: that is deployment configuration, read in `src/lib/env.ts`, and a request
 * that could override it would be a request that could spend an operator's
 * budget on a model they did not select.
 */

/** Longest id accepted. Ids are minted by `createId`, so this is generous. */
export const REPORT_RESEARCH_ID_MAX_LENGTH = 128;

const MISSING_RESEARCH_ID = "A research id is required.";

export const reportRequestSchema = z.object({
  /**
   * `error` rather than `required_error`, which Zod 4 replaced. Without it the
   * absent field falls out of the type check before `.min()` is reached, and a
   * caller who omitted the field is told "expected string, received undefined"
   * — the schema's internals, not the fix. One message covers a missing field, a
   * blank one and a non-string one, because from a caller's side those are the
   * same complaint: no usable id was supplied.
   */
  researchId: z
    .string({ error: MISSING_RESEARCH_ID })
    .trim()
    .min(1, MISSING_RESEARCH_ID)
    .max(
      REPORT_RESEARCH_ID_MAX_LENGTH,
      `A research id is at most ${REPORT_RESEARCH_ID_MAX_LENGTH} characters.`,
    ),
  /**
   * Reuse an existing report rather than making a second one.
   *
   * Defaults to `false` at this layer — "do not regenerate" — because §22 asks
   * the application not to repeat work that has already been done, and a default
   * that regenerated would make the reuse path the one a caller had to remember
   * to ask for.
   */
  regenerate: z.boolean().optional(),
  /** Whether a model may write the report's prose. Defaults to yes. */
  useModel: z.boolean().optional(),
});

export type ReportRequestInput = z.infer<typeof reportRequestSchema>;
