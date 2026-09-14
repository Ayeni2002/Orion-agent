import type {
  AgentExecution,
  EngineCapabilities,
  ExecutionProvider,
  ExecutionStatus,
} from "@/types/agent";
import { objectiveSchema } from "@/lib/validation/objective";
import {
  createToolRegistry,
  getExecution,
  listExecutions,
  resolveModelProvider,
  runAgent,
  saveExecution,
} from "../agent";
import { ServiceError } from "../errors";

/**
 * Agent execution, as the rest of the application sees it.
 *
 * The engine returns data and does not throw; this layer decides what that data
 * means over HTTP. Validation of the objective happens here, at the boundary,
 * so the engine can assume it was handed a well-formed objective and never has
 * to re-check one.
 *
 * Nothing here accepts execution state from a caller. A run's status, its
 * completed steps and its result are produced by the engine alone — there is no
 * parameter through which a client could assert that work was done, which is
 * what makes "do not allow clients to arbitrarily mark tasks completed" a
 * structural property rather than a validation rule someone could forget.
 */

/**
 * Describes the engine without running it.
 *
 * Reports a configuration failure as data rather than throwing: this feeds a
 * status panel, and a status panel that 500s tells the user nothing. The failure
 * is returned so the UI can say what is wrong.
 */
export function getEngineCapabilities(): EngineCapabilities {
  try {
    const provider = resolveModelProvider();
    const registry = createToolRegistry();

    return {
      provider: { ...provider.descriptor },
      registeredTools: registry.list().map((tool) => tool.id),
    };
  } catch (error) {
    return {
      provider: null,
      registeredTools: [],
      configurationError:
        error instanceof Error
          ? error.message
          : "The model provider could not be configured.",
    };
  }
}

/**
 * Runs an execution to completion and returns it.
 *
 * `input` is `unknown` on purpose — it arrives from a request body and must be
 * treated as untrusted until the schema has passed it. The run finishes inside
 * this call: there is no background worker and no queue, so by the time this
 * resolves the execution is in a terminal state and carries its own result.
 */
export async function startExecution(input: unknown): Promise<AgentExecution> {
  const parsed = objectiveSchema.safeParse(input);

  if (!parsed.success) {
    throw new ServiceError(
      parsed.error.issues.map((issue) => issue.message).join(" ") ||
        "The objective is not valid.",
      400,
    );
  }

  const execution = await runAgent({ objective: parsed.data.objective });

  // Recorded after the run rather than before, so the store only ever holds
  // executions that have actually finished. A caller polling an in-flight run
  // would be reading a store that cannot answer for it anyway — see
  // `runtime/store.ts`.
  saveExecution(execution);

  return execution;
}

export function getExecutionById(id: string): AgentExecution {
  const execution = getExecution(id);

  if (execution === undefined) {
    throw new ServiceError("No execution with that id was found.", 404);
  }

  return execution;
}

export function listRecentExecutions(): AgentExecution[] {
  return listExecutions();
}

/**
 * A list entry, without the parts that only matter once you open one.
 *
 * A full execution carries its plan, every observation and the whole event log,
 * which is the right size for a detail view and the wrong size for a list of
 * fifty. Summaries keep the list endpoint cheap and make the response shape say
 * what it is for.
 */
export interface ExecutionSummary {
  id: string;
  objective: string;
  status: ExecutionStatus;
  provider: ExecutionProvider;
  stepCount: number;
  completedStepCount: number;
  createdAt: string;
  finishedAt?: string;
  /** The result's summary, once the run has produced one. */
  summary?: string;
}

export function toExecutionSummary(execution: AgentExecution): ExecutionSummary {
  return {
    id: execution.id,
    objective: execution.task.objective,
    status: execution.state.status,
    provider: execution.provider,
    stepCount: execution.task.steps.length,
    completedStepCount: execution.state.completedStepIds.length,
    createdAt: execution.state.createdAt,
    ...(execution.state.finishedAt === undefined
      ? {}
      : { finishedAt: execution.state.finishedAt }),
    ...(execution.result?.summary === undefined
      ? {}
      : { summary: execution.result.summary }),
  };
}

export function listRecentExecutionSummaries(): ExecutionSummary[] {
  return listExecutions().map(toExecutionSummary);
}
