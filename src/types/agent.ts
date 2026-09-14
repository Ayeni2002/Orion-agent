/**
 * Core domain vocabulary for Orion's agent system.
 *
 * These describe the *shape* of the domain only. There is deliberately no
 * planner, executor, scheduler or provider here — Phase 1 defines the words
 * that later phases will operate on, so that the planner and the tool runtime
 * can be added without reshaping the rest of the application.
 *
 * Extending these safely: prefer adding optional fields or new union members
 * over changing existing ones. Timestamps are ISO 8601 strings rather than
 * `Date` objects so every type here survives a JSON round-trip unchanged
 * (a `Date` becomes a string across the wire and back, silently breaking the
 * type). Convert at the edge, not in the type.
 *
 * Phase 3 added the execution vocabulary — `StepStatus`, `ExecutionStatus`,
 * `Observation`, `ExecutionState`, `AgentEvent` and `AgentExecution` — and
 * narrowed `TaskStep.status` from `TaskStatus` to `StepStatus`. Everything
 * that Phase 1 defined is still here; nothing was replaced.
 *
 * Every type in this file is serializable by construction. That is a hard
 * requirement, not a style preference: execution state crosses the HTTP
 * boundary and is written to logs, and a `Map`, `Set` or class instance would
 * silently become `{}` on the way. Keep it to plain objects, arrays, strings
 * and numbers.
 */

/** Lifecycle state of a task or an agent run. */
export type TaskStatus =
  | "pending"
  | "planning"
  | "running"
  | "awaiting_input"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Lifecycle state of a single step.
 *
 * Deliberately narrower than `TaskStatus`: a step is never `planning` or
 * `awaiting_input`, and allowing those values would let callers write states
 * the executor can never produce. `skipped` is a terminal state reached when a
 * dependency failed or the evaluator stopped the run before that step.
 */
export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

/**
 * Lifecycle state of an execution — the run that wraps a task.
 *
 * Distinct from `TaskStatus` because a run has stages a task does not
 * (`evaluating`) and because the two evolve on different clocks: the task is
 * the durable record, the execution is one attempt at it. A task may be
 * re-run, producing a second execution.
 */
export type ExecutionStatus =
  | "created"
  | "planning"
  | "running"
  | "evaluating"
  | "completed"
  | "failed"
  | "cancelled";

/** How a single step finished, independent of the run's overall status. */
export type StepOutcome = "succeeded" | "failed" | "skipped";

