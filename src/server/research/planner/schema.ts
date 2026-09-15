import { z } from "zod";

import {
  RESEARCH_QUERY_MAX_LENGTH,
  RESEARCH_QUERY_MIN_LENGTH,
} from "../tools/search";

/**
 * Schema for research planner output.
 *
 * Model output is untrusted, so it is parsed and validated here before any of it
 * becomes a `ResearchTask`. Same contract as `agent/planner/schema.ts`, and
 * deliberately the same shape of contract: the two planners do different work
 * but a reader who has understood one should not have to learn a second set of
 * conventions.
 *
 * **What this schema is enforcing, in §7's terms.** A research plan is required
 * to be a list of *tasks*, each with a question and the query that would answer
 * it — not a paragraph of prose describing an approach. A paragraph cannot be
 * executed, cannot be counted against a limit, cannot fail on its own, and
 * cannot be checked against what was retrieved. Requiring a machine-readable
 * structure is what makes §10 and §15 possible at all: a plan whose tasks are
 * countable can be bounded, and a plan whose tasks are individually addressable
 * can be evaluated task by task.
 *
 * The `query` bounds are imported from the search tool rather than restated.
 * That is the point of importing them: the planner validates a query against
 * exactly the contract the tool will apply, so a planned query can never be one
 * `ToolExecutor` rejects as `invalid_tool_input`. Two copies of the bound would
 * drift, and the drift would appear as a plan that is valid when written and
 * invalid when executed.
 */

export const MAX_RESEARCH_TASKS = 12;
export const RESEARCH_QUESTION_MIN_LENGTH = 8;
export const RESEARCH_QUESTION_MAX_LENGTH = 400;
export const RESEARCH_RESTATEMENT_MIN_LENGTH = 8;
export const RESEARCH_RESTATEMENT_MAX_LENGTH = 1_000;

export const plannedResearchTaskSchema = z.object({
  /** What this task exists to establish. For a human reading the plan. */
  question: z
    .string()
    .trim()
    .min(
      RESEARCH_QUESTION_MIN_LENGTH,
      `A research task's question must be at least ${RESEARCH_QUESTION_MIN_LENGTH} characters.`,
    )
    .max(
      RESEARCH_QUESTION_MAX_LENGTH,
      `A research task's question must be at most ${RESEARCH_QUESTION_MAX_LENGTH} characters.`,
    ),
  /** What to search for. Validated against the search tool's own contract. */
  query: z
    .string()
    .trim()
    .min(
      RESEARCH_QUERY_MIN_LENGTH,
      `A search query must be at least ${RESEARCH_QUERY_MIN_LENGTH} characters.`,
    )
    .max(
      RESEARCH_QUERY_MAX_LENGTH,
      `A search query must be at most ${RESEARCH_QUERY_MAX_LENGTH} characters.`,
    ),
});

export const researchPlanSchema = z.object({
  /**
   * The question as Orion understood it.
   *
   * Required rather than optional, and not decoration. A restatement is where a
   * misreading becomes visible: if a run returns findings about the wrong
   * subject, the restatement is what shows that the plan was aimed at something
   * other than what was asked, and it does so before the findings are read.
   */
  restatement: z
    .string()
    .trim()
    .min(
      RESEARCH_RESTATEMENT_MIN_LENGTH,
      "A research plan must restate the question it is answering.",
    )
    .max(RESEARCH_RESTATEMENT_MAX_LENGTH),
  tasks: z
    .array(plannedResearchTaskSchema)
    .min(1, "A research plan must contain at least one task.")
    .max(MAX_RESEARCH_TASKS, `A plan may contain at most ${MAX_RESEARCH_TASKS} tasks.`),
});

export type PlannedResearchTask = z.infer<typeof plannedResearchTaskSchema>;
export type PlannedResearchPlan = z.infer<typeof researchPlanSchema>;

export interface PlanValidationIssue {
  index: number;
  message: string;
}

/** Collapses case and whitespace so two queries that search the same thing compare equal. */
function queryKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Semantic checks Zod cannot express.
 *
 * **Duplicate queries are refused.** The single rule, and it earns its place.
 * Two tasks searching the same thing do not produce two independent sources —
 * deduplication (§14) collapses them to one, so the run pays for two retrieval
 * calls and gets one source's worth of material. What makes that worth refusing
 * rather than tolerating is how it reads afterwards: two findings agreeing looks
 * like corroboration, and here it would be one source agreeing with itself. A
 * result that overstated its own support in that way would be worse than a
 * smaller honest one.
 *
 * Duplicate *questions* are allowed. Two questions can legitimately be answered
 * by different queries — "what does X cost" and "what did X cost before" — and
 * refusing them would reject a plan for a flaw that is not one.
 *
 * The check is on normalised text, because a model that emits `"Nobel Prize 2024"`
 * and `"nobel prize 2024"` has repeated itself and would not be caught by a
 * comparison of the raw strings.
 */
export function validateResearchPlan(
  plan: PlannedResearchPlan,
): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = [];
  const seen = new Map<string, number>();

  plan.tasks.forEach((task, index) => {
    const key = queryKey(task.query);
    const previous = seen.get(key);

    if (previous === undefined) {
      seen.set(key, index);
      return;
    }

    issues.push({
      index,
      message: `This task searches for the same thing as task ${previous}.`,
    });
  });

  return issues;
}
