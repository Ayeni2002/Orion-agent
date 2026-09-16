import type {
  AgentExecution,
  AgentResult,
  AgentTask,
  ExecutionProvider,
  Observation,
  TaskStatus,
} from "@/types/agent";
import { AgentEngineError, describeError, toAgentExecutionError } from "../errors";
import { createId, now } from "../ids";
import { resolveModelProvider, type ModelProvider } from "../provider";
import { createPlan } from "../planner";
import { executePlan } from "../executor";
import {
  createDefaultToolRegistry,
  ToolExecutor,
  type ToolRegistry,
} from "../tools";
import { evaluateExecution } from "../evaluator";
import { EventLog, type EventSink } from "./events";
import { ExecutionStateBuilder } from "./state";

/**
 * The agent runner — the one place the lifecycle is assembled.
 *
 * create → plan → execute → evaluate → result, in that order, with an event
 * emitted at every transition. Every stage below this file is independently
 * testable and knows nothing about the others; this module is where they are
 * wired together, which is why it is also the only module that has to know the
 * whole shape of a run.
 *
 * Phase 4 inserted the tool call into the middle of that sequence:
 *
 *   request → validate → plan → execute → [ tool call ] → observe → evaluate
 *
 * The bracketed stage is not a new execution status, and deliberately so. A run
 * may make any number of tool calls inside one step-walking pass, and
 * `ExecutionStatus` describes the run, not the individual calls — modelling
 * each call as a status would make the status mean "the run is doing a thing it
 * does repeatedly". The calls are visible where they actually happen: as
 * `tool.*` events in the log, as observations with `source: "tool"`, and as
 * receipts on the steps that made them.
 *
 * The runner is the boundary of the engine. It returns data and never throws:
 * a failed run is a returned execution with `status: "failed"` and structured
 * errors attached, because a caller needs the partial results of a run that
 * went wrong far more than it needs an exception.
 */

/**
 * The only agent Orion ships.
 *
 * Phase 1 defined `Agent` as an entity, but nothing selects between agents yet
 * and Phase 3 has no agent registry, so every run is attributed to this
 * constant. It names what actually ran rather than implying a catalogue that
 * does not exist.
 */
export const AGENT_ID = "orion";

/** Stand-in provenance for a run that failed before a provider was resolved. */
const UNRESOLVED_PROVIDER: ExecutionProvider = {
  id: "unresolved",
  label: "No model provider was resolved",
  model: "none",
  isExternal: false,
};

export interface RunAgentParams {
  objective: string;
  /** Injected by tests. Resolved from the environment when absent. */
  provider?: ModelProvider;
  /**
   * Injected by tests. The default catalogue otherwise.
   *
   * A test that wants the `capability_unavailable` path passes
   * `createToolRegistry()` — empty — which is exactly how Phase 3 exercised it.
   */
  registry?: ToolRegistry;
  /**
   * Injected by tests that need a different permission grant.
   *
   * Takes precedence over `registry` when both are given, since the executor
   * already holds the registry it will use. A run built without this gets
   * `DEFAULT_TOOL_PERMISSION`, which grants `read_only` and nothing else.
   */
  tools?: ToolExecutor;
  /** Checked between steps. Absent means the run cannot be cancelled. */
  isCancelled?: () => boolean;
  /** Observes events as they are emitted. No sink in Phase 3. */
  onEvent?: EventSink;
}

interface FinaliseParams {
  executionId: string;
  task: AgentTask;
  state: ExecutionStateBuilder;
  events: EventLog;
  provider: ExecutionProvider;
  resultStatus: TaskStatus;
  summary: string;
  errors: AgentResult["errors"];
}

/**
 * Pairs every step with the output it produced.
 *
 * These are the run's raw findings — what each step actually returned, keyed by
 * the step that returned it. Deliberately not a report: nothing is merged,
 * ranked or rewritten, so a reader can always trace a claim back to the step
 * and provider that made it. Turning this into a document is a later phase's
 * job, and it will need this record intact to do it.
 */
function collectFindings(
  task: AgentTask,
  observations: Observation[],
): AgentResult["findings"] {
  const outputByStepId = new Map<string, Record<string, unknown>>();

  for (const observation of observations) {
    if (observation.stepId !== undefined && observation.output !== undefined) {
      outputByStepId.set(observation.stepId, observation.output);
    }
  }

  return task.steps.map((step) => ({
    stepId: step.id,
    description: step.description,
    status: step.status,
    output: outputByStepId.get(step.id),
  }));
}

