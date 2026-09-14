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
 */

/** Lifecycle state of a task, a step, or an agent run. */
export type TaskStatus =
  | "pending"
  | "planning"
  | "running"
  | "awaiting_input"
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
  status: TaskStatus;
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

export interface AgentResult {
  taskId: string;
  status: TaskStatus;
  /** Human-readable summary of what the run produced. */
  summary?: string;
  /** Structured findings. Shape firms up in a later phase. */
  findings?: unknown[];
  /** Populated when `status` is "failed". */
  error?: string;
  completedAt?: string;
}
