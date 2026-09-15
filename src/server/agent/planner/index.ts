import type { TaskStep } from "@/types/agent";
import { AgentEngineError } from "../errors";
import { createId, now } from "../ids";
import { parseModelJson, type ModelProvider } from "../provider";
import { planSchema, validatePlanGraph } from "./schema";

/**
 * The planner: objective in, validated plan out.
 *
 * Two hard rules from the brief shape this file.
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
 */

const PLANNER_INSTRUCTION = [
  "Decompose the objective below into an ordered list of concrete, executable steps.",
  "",
  "Respond with JSON only, matching exactly this shape:",
  '{"steps":[{"description":"...","expectedOutput":"...","dependsOn":[0]}]}',
  "",
  "Rules:",
  "- Each step must describe a single unit of work that can be completed or fail on its own.",
  "- `dependsOn` holds zero-based indices of EARLIER steps in the same list. Omit it when the step depends on nothing.",
  "- A step may also carry `toolId` when it needs a capability Orion must provide rather than reasoning alone.",
  "- When a step names a `toolId`, it must also carry `toolInput`: the arguments that tool needs, as an object. The tool validates them; do not guess at its schema.",
  "- Do not invent results. Describe the work to be done, not its outcome.",
].join("\n");

export interface CreatePlanParams {
  taskId: string;
  objective: string;
  provider: ModelProvider;
}

/**
 * Produces a validated, executable plan.
 *
 * Throws `AgentEngineError` with `planner_failed` when the provider could not
 * answer, and `invalid_plan` when it answered with something that is not a
 * usable plan. The two are distinct on purpose: the first is an infrastructure
 * problem, the second is a model-output problem, and they are fixed by
 * different people.
 */
export async function createPlan({
  taskId,
  objective,
  provider,
}: CreatePlanParams): Promise<TaskStep[]> {
  const response = await provider.generate({
    operation: "plan",
    instruction: PLANNER_INSTRUCTION,
    context: { objective },
    responseFormat: "json",
  });

  const parsed = parseModelJson(response);

  if (!parsed.ok) {
    throw new AgentEngineError(
      "planner_failed",
      `The planner did not return a usable plan. ${parsed.error}`,
    );
  }

  const validated = planSchema.safeParse(parsed.value);

  if (!validated.success) {
    throw new AgentEngineError(
      "invalid_plan",
      "The planner returned a plan that did not match the required shape.",
      {
        details: {
          // Capped and reshaped: Zod issues are verbose, and this ends up in an
          // HTTP response. Path plus message is the part that is actionable.
          issues: validated.error.issues.slice(0, 10).map((issue) => ({
            path: issue.path.map(String).join("."),
            message: issue.message,
          })),
        },
      },
    );
  }

  const graphIssues = validatePlanGraph(validated.data);

  if (graphIssues.length > 0) {
    throw new AgentEngineError(
      "invalid_plan",
      "The planner returned a plan whose steps depend on each other illegally.",
      { details: { issues: graphIssues } },
    );
  }

  const timestamp = now();

  // Ids are minted for every step before any dependency is resolved, so an
  // index can be turned into an id in one pass without ordering assumptions.
  const planned = validated.data.steps.map((step) => ({
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
        // Indices are already known to point strictly backwards, so a lookup
        // that misses is impossible; the filter keeps the types honest without
        // resorting to a non-null assertion.
        dependsOn: (step.dependsOn ?? [])
          .map((dependencyIndex) => planned[dependencyIndex]?.id)
          .filter((dependencyId): dependencyId is string => dependencyId !== undefined),
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
