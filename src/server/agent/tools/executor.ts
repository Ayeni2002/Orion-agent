import type { AgentExecutionError, ToolInput, ToolOutput } from "@/types/agent";
import { createId, now } from "../ids";
import {
  DEFAULT_TOOL_PERMISSION,
  type ToolExecutionContext,
  type ToolPermission,
  type ToolReceipt,
} from "./definition";
import type { ToolRegistry } from "./registry";

/**
 * The tool executor: the only sanctioned way to call a tool.
 *
 * It exists so that `executePlan` does not have to know how a tool is
 * validated, permitted, timed, recorded or failed. The plan-walking executor
 * asks this layer for a receipt and gets one — always. It never has to catch,
 * because this layer never throws for anything a tool did.
 *
 * The pipeline, in order, and the order matters:
 *
 *   1. resolve the tool          → unregistered means `capability_unavailable`
 *   2. check permissions         → BEFORE validation, so a tool the run may not
 *                                  use is refused without its schema being fed
 *                                  untrusted input at all
 *   3. validate the input        → `invalid_tool_input`
 *   4. execute                   → a throw from the tool becomes `tool_failed`
 *   5. build the receipt         → success or failure, always returned
 *
 * **It always returns a receipt and never throws.** A failed tool call is data,
 * not an exception: the run has to keep going, the step has to record what
 * happened, and the evaluator has to be able to read it. Letting a tool's
 * exception escape would make one flaky tool capable of destroying an otherwise
 * sound run, which is exactly what §11 of the brief rules out.
 *
 * **Permissions are held, not passed.** The permission is a constructor
 * argument, not a per-call parameter, so there is no signature through which a
 * caller could grant itself a capability it was not given. A caller that wants
 * a wider grant has to construct a different executor, which is a visible act
 * in a diff.
 */
export class ToolExecutor {
  private readonly registry: ToolRegistry;
  private readonly permission: ToolPermission;

  constructor(
    registry: ToolRegistry,
    permission: ToolPermission = DEFAULT_TOOL_PERMISSION,
  ) {
    this.registry = registry;
    this.permission = permission;
  }

  /** Ids this executor can resolve. What the capabilities endpoint reports. */
  get registeredToolIds(): string[] {
    return this.registry.ids();
  }

  /** For a caller that needs to explain why something was refused. */
  get grantedCapabilities(): readonly string[] {
    return this.permission.list();
  }

