import {
  AgentEngineError,
  createId,
  now,
  parseModelJson,
  type ModelProvider,
} from "@/server/agent";
import type {
  ResearchPlan,
  ResearchRequest,
  ResearchTask,
} from "@/types/research";

import { researchPlanSchema, validateResearchPlan } from "./schema";

/**
 * The research planner: a question in, validated retrieval tasks out.
 *
 * Same two hard rules as the Phase 3 planner, and the same reasons.
 *
 * First, planner output is untrusted. It is parsed as JSON, validated against a
 * Zod schema, and then checked for the one semantic flaw Zod cannot see. Only
 * then does anything become a `ResearchTask`, and nothing downstream
 * re-validates, because nothing downstream can receive an unvalidated plan.
 *
 * Second, no external call is faked. This module holds a `ModelProvider` and
 * knows nothing else about it. Which provider that is, and whether it performed
 * real inference or deterministic local work, is decided in one place and
 * reported to the caller through the provider descriptor — so a plan produced by
 * the development adapter is labelled as such everywhere it travels.
 *
 * **What this module does not do is decide what to believe.** A plan states what
 * to look up, never what is true. That separation is what makes §12 enforceable
 * further down: if the planner were allowed to assert facts, there would be
 * findings in the system that no source could ever be checked against.
 */

/**
 * What the model is asked for.
 *
 * Written as a JSON contract rather than a description because §7 requires a
 * plan that can be executed, and the shape is stated twice on purpose: once
 * here for the model, and once in `schema.ts` as the thing that actually
 * decides. The prompt is a request; the schema is the contract. When the two
 * disagree the schema wins, and the disagreement shows up as an `invalid_plan`
 * rather than as an unvalidated task reaching the executor.
 *
 * The last two rules are the ones that matter most, and they are stated to the
 * model rather than merely enforced around it. A model asked to "research" a
 * question will answer it from its own weights unless told not to, and the
 * answer would arrive shaped like a task list. Saying "do not answer the
 * question yourself" is the cheapest available defence against that, and the
 * quote requirement is what makes the rest checkable.
 */
export const RESEARCH_PLANNER_INSTRUCTION = [
  "Break the research question below into the distinct things that must be",
  "established in order to answer it. Each becomes one retrieval task.",
  "",
  "Respond with JSON only, matching exactly this shape:",
  '{"restatement":"...","tasks":[{"question":"...","query":"..."}]}',
  "",
  "Rules:",
  "- `restatement` is the question as you understand it, in one sentence. If it is ambiguous, state the reading you are taking.",
  "- Each task's `question` is what that task must establish, in one sentence.",
  "- Each task's `query` is the search-engine query most likely to find sources that establish it. Write it as someone would type it into a search engine, not as a sentence.",
  "- Every task must search for something different. Two tasks with the same query produce one source, not two.",
  "- Do NOT answer the question. Do not state any fact about the subject. State only what must be looked up.",
  "- Do not invent results, sources or URLs.",
].join("\n");

export interface CreateResearchPlanParams {
  request: ResearchRequest;
  provider: ModelProvider;
  /**
   * The most tasks the run will carry out.
   *
   * Applied by truncation rather than by rejection. A model that proposed seven
   * tasks for a run limited to five has not produced a malformed plan — it has
   * produced a good plan that does not fit, and refusing the whole thing would
   * discard the five usable tasks along with the two that do not. The truncation
   * is reported so the result can say a limit was reached rather than quietly
   * presenting a partial plan as the whole one.
   */
  maxTasks: number;
}

export interface ResearchPlanResult {
  plan: ResearchPlan;
  /** True when the model proposed more tasks than the run's limit allows. */
  truncated: boolean;
  /** How many tasks the model proposed, before truncation. */
  proposedTaskCount: number;
}

