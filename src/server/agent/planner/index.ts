import type { TaskStep, Tool } from "@/types/agent";
import { AgentEngineError } from "../errors";
import { createId, now } from "../ids";
import { parseModelJson, type ModelProvider } from "../provider";
import { planSchema, validatePlanGraph, type PlannedPlan } from "./schema";

/**
 * The planner: objective in, validated plan out.
 *
 * Four rules shape this file.
 *
 * First, planner output is untrusted. It is parsed as JSON and validated against
 * a Zod schema, and the dependency graph is checked semantically on top of that.
 * Only then does anything become a `TaskStep`. Nothing downstream re-validates,
 * because nothing downstream can receive an unvalidated plan.
 *
 * Second, no external call is faked. This module is provider-agnostic — it holds
 * a `ModelProvider` and knows nothing else about it. Which provider that is, and
 * whether it performed real inference or deterministic local work, is decided in
 * exactly one place (`src/server/agent/provider/index.ts`) and reported to the
 * caller through the provider descriptor.
 *
 * Third, the model is told what it may call. `tools` is the run's catalogue and
 * it is stated in the prompt, because a model asked to name a tool without being
 * told which exist can only guess. That guess is not harmless: a step naming a
 * tool the runtime does not have fails with `capability_unavailable`, spending
 * the run before it begins. The catalogue arrives as `Tool` metadata — the
 * projection `ToolRegistry.list()` returns, which carries no schema and no
 * `execute` — so the planner can describe what is callable without gaining any
 * way to call it.
 *
 * Fourth, a rejected plan is retried once, and the retry is narrow. It applies
 * when the provider *answered* and the answer was unusable; it never applies
 * when the provider could not answer at all. `planner_failed` and `invalid_plan`
 * describe different problems fixed by different people, so a transport failure
 * propagates on the first attempt rather than being retried into the same shape.
 */

const PLANNER_INSTRUCTION = [
  "Decompose the objective below into an ordered list of concrete, executable steps.",
  "",
  "Respond with JSON only, matching exactly this shape:",
  '{"steps":[{"description":"...","expectedOutput":"...","dependsOn":[0]}]}',
  "",
  "Rules:",
  "- Each step must describe a single unit of work that can be completed or fail on its own.",
  "- Every step must carry `expectedOutput`: what the step is expected to produce. It is required on every step, and a plan that omits it is rejected.",
  "- `dependsOn` holds zero-based indices of EARLIER steps in the same list. Omit it when the step depends on nothing.",
  "- A step may also carry `toolId` when it needs a capability Orion must provide rather than reasoning alone.",
  "- When a step names a `toolId`, it must also carry `toolInput`: the arguments that tool needs, as an object. The tool validates them; do not guess at its schema.",
  "- Do not invent results. Describe the work to be done, not its outcome.",
  "",
  "Tools:",
  "- The context carries a `tools` list. Its ids are the ONLY valid `toolId` values, and it is the complete catalogue of what this run can call.",
  "- Never invent a tool id, and never assume a tool exists because it would be useful for a step.",
  "- If no listed tool fits a step, omit `toolId` for that step and describe the work without one.",
].join("\n");

/**
 * Appended to the instruction for a repair attempt.
 *
 * The rejected reply and the specific problems are in the context rather than
 * here, so this stays a fixed string — the same split the adapter makes between
 * the system prompt and the per-request content.
 */
const REPAIR_INSTRUCTION = [
  "Your previous reply was rejected and could not be used. Do not repeat it.",
  "The context now carries `previousResponse` — what you returned — and `issues`, the specific problems found with it.",
  "Correct every issue listed and reply with the complete corrected plan, as JSON only. Do not explain, apologise, or return a fragment.",
].join("\n");

/**
 * How many times a plan may be asked for: the original, and one repair.
 *
 * Two rather than an open loop. The retry carries the exact validation issues,
 * so a model that fails again has failed on information, not on ambiguity, and
 * further attempts would spend a metered call each to learn the same thing. The
 * latency is deliberately not hidden: a repair doubles the time to plan.
 */
export const MAX_PLAN_ATTEMPTS = 2;

/** Caps the issues echoed into a repair prompt, matching the error's own cap. */
const MAX_REPORTED_ISSUES = 10;

export interface CreatePlanParams {
  taskId: string;
  objective: string;
  provider: ModelProvider;
  /**
   * The tools this run may call, as public metadata.
   *
   * Required rather than optional, and that is the point. The defect this
   * parameter fixes was the catalogue's *absence*: the planner was asked to name
   * tools it had never been told about, and the only thing a model can do with
   * that question is invent an answer. A default would let the next caller
   * reproduce it silently.
   *
   * Pass `registry.list()`. It carries no schema and no `execute`, so nothing
   * here becomes an execution surface.
   */
  tools: readonly Tool[];
}

/** A problem with a plan, in the form the model can act on. */
interface PlanIssue {
  path: string;
  message: string;
}

/**
 * A rejected attempt.
 *
 * Holds both the error to raise if nothing succeeds and the material a repair
 * prompt needs, because the two are derived from the same validation pass and
 * reconstructing one from the other would mean validating twice.
 */
interface PlanRejection {
  error: AgentEngineError;
  /** The raw text the model returned, echoed back so it can see what it wrote. */
  responseText: string;
  /** Normalised issues for the repair prompt. Empty when nothing parsed. */
  issues: PlanIssue[];
}

