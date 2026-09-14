import type {
  AgentExecutionError,
  AgentTask,
  Observation,
  StepOutcome,
  StepStatus,
  TaskStep,
} from "@/types/agent";
import { AgentEngineError, describeError, toAgentExecutionError } from "../errors";
import { createId, now } from "../ids";
import { parseModelJson, type ModelProvider } from "../provider";
import type { EventLog } from "../runtime/events";
import type { ExecutionStateBuilder } from "../runtime/state";
import type { ToolRegistry } from "./registry";

/**
 * The executor: walks an approved plan and records what actually happened.
 *
 * Three decisions worth stating, because each is a real behavioural choice
 * rather than an implementation detail.
 *
 * **Steps run in index order.** The planner guarantees every dependency points
 * backwards, so index order is already a valid topological order. No sort, and
 * no way to walk the plan out of order.
 *
 * **One failed step does not abort the run.** Dependents of a failed step are
 * skipped, because running them would mean running them against input that does
 * not exist. Independent branches continue, so a run produces as much as it
 * honestly can. Marking everything "failed" on the first error would discard
 * work that was actually done.
 *
 * **Cancellation is cooperative and checked between steps.** A step already in
 * flight is not interrupted — the provider interface has no way to abort one,
 * and pretending otherwise would misreport what happened. Remaining steps are
 * skipped and the run is marked cancelled.
 */

const STEP_INSTRUCTION =
  "Carry out the step described below and report what it produced. " +
  "Respond with JSON only: {\"summary\":\"...\",\"notes\":[\"...\"]}";

export interface ExecutePlanParams {
  task: AgentTask;
  objective: string;
  provider: ModelProvider;
  registry: ToolRegistry;
  state: ExecutionStateBuilder;
  events: EventLog;
  /** Checked between steps. Absent means the run cannot be cancelled. */
  isCancelled?: () => boolean;
}

export interface ExecutePlanResult {
  cancelled: boolean;
}

/** Narrows a model response into something safe to hold in state. */
function toOutputRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  // A model that answered with an array, a string or a number still produced
  // output; wrapping it keeps the observation's shape uniform without
  // discarding what it said.
  return { value };
}

function markStep(
  step: TaskStep,
  status: StepStatus,
  outcome?: StepOutcome,
): void {
  step.status = status;
  // Left unset while a step is running: it has not had an outcome yet, and
  // writing one early would make a step that later fails look as though it had
  // already succeeded at some point.
  step.outcome = outcome;
  step.updatedAt = now();
}

interface InvokeStepParams {
  step: TaskStep;
  objective: string;
  provider: ModelProvider;
  registry: ToolRegistry;
  executionId: string;
}

/**
 * Runs one step and returns what it produced.
 *
 * Throws on any failure; the caller turns that into an observation and an error
 * entry. A step either returns output or it does not — there is no "succeeded
 * with an error" middle state, which keeps the caller's branching honest.
 */
async function invokeStep({
  step,
  objective,
  provider,
  registry,
  executionId,
}: InvokeStepParams): Promise<Record<string, unknown>> {
  if (step.toolId !== undefined) {
    const tool = registry.resolve(step.toolId);

    if (tool === undefined) {
      // The expected path in Phase 3: the registry is empty, so any step
      // naming a capability lands here. Reported as unavailable — this is the
      // honest answer, and the alternative (a placeholder returning invented
      // findings) would be a fabrication presented as research.
      throw new AgentEngineError(
        "capability_unavailable",
        `This step requires the "${step.toolId}" capability, which is not available in this build.`,
        { stepId: step.id, details: { toolId: step.toolId } },
      );
    }

    // Input would come from the planner and is therefore untrusted; a real tool
    // must validate it. No tool is registered in Phase 3, so this is a seam.
    return tool.run({}, { executionId, stepId: step.id, objective });
  }

  const response = await provider.generate({
    operation: "execute_step",
    instruction: STEP_INSTRUCTION,
    context: {
      objective,
      stepDescription: step.description,
      expectedOutput: step.expectedOutput,
    },
    responseFormat: "json",
  });

  const parsed = parseModelJson(response);

  if (!parsed.ok) {
    throw new AgentEngineError("executor_failed", parsed.error, {
      stepId: step.id,
    });
  }

  return {
    ...toOutputRecord(parsed.value),
    // Recorded on the observation so a stored result always says which provider
    // produced it. Without this, a deterministic development run and a real
    // model run would be indistinguishable after the fact.
    producedBy: `${response.providerId}:${response.model}`,
  };
}