/**
 * Asks the provider for a plan, and reports a provider failure as
 * `planner_failed` instead of letting it escape.
 *
 * A provider that throws and a provider that answers with something
 * unparseable are the same fact one layer apart — "the model did not answer" —
 * and this module gives that fact one code, as the docblock below says it does.
 * Without this catch the throw travels past every classification here to the
 * run's outermost handler, where it becomes `internal_error`: a code meaning
 * "something unexpected happened", attached to the least unexpected failure a
 * metered endpoint produces. A rejected credential, a rate limit and a request
 * that timed out all arrive by throwing, and all three are the operator's to
 * fix — which is what `planner_failed` tells them and `internal_error` does not.
 */
async function requestPlan({
  provider,
  question,
  maxTasks,
}: {
  provider: ModelProvider;
  question: string;
  maxTasks: number;
}) {
  try {
    return await provider.generate({
      operation: "research_plan",
      instruction: RESEARCH_PLANNER_INSTRUCTION,
      context: { question, maxTasks },
      responseFormat: "json",
    });
  } catch (error) {
    // The message and not the error object. Every provider in this codebase
    // builds its messages as constants — `openai-provider` says so at the point
    // it catches a transport failure — precisely so a failed request cannot
    // carry itself, and the credential on it, out into a response body.
    throw new AgentEngineError(
      "planner_failed",
      `The research planner could not be reached. ${
        error instanceof Error ? error.message : "The provider failed."
      }`,
    );
  }
}

/**
 * Produces a validated, executable research plan.
 *
 * Throws `AgentEngineError` with `planner_failed` when the provider could not
 * answer and `invalid_plan` when it answered with something unusable. Those are
 * the Phase 3 codes, reused deliberately: "the model did not answer" and "the
 * model answered with the wrong shape" mean exactly the same thing here, are
 * fixed by the same people, and a second pair of codes for the same two facts
 * would be two contracts for one condition. §21 asks for structured errors, not
 * for novel ones.
 */
export async function createResearchPlan({
  request,
  provider,
  maxTasks,
}: CreateResearchPlanParams): Promise<ResearchPlanResult> {
  const response = await requestPlan({
    provider,
    question: request.question,
    maxTasks,
  });

  const parsed = parseModelJson(response);

  if (!parsed.ok) {
    throw new AgentEngineError(
      "planner_failed",
      `The research planner did not return a usable plan. ${parsed.error}`,
    );
  }

  const validated = researchPlanSchema.safeParse(parsed.value);

  if (!validated.success) {
    throw new AgentEngineError(
      "invalid_plan",
      "The research planner returned a plan that did not match the required shape.",
      {
        details: {
          // Capped and reshaped, exactly as the Phase 3 planner does: Zod issues
          // are verbose and this ends up in an HTTP response.
          issues: validated.error.issues.slice(0, 10).map((issue) => ({
            path: issue.path.map(String).join("."),
            message: issue.message,
          })),
        },
      },
    );
  }

  const planIssues = validateResearchPlan(validated.data);

  if (planIssues.length > 0) {
    throw new AgentEngineError(
      "invalid_plan",
      "The research planner returned a plan whose tasks repeat each other.",
      { details: { issues: planIssues } },
    );
  }

  const proposedTaskCount = validated.data.tasks.length;

  // Truncation happens after validation and after the duplicate check, so the
  // tasks that survive are the model's own best-ordered ones rather than an
  // arbitrary subset of a set that was never coherent.
  const kept = validated.data.tasks.slice(0, Math.max(1, maxTasks));
  const timestamp = now();
  const planId = createId("plan");

  const plan: ResearchPlan = {
    id: planId,
    requestId: request.id,
    restatement: validated.data.restatement,
    tasks: kept.map(
      (task, index) =>
        ({
          id: createId("rtask"),
          planId,
          index,
          question: task.question,
          query: task.query,
          status: "pending",
          sourceIds: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        }) satisfies ResearchTask,
    ),
    createdAt: timestamp,
  };

  return {
    plan,
    truncated: proposedTaskCount > kept.length,
    proposedTaskCount,
  };
}
