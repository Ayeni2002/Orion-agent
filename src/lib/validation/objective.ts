import { z } from "zod";

/**
 * Validation for user-supplied objectives.
 *
 * The workspace collects an objective and validates it before the run begins.
 * This is the request contract only: the shapes the engine builds internally —
 * a plan, a tool payload, a result — are validated where they are produced, not
 * here, because they never arrive from a client.
 */

export const OBJECTIVE_MIN_LENGTH = 10;
export const OBJECTIVE_MAX_LENGTH = 2000;

const MISSING_OBJECTIVE = "An objective is required.";

export const objectiveSchema = z.object({
  /**
   * `error` rather than `required_error`, which Zod 4 replaced. Without it the
   * absent field falls out of the type check before `.min()` is reached, and the
   * workspace shows "expected string, received undefined" — the schema's
   * internals rather than the fix. One message covers a missing field, a blank
   * one and a non-string one, because from a user's side those are the same
   * complaint: no usable objective was supplied.
   */
  objective: z
    .string({ error: MISSING_OBJECTIVE })
    .trim()
    .min(
      OBJECTIVE_MIN_LENGTH,
      `Describe the objective in at least ${OBJECTIVE_MIN_LENGTH} characters.`,
    )
    .max(
      OBJECTIVE_MAX_LENGTH,
      `Keep the objective under ${OBJECTIVE_MAX_LENGTH} characters.`,
    ),
});

export type ObjectiveInput = z.infer<typeof objectiveSchema>;
