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
 * Phase 4 added the tool vocabulary that survives the wire — `ToolCapability`,
 * `ToolInput`, `ToolOutput`, `ToolExecutionStatus` — and reshaped `Tool` and
 * `ToolExecution`, neither of which had a producer or a consumer in Phase 3.
 * The *executable* half of the tool system (`ToolDefinition`, `ToolPermission`,
 * `ToolExecutionContext`, `ToolReceipt`) lives in
 * `src/server/agent/tools/definition.ts`, because it holds functions and Zod
 * schemas and therefore cannot live in this file: everything here must be
 * serializable, and a function or a `ZodType` is not.
 *
 * Phase 5 added the research vocabulary in `src/types/research.ts`, beside this
 * file rather than inside it. The two types research needed from here —
 * `Observation` and `ExecutionProvider` — are imported rather than copied, so a
 * research run and an agent run cannot drift into two spellings of the same
 * idea. Only the nouns research adds are new, and they are new in their own
 * file.
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
  /**
   * Input for that tool, as the planner proposed it.
   *
   * Untrusted by construction: it originates from model output, so a tool's own
   * `inputSchema` is what makes it safe, and `ToolExecutor` is what applies it.
   * Nothing downstream of the planner may assume this is well-formed.
   */
  toolInput?: ToolInput;
  execution?: ToolExecution;
  outcome?: StepOutcome;
  createdAt: string;
  updatedAt: string;
}

/**
 * What a tool is allowed to reach.
 *
 * The list is deliberately short and closed. A tool declares exactly which of
 * these it needs, and a run grants exactly which of these it permits; anything
 * not granted is refused. `read_only` is the only capability Phase 4 ships a
 * tool for, and it is the only one a run grants by default.
 *
 * There is no `shell`, `filesystem`, `code_execution` or `credentials` member —
 * not because they are unimplemented, but because a tool that needs them is a
 * design error at this layer, and leaving them out of the union means such a
 * tool cannot express its need in the type system at all.
 */
export type ToolCapability =
  | "read_only"
  | "network"
  | "data_access"
  | "user_action";

/** Untrusted input for a tool, exactly as the planner proposed it. */
export type ToolInput = Record<string, unknown>;

/**
 * What a tool returns on success.
 *
 * A plain object for the same reason every other type here is plain: it becomes
 * an `Observation.output` and crosses the HTTP boundary, so it must survive
 * `JSON.stringify` unchanged. A tool must not return a class instance, a `Map`
 * or a live SDK response.
 */
export type ToolOutput = Record<string, unknown>;

/**
 * Lifecycle state of one tool call.
 *
 * Narrower than `TaskStatus` for the same reason `StepStatus` is: a tool call is
 * never `planning` or `awaiting_input`, and admitting those values would let a
 * caller write a state no code path can produce. A tool call is recorded only
 * once it has finished, so `running` describes the receipt for a call that was
 * still in flight when it failed, not a state anything polls for.
 */
export type ToolExecutionStatus = "running" | "succeeded" | "failed";

/**
 * Public metadata for a registered tool.
 *
 * This is the projection a caller sees — the `/api/tools` response and the
 * registry's `list()`. It carries no `execute` function and no Zod schema,
 * because neither is serializable and neither is a caller's business; the
 * behaviour stays behind `ToolExecutor`.
 *
 * Phase 4 removed the `inputSchema` field Phase 1 sketched here. It could not
 * have been honoured: a real schema is a `ZodType`, which does not survive
 * `JSON.stringify`, so keeping the field would have meant either lying about
 * its contents or leaking internals over the wire. The schema lives on
 * `ToolDefinition` instead, where it is actually used.
 */
export interface Tool {
  id: string;
  name: string;
  description?: string;
  /** Tool version. Recorded on every receipt so a result can be explained later. */
  version?: string;
  /** Every capability this tool requires. A run must grant all of them. */
  capabilities: ToolCapability[];
}

/**
 * The record of one tool call, stored on the step that made it.
 *
 * Phase 1 defined this type and nothing ever wrote one. Phase 4 gives it a
 * producer: `ToolExecutor` builds the receipt for every call and the executor
 * assigns it to `TaskStep.execution`, so a finished run can answer "what tool
 * did Orion use, with what input, and what happened?" without re-deriving it.
 *
 * Two changes were made when the producer arrived, both safe precisely because
 * nothing had ever produced or read this type:
 *
 *   - `status` narrowed from `TaskStatus` to `ToolExecutionStatus`, so a tool
 *     call cannot be described as `planning`.
 *   - `error` became an `AgentExecutionError` rather than a bare string. A
 *     string loses the machine-readable code, and "the input was invalid" and
 *     "the tool was denied" are fixed by different people.
 */
