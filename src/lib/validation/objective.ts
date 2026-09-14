import { z } from "zod";

/**
 * Validation for user-supplied objectives.
 *
 * This is the only schema Phase 1 needs: the workspace collects an objective
 * and validates it before the (not yet implemented) run begins. Schemas for
 * plans, tool payloads and results arrive with the phases that consume them.
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