function finalise({
  executionId,
  task,
  state,
  events,
  provider,
  resultStatus,
  summary,
  errors,
}: FinaliseParams): AgentExecution {
  const snapshot = state.snapshot();

  const result: AgentResult = {
    taskId: task.id,
    executionId,
    status: resultStatus,
    summary,
    findings: collectFindings(task, snapshot.observations),
    ...(errors === undefined || errors.length === 0 ? {} : { errors }),
    completedAt: now(),
  };

  return {
    id: executionId,
    task,
    state: snapshot,
    events: events.list(),
    provider,
    result,
  };
}

export async function runAgent({
  objective,
  provider: injectedProvider,
  registry = createDefaultToolRegistry(),
  tools,
  isCancelled,
  onEvent,
}: RunAgentParams): Promise<AgentExecution> {
  const executionId = createId("exec");
  const taskId = createId("task");
  const events = new EventLog(executionId, onEvent);
  const state = new ExecutionStateBuilder(executionId, objective);

  // Built once per run, holding this run's registry and its permission. Nothing
  // in the request can reach either: the objective is the only value a caller
  // supplies, and it never becomes a tool id or a grant.
  const toolExecutor = tools ?? new ToolExecutor(registry);

  const task: AgentTask = {
    id: taskId,
    agentId: AGENT_ID,
    objective,
    status: "planning",
    steps: [],
    createdAt: now(),
    updatedAt: now(),
  };

  let provider: ExecutionProvider = UNRESOLVED_PROVIDER;

  events.emit("execution.created", "Execution created.", {
    data: { objective },
  });

  try {
    // Resolution is inside the try so a configuration error is reported as a
    // failed execution rather than an exception. A misconfigured provider and a
    // provider that errored mid-run are the same problem from the caller's side.
    let resolved: ModelProvider;

    try {
      resolved = injectedProvider ?? resolveModelProvider();
    } catch (error) {
      throw new AgentEngineError(
        "internal_error",
        error instanceof Error
          ? error.message
          : "The model provider could not be configured.",
      );
    }

    provider = { ...resolved.descriptor };

    state.setStatus("planning");
    events.emit("execution.planning", "Decomposing the objective into steps.");

    // The catalogue is passed so the planner can only name tools that exist.
    // `list()` is the public projection — metadata with no schema and no
    // `execute` — so planning gains no way to call anything.
    task.steps = await createPlan({
      taskId,
      objective,
      provider: resolved,
      tools: registry.list(),
    });

    events.emit("execution.planned", `Planned ${task.steps.length} step(s).`, {
      data: { stepCount: task.steps.length },
    });

    state.setStatus("running");
    task.status = "running";
    events.emit("execution.started", "Executing the plan.");

    const { cancelled } = await executePlan({
      task,
      objective,
      provider: resolved,
      tools: toolExecutor,
      state,
      events,
      isCancelled,
    });

    task.updatedAt = now();

    if (cancelled) {
      state.finish("cancelled");
      task.status = "cancelled";

      const summary = "The execution was cancelled before it finished.";
      events.emit("execution.cancelled", summary);

      return finalise({
        executionId,
        task,
        state,
        events,
        provider,
        resultStatus: "cancelled",
        summary,
        errors: state.snapshot().errors,
      });
    }

    state.setStatus("evaluating");
    events.emit("execution.evaluating", "Evaluating the results.");

    const evaluation = await evaluateExecution({
      task,
      objective,
      provider: resolved,
      errors: state.snapshot().errors,
    });

    state.finish(evaluation.status);
    task.status = evaluation.status === "completed" ? "completed" : "failed";
    task.updatedAt = now();

    events.emit(
      evaluation.status === "completed"
        ? "execution.completed"
        : "execution.failed",
      evaluation.summary,
      {
        data: {
          narrativeGenerated: evaluation.narrativeGenerated,
          errorCount: evaluation.errors.length,
        },
      },
    );

    return finalise({
      executionId,
      task,
      state,
      events,
      provider,
      resultStatus: task.status,
      summary: evaluation.summary,
      errors: evaluation.errors,
    });
  } catch (error) {
    const executionError = toAgentExecutionError(error);
    const summary = `The execution failed. ${describeError(executionError)}`;

    state.addError(executionError);
    state.finish("failed");
    task.status = "failed";
    task.updatedAt = now();

    events.emit("execution.failed", summary, {
      data: { code: executionError.code },
    });

    return finalise({
      executionId,
      task,
      state,
      events,
      provider,
      resultStatus: "failed",
      summary,
      errors: state.snapshot().errors,
    });
  }
}
