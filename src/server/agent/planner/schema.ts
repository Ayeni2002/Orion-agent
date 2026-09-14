import { z } from "zod";

/**
 * Schema for planner output.
 *
 * Model output is untrusted input, so it is parsed and validated before any of
 * it reaches the execution system. Everything downstream may assume a plan is
 * well-formed; nothing downstream re-checks it.
 *
 * The planner is asked for `dependsOn` as *indices* into its own step list
 * rather than as step ids, because a model cannot know ids the engine has not
 * minted yet. Converting indices to ids is then the planner's job, and it
 * happens only after the indices have been proven to point backwards.
 */

export const MAX_PLAN_STEPS = 12;
export const MAX_STEP_DEPENDENCIES = 8;
export const PLANNED_STEP_MIN_LENGTH = 8;
export const PLANNED_STEP_MAX_LENGTH = 500;

export const plannedStepSchema = z.object({
  description: z
    .string()
    .trim()
    .min(
      PLANNED_STEP_MIN_LENGTH,
      `A step description must be at least ${PLANNED_STEP_MIN_LENGTH} characters.`,
    )
    .max(
      PLANNED_STEP_MAX_LENGTH,
      `A step description must be at most ${PLANNED_STEP_MAX_LENGTH} characters.`,
    ),
  expectedOutput: z
    .string()
    .trim()
    .min(3, "A step must state what it is expected to produce.")
    .max(PLANNED_STEP_MAX_LENGTH),
  dependsOn: z
    .array(z.number().int().nonnegative())
    .max(MAX_STEP_DEPENDENCIES)
    .optional(),
  toolId: z.string().trim().min(1).max(100).optional(),
});

export const planSchema = z.object({
  steps: z
    .array(plannedStepSchema)
    .min(1, "A plan must contain at least one step.")
    .max(MAX_PLAN_STEPS, `A plan may contain at most ${MAX_PLAN_STEPS} steps.`),
});

export type PlannedStep = z.infer<typeof plannedStepSchema>;
export type PlannedPlan = z.infer<typeof planSchema>;

export interface PlanValidationIssue {
  index: number;
  message: string;
}

/**
 * Semantic checks Zod cannot express.
 *
 * Requires every dependency to point at a strictly *earlier* step. That single
 * rule buys three guarantees at once: no self-reference, no forward reference,
 * and no cycles — a cycle is impossible when every edge points backwards in an
 * ordered list. It also means the executor can walk the plan in index order and
 * be certain a step's dependencies have already been decided when it reaches it,
 * with no topological sort and no possibility of an unordered walk.
 *
 * Duplicates are rejected separately: they are harmless to execute but always
 * indicate the planner lost track of its own output, which is worth surfacing
 * rather than tolerating.
 */
export function validatePlanGraph(plan: PlannedPlan): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = [];

  plan.steps.forEach((step, index) => {
    const dependencies = step.dependsOn ?? [];

    if (new Set(dependencies).size !== dependencies.length) {
      issues.push({
        index,
        message: "A step lists the same dependency more than once.",
      });
    }

    for (const dependency of dependencies) {
      if (dependency >= index) {
        issues.push({
          index,
          message: `A step depends on step ${dependency}, which does not come before it.`,
        });
      }
    }
  });

  return issues;
}
