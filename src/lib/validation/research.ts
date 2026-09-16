import { z } from "zod";

/**
 * Validation for a research request.
 *
 * The counterpart of `objective.ts`, and deliberately shaped like it: one field,
 * trimmed, bounded, with messages written for the person who typed the input
 * rather than for a log. A research question and an agent objective are both
 * free text a user supplies from the workspace, so they fail in the same ways
 * and should read the same way when they do.
 *
 * Bounded at both ends for reasons that differ. The floor stops a request that
 * carries no question at all — a question shorter than a few words cannot be
 * broken into retrieval tasks, and the planner would produce queries too generic
 * to retrieve anything. The ceiling is a resource control as much as a
 * readability one: the question is echoed into the planner's context, copied
 * onto the request record, and restated into every task's query, so an unbounded
 * one would be amplified into the provider call many times over.
 *
 * **What is deliberately not a field here.** Not a plan, not a task list, not a
 * status, not a set of limits. §10 requires limits to be explicit and
 * configurable, and they are — through the environment, read in
 * `getResearchConfig`. Exposing them on the request would let a caller raise a
 * ceiling that exists to bound what a run costs, which is the opposite of what a
 * resource control is for. A client choosing its own limits is a client choosing
 * the operator's budget.
 */

export const QUESTION_MIN_LENGTH = 10;
export const QUESTION_MAX_LENGTH = 500;

const MISSING_QUESTION = "A research question is required.";

export const researchRequestSchema = z.object({
  /**
   * `error` rather than `required_error`, which Zod 4 replaced. Without it the
   * absent field falls out of the type check before `.min()` is reached, and a
   * caller who omitted the question is told "expected string, received
   * undefined" — the schema's internals rather than the fix, and on the very
   * path a caller is most likely to hit. One message covers a missing field, a
   * blank one and a non-string one, because from a caller's side those are the
   * same complaint: no usable question was supplied.
   *
   * The docblock above claims these messages are written for the person who
   * typed the input. Until this option was added that was true only of the
   * bounds, and false of the missing field — the one case where a reader most
   * needs to be told what to do.
   */
  question: z
    .string({ error: MISSING_QUESTION })
    .trim()
    .min(
      QUESTION_MIN_LENGTH,
      `Ask a question of at least ${QUESTION_MIN_LENGTH} characters.`,
    )
    .max(
      QUESTION_MAX_LENGTH,
      `Keep the question under ${QUESTION_MAX_LENGTH} characters.`,
    ),
});

export type ResearchRequestInput = z.infer<typeof researchRequestSchema>;