type PlanAttemptResult =
  | { ok: true; plan: PlannedPlan }
  | { ok: false; rejection: PlanRejection };

/**
 * Turns a validated plan into the engine's steps, resolving dependency indices.
 *
 * Runs only after the plan has passed both the schema and the graph check, which
 * is what makes the index lookup below total: every index is already known to
 * point strictly backwards, so a miss is impossible and the filter is there to
 * keep the types honest without a non-null assertion.
 */
function toSteps(plan: PlannedPlan, taskId: string): TaskStep[] {
  const timestamp = now();

  // Ids are minted for every step before any dependency is resolved, so an
  // index can be turned into an id in one pass without ordering assumptions.
  const planned = plan.steps.map((step) => ({
    id: createId("step"),
    step,
  }));

  return planned.map(
    ({ id, step }, index) =>
      ({
        id,
        taskId,
        index,
        description: step.description,
        status: "pending",
        dependsOn: (step.dependsOn ?? [])
          .map((dependencyIndex) => planned[dependencyIndex]?.id)
          .filter(
            (dependencyId): dependencyId is string => dependencyId !== undefined,
          ),
        expectedOutput: step.expectedOutput,
        toolId: step.toolId,
        // Carried through unvalidated on purpose: the tool's own schema is the
        // only thing that can check it, and `ToolExecutor` is where that
        // happens. See `plannedStepSchema`.
        toolInput: step.toolInput,
        createdAt: timestamp,
        updatedAt: timestamp,
      }) satisfies TaskStep,
  );
}

/**
 * One ask, from request to validated plan or a structured rejection.
 *
 * The `generate` call is deliberately **not** wrapped. A provider that could not
 * answer at all throws out of here and is never retried: that is an
 * infrastructure failure, and the whole point of keeping it distinct from
 * `invalid_plan` is that the two are fixed by different people.
 */
async function attemptPlan(
  provider: ModelProvider,
  instruction: string,
  context: Record<string, unknown>,
): Promise<PlanAttemptResult> {
  const response = await provider.generate({
    operation: "plan",
    instruction,
    context,
    responseFormat: "json",
  });

  const parsed = parseModelJson(response);

  if (!parsed.ok) {
    return {
      ok: false,
      rejection: {
        error: new AgentEngineError(
          "planner_failed",
          `The planner did not return a usable plan. ${parsed.error}`,
        ),
        responseText: response.text,
        // Nothing parsed, so there is no structure to point at. The raw reply
        // is what the repair prompt shows instead.
        issues: [],
      },
    };
  }

  const validated = planSchema.safeParse(parsed.value);

  if (!validated.success) {
    // Capped and reshaped: Zod issues are verbose, and this ends up in an HTTP
    // response and in a repair prompt. Path plus message is the actionable part.
    const issues = validated.error.issues
      .slice(0, MAX_REPORTED_ISSUES)
      .map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      }));

    return {
      ok: false,
      rejection: {
        error: new AgentEngineError(
          "invalid_plan",
          "The planner returned a plan that did not match the required shape.",
          { details: { issues } },
        ),
        responseText: response.text,
        issues,
      },
    };
  }

  const graphIssues = validatePlanGraph(validated.data);

  if (graphIssues.length > 0) {
    return {
      ok: false,
      rejection: {
        error: new AgentEngineError(
          "invalid_plan",
          "The planner returned a plan whose steps depend on each other illegally.",
          { details: { issues: graphIssues } },
        ),
        responseText: response.text,
        // The error details keep the graph checker's own `{index, message}`
        // shape; only the prompt gets the `steps.N` spelling, because that is
        // the path the model wrote.
        issues: graphIssues.map((issue) => ({
          path: `steps.${issue.index}`,
          message: issue.message,
        })),
      },
    };
  }

  return { ok: true, plan: validated.data };
}

/**
 * Records how many attempts were spent on a plan that never validated.
 *
 * The count is added here rather than inside `attemptPlan` because it is only
 * known once the repair has also failed, and the returned error is the repair's
 * — the first attempt's error is superseded and discarded.
 */
function withAttempts(
  rejection: PlanRejection,
  attempts: number,
): AgentEngineError {
  return new AgentEngineError(rejection.error.code, rejection.error.message, {
    details: { ...rejection.error.details, attempts },
  });
}

export async function createPlan({
  taskId,
  objective,
  provider,
  tools,
}: CreatePlanParams): Promise<TaskStep[]> {
  // Ids and descriptions only. The model is choosing a tool, not calling one,
  // and `version` and `capabilities` would be noise it has no rule for.
  const catalogue = tools.map((tool) => ({
    id: tool.id,
    description: tool.description,
  }));

  const baseContext: Record<string, unknown> = { objective, tools: catalogue };

  const first = await attemptPlan(provider, PLANNER_INSTRUCTION, baseContext);

  if (first.ok) {
    return toSteps(first.plan, taskId);
  }

  const repaired = await attemptPlan(
    provider,
    `${PLANNER_INSTRUCTION}\n\n${REPAIR_INSTRUCTION}`,
    {
      ...baseContext,
      previousResponse: first.rejection.responseText,
      issues: first.rejection.issues,
    },
  );

  if (repaired.ok) {
    return toSteps(repaired.plan, taskId);
  }

  throw withAttempts(repaired.rejection, MAX_PLAN_ATTEMPTS);
}