export interface Agent {
  id: string;
  name: string;
  description?: string;
  /** Free-form capability hints. Later phases will formalise this. */
  capabilities?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentTask {
  id: string;
  agentId: string;
  /** The user's goal, in their own words. */
  objective: string;
  status: TaskStatus;
  steps: TaskStep[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskStep {
  id: string;
  taskId: string;
  /** Position within the plan. Stable for a given plan revision. */
  index: number;
  description: string;
  status: StepStatus;
  /** Ids of steps that must complete before this one may run. */
  dependsOn?: string[];
  /** What this step is expected to produce, in the planner's words. */
  expectedOutput?: string;
  /** Id of the `Tool` this step intends to use, if any. */
  toolId?: string;
  execution?: ToolExecution;
  outcome?: StepOutcome;
  createdAt: string;
  updatedAt: string;
}

export interface Tool {
  id: string;
  name: string;
  description?: string;
  /**
   * Description of accepted input. Kept loose in Phase 1 — a tool runtime
   * will want a real schema, but nothing consumes this yet.
   */
  inputSchema?: Record<string, unknown>;
}

export interface ToolExecution {
  id: string;
  stepId: string;
  toolId: string;
  status: TaskStatus;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

/**
 * A single structured observation produced during execution.
 *
 * Observations are the engine's record of what actually happened, as opposed
 * to what was planned. They are the only channel through which a step reports
 * back, which is what keeps "the tool said X" distinguishable from "the run
 * concluded Y" — the evaluator reads observations, and never invents them.
 *
 * `output` is deliberately `Record<string, unknown>` rather than `any`: it must
 * survive `JSON.stringify` and it must not carry functions, class instances or
 * a live SDK response object into the state tree.
 */
export interface Observation {
  id: string;
  /** Absent for observations about the run itself rather than a step. */
  stepId?: string;
  timestamp: string;
  status: StepStatus;
  /** What happened, in one line, for a human reading the run afterwards. */
  message: string;
  output?: Record<string, unknown>;
  /** Present only when this observation records a failure. */
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * A machine-readable execution failure.
 *
 * Errors are values, not exceptions, once they cross into the state tree: a
 * run that fails must still be returnable to the client with its partial
 * results intact. `code` is the stable contract; `message` is for humans and
 * may be reworded. `details` must never carry credentials or raw provider
 * payloads — see the security note in `docs/ARCHITECTURE.md` §12.
 */
export type AgentErrorCode =
  | "invalid_objective"
  | "planner_failed"
  | "invalid_plan"
  | "executor_failed"
  | "capability_unavailable"
  | "evaluation_failed"
  | "iteration_limit_reached"
  | "internal_error"
  | "cancelled";

export interface AgentExecutionError {
  code: AgentErrorCode;
  message: string;
  stepId?: string;
  details?: Record<string, unknown>;
}

/**
 * The minimum state needed to inspect or resume an execution.
 *
 * Scope is deliberately tight. This is *task state*, not memory: it describes
 * one run in progress and is discarded when the run is gone. Long-term memory —
 * what Orion retains between runs — has no representation here and must not be
 * conflated with this. See `docs/ARCHITECTURE.md` §8.
 *
 * `completedStepIds` duplicates information present in `TaskStep.status`. That
 * redundancy is intentional: it lets a reader answer "how far did this get?"
 * without walking the plan, which is the question asked most often and the one
 * that must stay cheap when the plan is large.
 */
export interface ExecutionState {
  executionId: string;
  objective: string;
  status: ExecutionStatus;
  /** Id of the step currently running, if any. */
  currentStepId?: string;
  completedStepIds: string[];
  observations: Observation[];
  errors: AgentExecutionError[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
}

/**
 * The lifecycle transitions worth telling someone about.
 *
 * A closed union rather than free-form strings so the frontend can switch on
 * it exhaustively and gain a compile error when a new event type appears —
 * which is the whole point of emitting events rather than polling state.
 */
export type AgentEventType =
  | "execution.created"
  | "execution.planning"
  | "execution.planned"
  | "execution.started"
  | "step.started"
  | "step.completed"
  | "step.failed"
  | "step.skipped"
  | "execution.evaluating"
  | "execution.completed"
  | "execution.failed"
  | "execution.cancelled";

export interface AgentEvent {
  id: string;
  executionId: string;
  type: AgentEventType;
  timestamp: string;
  stepId?: string;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * A complete execution record: the task, its state, its event log and — once
 * the run finishes — its result.
 *
 * The three parts are separated rather than flattened because they have
 * different lifetimes. `state` is the live, mutable view the UI follows;
 * `events` is an append-only history for explaining what happened; `result` is
 * written once and never changes.
 */
/**
 * Which engine produced an execution.
 *
 * Carried on the execution itself rather than inferred at display time, so a
 * result can never be separated from the provenance that says how it was made.
 * `isExternal` is the field that matters: when it is false, the run was
 * produced by a deterministic local adapter and must be presented as such — a
 * development run is a real engine execution, but it is not a model's work and
 * must not be described as one.
 */
export interface ExecutionProvider {
  id: string;
  /** For display. Never contains credentials or a base URL with one embedded. */
  label: string;
  model: string;
  /** True only when real inference ran against an external service. */
  isExternal: boolean;
}

export interface AgentExecution {
  id: string;
  task: AgentTask;
  state: ExecutionState;
  events: AgentEvent[];
  provider: ExecutionProvider;
  result?: AgentResult;
}

export interface AgentResult {
  taskId: string;
  /** The execution that produced this result. */
  executionId?: string;
  status: TaskStatus;
  /** Human-readable summary of what the run produced. */
  summary?: string;
  /** Structured findings. Shape firms up in a later phase. */
  findings?: unknown[];
  /** Populated when `status` is "failed". */
  error?: string;
  /** Structured failures, when there is more than one to report. */
  errors?: AgentExecutionError[];
  completedAt?: string;
}

/**
 * What the engine can currently do, readable without starting a run.
 *
 * Reported before a run so the workspace can be honest up front rather than
 * only after a step fails. `registeredTools` is the field that matters in
 * Phase 3: it is empty, and saying so is the difference between a user
 * expecting research and a user understanding why a research step will be
 * refused.
 */
export interface EngineCapabilities {
  provider: ExecutionProvider | null;
  /** Tool ids registered for a run. Empty in Phase 3, by design. */
  registeredTools: string[];
  /** Present when the provider could not be resolved from the environment. */
  configurationError?: string;
}
