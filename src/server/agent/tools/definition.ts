import type { ZodType, infer as ZodInfer } from "zod";

import type {
  Tool,
  ToolCapability,
  ToolExecution,
  ToolInput,
  ToolOutput,
} from "@/types/agent";

/**
 * The tool vocabulary that cannot live in `src/types/agent.ts`.
 *
 * That file holds only what crosses the wire, so everything in it is
 * serializable. A `ToolDefinition` holds a Zod schema and an `execute` function
 * — neither survives `JSON.stringify` — so the executable half of the tool
 * system lives here instead. The split is the same one the provider seam makes:
 * `src/types/agent.ts` has `ExecutionProvider`, an inert descriptor, while
 * `provider/provider.ts` has the `ModelProvider` that can actually run.
 *
 * The relationship between the two halves is projection, not duplication:
 * `ToolRegistry.list()` turns each `ToolDefinition` into a `Tool`, dropping the
 * schema and the function. That is what makes `/api/tools` safe to serve — the
 * metadata a caller can read is a strict subset of what a tool is.
 */

/**
 * The capabilities a run is allowed to exercise.
 *
 * **Deny by default.** A capability that is not listed is refused, so the empty
 * permission grants nothing and there is no "allow everything" constructor to
 * reach for by accident. A run is created with `DEFAULT_TOOL_PERMISSION`, and
 * widening it is a deliberate act with a visible call site rather than a
 * default that quietly applies.
 *
 * A class rather than a bare array so the rule lives in one place: callers ask
 * `allows()`, and `ToolRegistry.canExecute` asks `missingFor()`, instead of
 * each re-implementing a `.includes()` that one of them will eventually get
 * wrong.
 */
export class ToolPermission {
  private readonly granted: ReadonlySet<ToolCapability>;

  constructor(granted: readonly ToolCapability[]) {
    this.granted = new Set(granted);
  }

  /** Builds a permission from an explicit list. Reads better at a call site. */
  static only(...capabilities: ToolCapability[]): ToolPermission {
    return new ToolPermission(capabilities);
  }

  allows(capability: ToolCapability): boolean {
    return this.granted.has(capability);
  }

  /**
   * Every capability a tool needs that this permission does not grant.
   *
   * Returns all of them rather than the first, because a tool that needs
   * `network` and `data_access` should not have to be run twice to learn that
   * both were refused.
   */
  missingFor(tool: { capabilities: readonly ToolCapability[] }): ToolCapability[] {
    return tool.capabilities.filter((capability) => !this.granted.has(capability));
  }

  /** For display and for error details. Order is not meaningful. */
  list(): ToolCapability[] {
    return [...this.granted];
  }
}

/**
 * What a run grants by default: reading, and nothing else.
 *
 * Every tool Phase 4 ships declares `read_only` and is satisfied by this. A
 * future tool needing `network` will be refused with `tool_permission_denied`
 * until someone widens the grant on purpose — which is the intended friction.
 */
export const DEFAULT_TOOL_PERMISSION: ToolPermission = ToolPermission.only("read_only");

/**
 * Everything a tool is given about the run it is part of.
 *
 * Deliberately small. A tool receives this and its validated input, and nothing
 * else: no filesystem handle, no shell, no database client, no `process.env`, no
 * ambient fetch with credentials attached. Whatever a tool needs must be passed
 * to it explicitly at construction, which is what makes "tools receive explicit
 * dependencies" a structural property rather than a rule someone follows.
 */
export interface ToolExecutionContext {
  executionId: string;
  taskId: string;
  stepId: string;
  toolId: string;
  /** The user's objective, as given. Used for context, never as instruction. */
  objective: string;
  /** When the call began. The receipt carries this too; a tool may want it. */
  startedAt: string;
  /**
   * What this run is permitted to do. Provided for a tool that wants to reason
   * about its own limits; the authoritative check happens in `ToolExecutor`
   * before `execute` is ever reached.
   */
  grantedCapabilities: readonly ToolCapability[];
  /**
   * The acting user, when there is one.
   *
   * Always absent in Phase 4 — there is no authentication until the
   * persistence phase, and a fabricated user id would be worse than none.
   */
  userId?: string;
}

/**
 * The complete record of one tool call.
 *
 * This is the audit trail §7 of the Phase 4 brief asks for, and it is the
 * producer `ToolExecution` has been waiting for since Phase 1. It extends
 * `ToolExecution` rather than paralleling it, so the thing stored on a step and
 * the thing the executor returns are the same shape and cannot drift.
 *
 * The two extra fields are the run identifiers, which the receipt needs to be
 * meaningful on its own in a log and which the step already has by context.
 *
 * Nothing here is redacted, because nothing here is sensitive: `input` is the
 * planner's validated input and `output` is the tool's own returned data. What
 * the receipt must never carry — and does not — is a credential, an environment
 * variable, or a raw upstream payload, none of which is reachable from inside a
 * tool in the first place.
 */
export interface ToolReceipt extends ToolExecution {
  executionId: string;
  taskId: string;
}

/**
 * A tool, as the registry and executor see it.
 *
 * `execute` takes `unknown` rather than the schema's inferred type. That is the
 * one type-erased seam in the tool system, and it is deliberate: the registry
 * holds tools of different input types in one map, and a `Map<string, T>` over
 * heterogeneous generics is not expressible without the erasable form. The cast
 * inside `defineTool` is sound because `ToolDefinition.execute` is only ever
 * reached through `ToolExecutor`, which parses the input against `inputSchema`
 * first and throws `invalid_tool_input` when it does not match. Nothing else
 * may call it; `ToolRegistry.get()` returns this type for the executor's use,
 * not as a public execution surface.
 */
export interface ToolDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  /** Every capability this tool requires. The run must grant all of them. */
  readonly capabilities: readonly ToolCapability[];
  /** Validates untrusted planner input before `execute` is called. */
  readonly inputSchema: ZodType;
  execute(input: unknown, context: ToolExecutionContext): Promise<ToolOutput>;
}

/**
 * Declares a tool with a typed `execute`.
 *
 * The point of this helper is that the author writes `execute(input: MyInput)`
 * and gets a compile error on a typo, while the registry still stores a
 * uniformly-typed definition. The single cast is the price of that, and it is
 * contained here rather than repeated at every tool.
 *
 * It does NOT validate. Validation belongs to `ToolExecutor`, which must apply
 * it to input arriving from the planner; a tool that validated its own input
 * would be a tool that could be called unvalidated by anything bypassing the
 * executor.
 */
export function defineTool<Schema extends ZodType>(config: {
  id: string;
  name: string;
  description: string;
  version: string;
  capabilities: readonly ToolCapability[];
  inputSchema: Schema;
  execute(
    input: ZodInfer<Schema>,
    context: ToolExecutionContext,
  ): Promise<ToolOutput>;
}): ToolDefinition {
  return {
    id: config.id,
    name: config.name,
    description: config.description,
    version: config.version,
    capabilities: config.capabilities,
    inputSchema: config.inputSchema,
    // Sound only under the `ToolExecutor` contract described on
    // `ToolDefinition.execute` above.
    execute: (input, context) =>
      config.execute(input as ZodInfer<Schema>, context),
  };
}

/** The public projection of a definition. Used by the registry and `/api/tools`. */
export function toToolMetadata(definition: ToolDefinition): Tool {
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    version: definition.version,
    capabilities: [...definition.capabilities],
  };
}

/** Re-exported so tool modules import their input type from one place. */
export type { ToolInput, ToolOutput };
