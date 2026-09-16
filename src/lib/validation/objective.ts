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

export const objectiveSchema = z.object({
  objective: z
    .string()
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