  async execute(request: ExecuteToolRequest): Promise<ToolReceipt> {
    const startedAt = now();

    // Shared by every receipt this call produces, so a failure path cannot
    // forget one of the identifying fields.
    const base = {
      id: createId("tool"),
      executionId: request.executionId,
      taskId: request.taskId,
      stepId: request.stepId,
      toolId: request.toolId,
      status: "failed",
      startedAt,
    } as const;

    const tool = this.registry.get(request.toolId);

    if (tool === undefined) {
      // The honest answer, and the one Phase 3 already returns for this case.
      // Nothing invents a result for a tool that does not exist.
      return {
        ...base,
        finishedAt: now(),
        error: {
          code: "capability_unavailable",
          message: `This step requires the "${request.toolId}" capability, which is not available in this build.`,
          stepId: request.stepId,
          details: { toolId: request.toolId, registered: this.registry.ids() },
        },
      };
    }

    const context: ToolExecutionContext = {
      executionId: request.executionId,
      taskId: request.taskId,
      stepId: request.stepId,
      toolId: tool.id,
      objective: request.objective,
      startedAt,
      grantedCapabilities: this.permission.list(),
    };

    // Checked before validation: a tool this run may not use should be refused
    // on that ground alone, without its schema first consuming untrusted input.
    if (!this.registry.canExecute(tool, context)) {
      const missing = this.permission.missingFor(tool);

      return {
        ...base,
        toolVersion: tool.version,
        finishedAt: now(),
        error: {
          code: "tool_permission_denied",
          message: `The tool "${tool.id}" requires ${describeCapabilities(missing)}, which this run is not permitted to use.`,
          stepId: request.stepId,
          details: {
            toolId: tool.id,
            required: [...tool.capabilities],
            missing,
            granted: this.permission.list(),
          },
        },
      };
    }

    // Input originates from a model, so it is untrusted until this passes.
    const parsed = tool.inputSchema.safeParse(request.input ?? {});

    if (!parsed.success) {
      return {
        ...base,
        toolVersion: tool.version,
        finishedAt: now(),
        error: {
          code: "invalid_tool_input",
          message: `The input proposed for "${tool.id}" did not match its schema.`,
          stepId: request.stepId,
          details: {
            toolId: tool.id,
            // Path plus message is the actionable part. Capped for the same
            // reason the planner caps its issues: this reaches a client.
            issues: parsed.error.issues.slice(0, 10).map((issue) => ({
              path: issue.path.map(String).join("."),
              message: issue.message,
            })),
            // The top-level keys only. The rejected payload is unbounded and
            // untrusted; naming its shape explains the failure without copying
            // arbitrary model output into the execution state.
            keys: readTopLevelKeys(request.input),
          },
        },
      };
    }

    try {
      const output = await tool.execute(parsed.data, context);

      if (!isPlainObject(output)) {
        // A tool typed as returning `ToolOutput` cannot do this in TypeScript,
        // but a tool is JavaScript at runtime and this is the boundary where
        // that stops being someone else's problem.
        throw new Error(
          `The tool "${tool.id}" returned ${describeType(output)} instead of an object.`,
        );
      }

      return {
        ...base,
        toolVersion: tool.version,
        status: "succeeded",
        input: parsed.data as ToolInput,
        output,
        finishedAt: now(),
      };
    } catch (error) {
      // Logged server-side; deliberately not forwarded. A tool's exception can
      // embed whatever it was working on, and this receipt is returned to a
      // client — the same rule `toAgentExecutionError` applies to the engine.
      console.error(`[agent] tool "${tool.id}" failed:`, error);

      return {
        ...base,
        toolVersion: tool.version,
        // Recorded even though validation passed, so the audit trail shows
        // what the tool was asked to do when it went wrong.
        input: parsed.data as ToolInput,
        finishedAt: now(),
        error: {
          code: "tool_failed",
          message: `The tool "${tool.id}" failed while running.`,
          stepId: request.stepId,
          details: {
            toolId: tool.id,
            errorName: error instanceof Error ? error.name : typeof error,
          },
        },
      };
    }
  }
}

export interface ExecuteToolRequest {
  toolId: string;
  /** Untrusted. Validated against the tool's schema before anything runs. */
  input: unknown;
  executionId: string;
  taskId: string;
  stepId: string;
  objective: string;
}

/** `["network", "data_access"]` → `"the network and data_access capabilities"`. */
function describeCapabilities(capabilities: readonly string[]): string {
  if (capabilities.length === 1) {
    return `the "${capabilities[0]}" capability`;
  }

  return `the ${capabilities.map((capability) => `"${capability}"`).join(", ")} capabilities`;
}

function isPlainObject(value: unknown): value is ToolOutput {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  return Array.isArray(value) ? "an array" : typeof value;
}

/** Top-level keys of an untrusted value, capped, for error details. */
function readTopLevelKeys(value: unknown): string[] {
  if (!isPlainObject(value)) {
    return [];
  }

  return Object.keys(value).slice(0, 20);
}

/**
 * A failed receipt, as an `AgentExecutionError`.
 *
 * The executor carries the structured error on the receipt; the plan executor
 * needs it in the run's error list as well, and this is the one conversion so
 * the two cannot disagree about what went wrong.
 */
export function receiptError(receipt: ToolReceipt): AgentExecutionError {
  return (
    receipt.error ?? {
      code: "internal_error",
      message: `The tool "${receipt.toolId}" reported a failure without recording one.`,
      stepId: receipt.stepId,
    }
  );
}