export async function executePlan({
  task,
  objective,
  provider,
  registry,
  state,
  events,
  isCancelled,
}: ExecutePlanParams): Promise<ExecutePlanResult> {
  // Tracks each step's terminal state as the walk proceeds, so a dependency's
  // outcome can be read without scanning the task.
  const statusByStepId = new Map<string, StepStatus>();

  for (const [index, step] of task.steps.entries()) {
    if (isCancelled?.() === true) {
      for (const remaining of task.steps.slice(index)) {
        markStep(remaining, "skipped", "skipped");
        state.finishStep(remaining.id, "skipped", {
          id: createId("obs"),
          stepId: remaining.id,
          timestamp: now(),
          status: "skipped",
          message: `Skipped: ${remaining.description}`,
          error: "The execution was cancelled before this step ran.",
        });
        statusByStepId.set(remaining.id, "skipped");
        events.emit("step.skipped", `Skipped: ${remaining.description}`, {
          stepId: remaining.id,
          data: { reason: "cancelled" },
        });
      }

      return { cancelled: true };
    }

    const blockingDependencies = (step.dependsOn ?? []).filter((dependencyId) => {
      const dependencyStatus = statusByStepId.get(dependencyId);
      return dependencyStatus === "failed" || dependencyStatus === "skipped";
    });

    if (blockingDependencies.length > 0) {
      const reason =
        "An earlier step it depends on did not succeed, so this step was not run.";

      markStep(step, "skipped", "skipped");
      state.finishStep(step.id, "skipped", {
        id: createId("obs"),
        stepId: step.id,
        timestamp: now(),
        status: "skipped",
        message: `Skipped: ${step.description}`,
        error: reason,
      });
      statusByStepId.set(step.id, "skipped");
      events.emit("step.skipped", `Skipped: ${step.description}`, {
        stepId: step.id,
        data: { reason: "dependency_failed", dependsOn: blockingDependencies },
      });

      continue;
    }

    markStep(step, "running");
    state.startStep(step.id);
    events.emit("step.started", `Running: ${step.description}`, {
      stepId: step.id,
    });

    try {
      const output = await invokeStep({
        step,
        objective,
        provider,
        registry,
        executionId: state.executionId,
      });

      const observation: Observation = {
        id: createId("obs"),
        stepId: step.id,
        timestamp: now(),
        status: "completed",
        message: `Completed: ${step.description}`,
        output,
      };

      markStep(step, "completed", "succeeded");
      state.completeStep(step.id, observation);
      statusByStepId.set(step.id, "completed");
      events.emit("step.completed", observation.message, { stepId: step.id });
    } catch (error) {
      // Attributed to this step even when the error came from a bug rather than
      // a deliberate engine error. `toAgentExecutionError` replaces the message
      // of an unexpected failure and cannot know which step it happened in, so
      // the step id is added here — otherwise a consumer holding the error list
      // could see that something failed but not where. An error that already
      // names a step is left as it is.
      const converted = toAgentExecutionError(error);
      const executionError: AgentExecutionError =
        converted.stepId === undefined
          ? { ...converted, stepId: step.id }
          : converted;

      const observation: Observation = {
        id: createId("obs"),
        stepId: step.id,
        timestamp: now(),
        status: "failed",
        message: `Failed: ${step.description}`,
        error: describeError(executionError),
      };

      markStep(step, "failed", "failed");
      state.finishStep(step.id, "failed", observation, executionError);
      statusByStepId.set(step.id, "failed");
      events.emit("step.failed", observation.message, {
        stepId: step.id,
        data: { code: executionError.code },
      });
    }
  }

  return { cancelled: false };
}