export interface ToolExecution {
  id: string;
  stepId: string;
  toolId: string;
  /** Version of the tool as it ran, so a later change is visible after the fact. */
  toolVersion?: string;
  status: ToolExecutionStatus;
  input?: ToolInput;
  output?: ToolOutput;
  error?: AgentExecutionError;
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
  /**
   * Where the observation came from.
   *
   * Phase 4 added this so a tool's finding is distinguishable from a model's
   * without inspecting the output's shape. The distinction is the honest one a
   * reader needs: "the text-analysis tool counted 42 words" is a measurement,
   * while "the model answered with a summary" is a generated claim, and a
   * result that blurs them is a result that overstates itself.
   *
   * Absent on observations written before Phase 4 and on any that neither a
   * tool nor the engine explicitly attributes; readers should treat a missing
   * value as "not stated" rather than as "model".
   */
  source?: "engine" | "tool";
  /** Set alongside `source: "tool"`. The tool that produced this observation. */
  toolId?: string;
}

/**
 * A machine-readable execution failure.
 *
 * Errors are values, not exceptions, once they cross into the state tree: a
 * run that fails must still be returnable to the client with its partial
 * results intact. `code` is the stable contract; `message` is for humans and
 * may be reworded. `details` must never carry credentials or raw provider
 * payloads — see the security rules in `docs/TOOL_SYSTEM.md` §11.
 *
 * Phase 4 added the three `tool_*` codes. "The tool is not registered" is
 * deliberately NOT among them: that case keeps its Phase 3 code,
 * `capability_unavailable`, which already means exactly it and is already
 * covered by the engine's tests. A second code for the same condition would be
 * two contracts for one fact.
 *
 * Phase 5 added two more, and only after checking that nothing existing meant
 * them. `search_not_configured` is not `capability_unavailable`: the latter says
 * this build has no such tool, and the former says it has one that cannot run
 * until an operator sets a variable. Those are fixed by different people, which
 * is the test for whether a code is warranted. `research_limit_reached` is not
 * `iteration_limit_reached` for the same reason — one counts passes through a
 * loop, the other counts sources, findings and elapsed time, and a run can reach
 * either without approaching the other.
 *
 * **`research_limit_reached` currently has no producer, and that is recorded
 * rather than hidden.** A limit that was reached travels to the caller on
 * `ResearchResult.limitsReached`, as a `ResearchLimitKind`, because reaching a
 * ceiling is not a failure: the run returns what it found and is reported
 * `insufficient` rather than `failed`. Putting the same fact in `errors` as well
 * would give one condition two representations and make a partial success look
 * like a malfunction. The code stays declared for a consumer that needs to treat
 * a limit as an error — a batch or scheduled runner, which would want to retry
 * with a higher ceiling — and it will get its producer in the phase that adds
 * one. Until then, nothing emits it, and no test asserts it.
 */
export type AgentErrorCode =
  | "invalid_objective"
  | "planner_failed"
  | "invalid_plan"
  | "executor_failed"
  | "capability_unavailable"
  | "invalid_tool_input"
  | "tool_permission_denied"
  | "tool_failed"
  | "evaluation_failed"
  | "iteration_limit_reached"
  | "search_not_configured"
  | "research_limit_reached"
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
 *
 * Phase 4 added the three `tool.*` members. They are distinct from the
 * `step.*` members that bracket them because a step and its tool call are not
 * the same thing: a step can fail because a tool was refused, and an operator
 * reading the log needs to see the refusal and the step failure as the two
 * separate facts they are.
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
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
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
 * only after a step fails. `registeredTools` was empty in Phase 3 and is not
 * any more: it now lists the tools the run will actually be able to call, which
 * is the difference between a user expecting research and a user understanding
 * why a research step will still be refused.
 */
export interface EngineCapabilities {
  provider: ExecutionProvider | null;
  /**
   * Tool ids registered for a run, in registration order.
   *
   * Ids only, deliberately. The full metadata — descriptions, versions,
   * capabilities — is served by `/api/tools`, so this stays a cheap field on a
   * status panel rather than a second copy of the catalogue.
   */
  registeredTools: string[];
  /** Present when the provider could not be resolved from the environment. */
  configurationError?: string;
}

/**
 * The `/api/tools` response: what Orion can do, and what it may be permitted to
 * do.
 *
 * Declared here rather than beside the service that produces it because the
 * workspace renders it, and a client component must never import from
 * `src/server/**` — that would pull the service, and everything it reaches,
 * into the browser bundle. A wire shape belongs in the shared vocabulary for
 * exactly this reason; `docs/ARCHITECTURE.md` §4 is the rule this follows.
 */
export interface ToolCatalog {
  tools: Tool[];
  /** Capabilities a run is granted. A tool requiring anything else is refused. */
  grantedCapabilities: ToolCapability[];
}
