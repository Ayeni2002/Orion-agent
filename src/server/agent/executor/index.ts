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
import { receiptError } from "../tools";
import type { ToolExecutor, ToolReceipt } from "../tools";

/**
 * The executor: walks an approved plan and records what actually happened.
 *
 * Four decisions worth stating, because each is a real behavioural choice
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
 *
 * **A step that names a tool goes through `ToolExecutor`, and only that way.**
 * Phase 3 called `tool.run()` here directly, which meant validation,
 * permissions and recording would each have had to be re-implemented at this
 * call site. They are not implemented here at all: this file asks the tool
 * layer for a receipt and records it. That is what keeps the executor free of
 * per-tool knowledge as the catalogue grows.
 */

const STEP_INSTRUCTION =
  "Carry out the step described below and report what it produced. " +
  "Respond with JSON only: {\"summary\":\"...\",\"notes\":[\"...\"]}";

export interface ExecutePlanParams {
  task: AgentTask;
  objective: string;
  provider: ModelProvider;
  /** The tool runtime for this run. Validates, permits and records every call. */
  tools: ToolExecutor;
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

/**
 * Records a terminal success.
 *
 * Both terminal paths go through a helper like this one rather than being
 * written inline, because there are now two ways a step can finish — a model
 * answered, or a tool ran — and the four things that must happen together
 * (step status, state, observation, event) are easy to keep in step in one
 * place and easy to let drift in two.
 */
function recordCompletion(
  step: TaskStep,
  observation: Observation,
  state: ExecutionStateBuilder,
  events: EventLog,
): void {
  markStep(step, "completed", "succeeded");
  state.completeStep(step.id, observation);
  events.emit("step.completed", observation.message, { stepId: step.id });
}

/** Records a terminal failure and the structured error that explains it. */
function recordFailure(
  step: TaskStep,
  observation: Observation,
  error: AgentExecutionError,
  state: ExecutionStateBuilder,
  events: EventLog,
): void {
  markStep(step, "failed", "failed");
  state.finishStep(step.id, "failed", observation, error);
  events.emit("step.failed", observation.message, {
    stepId: step.id,
    data: { code: error.code },
  });
}

/**
 * Builds the observation for a tool call.
 *
 * `source` and `toolId` are set as first-class fields rather than buried in
 * `metadata`, so the evaluator and the UI can tell a measurement apart from a
 * generated claim without inspecting the output's shape. The receipt itself is
 * not duplicated here — it is already on `step.execution`, and the `stepId`
 * that both carry is what links them.
 */
function toolObservation(step: TaskStep, receipt: ToolReceipt): Observation {
  const succeeded = receipt.status === "succeeded";

  return {
    id: createId("obs"),
    stepId: step.id,
    timestamp: now(),
    status: succeeded ? "completed" : "failed",
    message: `${succeeded ? "Completed" : "Failed"} with ${receipt.toolId}: ${step.description}`,
    ...(receipt.output === undefined ? {} : { output: receipt.output }),
    ...(receipt.error === undefined
      ? {}
      : { error: describeError(receipt.error) }),
    source: "tool",
    toolId: receipt.toolId,
  };
}

/**
 * How long a tool call took, from the receipt's own timestamps.
 *
 * Both ends are optional on the stored shape, so this returns `undefined`
 * rather than a number it had to guess at. A negative span means the clock
 * moved between the two reads, which is not a duration worth reporting either.
 */
function receiptDurationMs(receipt: ToolReceipt): number | undefined {
  const { startedAt, finishedAt } = receipt;

  if (startedAt === undefined || finishedAt === undefined) {
    return undefined;
  }

  const elapsedMs = Date.parse(finishedAt) - Date.parse(startedAt);

  return Number.isNaN(elapsedMs) || elapsedMs < 0 ? undefined : elapsedMs;
}

interface InvokeStepParams {
  step: TaskStep;
  objective: string;
  provider: ModelProvider;
}

/**
 * Runs one non-tool step and returns what the model produced.
 *
 * Throws on any failure; the caller turns that into an observation and an error
 * entry. A step either returns output or it does not — there is no "succeeded
 * with an error" middle state, which keeps the caller's branching honest.
 */
async function invokeModelStep({
  step,
  objective,
  provider,
}: InvokeStepParams): Promise<Record<string, unknown>> {
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

/**
 * Runs a step that names a tool.
 *
 * The tool layer never throws, so this is an ordinary branch rather than a
 * try/catch: it inspects the receipt and records the outcome the receipt
 * reports. A failed tool call fails its step — which skips its dependents and
 * lets the run report exactly that — but it cannot take the run down with it.
 */
async function runToolStep(
  step: TaskStep,
  toolId: string,
  params: {
    objective: string;
    tools: ToolExecutor;
    state: ExecutionStateBuilder;
    events: EventLog;
  },
): Promise<void> {
  const { objective, tools, state, events } = params;

  events.emit("tool.started", `Calling ${toolId}: ${step.description}`, {
    stepId: step.id,
    data: { toolId },
  });

  const receipt = await tools.execute({
    toolId,
    // Untrusted, exactly as the planner proposed it. Validated inside.
    input: step.toolInput,
    executionId: state.executionId,
    taskId: step.taskId,
    stepId: step.id,
    objective,
  });

  // Recorded on the step whether the call succeeded or failed. A receipt for a
  // call that went wrong is the one most worth keeping.
  step.execution = receipt;

  const observation = toolObservation(step, receipt);
  const durationMs = receiptDurationMs(receipt);

  events.emit(
    receipt.status === "succeeded" ? "tool.completed" : "tool.failed",
    observation.message,
    {
      stepId: step.id,
      data: {
        toolId: receipt.toolId,
        toolVersion: receipt.toolVersion,
        status: receipt.status,
        // Omitted rather than reported as a placeholder when the receipt is
        // missing a timestamp: an event log that says "0 ms" for an unknown
        // duration is saying something it does not know.
        ...(durationMs === undefined ? {} : { durationMs }),
      },
    },
  );

  if (receipt.status === "succeeded") {
    recordCompletion(step, observation, state, events);
    return;
  }

  recordFailure(step, observation, receiptError(receipt), state, events);
}

export async function executePlan({
  task,
  objective,
  provider,
  tools,
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

    // Read once, so the two branches below each narrow from a stable value
    // rather than from the optional field itself.
    const toolId = step.toolId;

    if (toolId !== undefined) {
      await runToolStep(step, toolId, { objective, tools, state, events });
      statusByStepId.set(step.id, step.status);
      continue;
    }

    try {
      const output = await invokeModelStep({ step, objective, provider });

      const observation: Observation = {
        id: createId("obs"),
        stepId: step.id,
        timestamp: now(),
        status: "completed",
        message: `Completed: ${step.description}`,
        output,
        source: "engine",
      };

      recordCompletion(step, observation, state, events);
      statusByStepId.set(step.id, "completed");
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
        source: "engine",
      };

      recordFailure(step, observation, executionError, state, events);
      statusByStepId.set(step.id, "failed");
    }
  }

  return { cancelled: false };
}
