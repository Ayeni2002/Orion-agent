import type { Tool } from "@/types/agent";
import {
  toToolMetadata,
  type ToolDefinition,
  type ToolExecutionContext,
} from "./definition";

/**
 * The tool registry: the one place that answers "does Orion have a tool for
 * this?".
 *
 * It holds definitions and knows nothing about any particular tool. No tool id
 * appears in this file, and none appears in the executor — the engine asks the
 * registry by id and works with whatever comes back. That is what makes adding
 * a tool a matter of registering it rather than editing the engine.
 *
 * This replaces `executor/registry.ts` from Phase 3, which held the `AgentTool`
 * interface and an empty `ToolRegistry`. The concept, its job and its emptiness
 * behaviour are unchanged; what changed is that a definition now carries a
 * schema, a version and a capability list, and the lookup has grown the two
 * questions the tool executor needs to ask (`has`, `canExecute`). The old file
 * is gone rather than kept as a second registry — two registries would be two
 * answers to "what can Orion do".
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  /**
   * Adds a tool.
   *
   * Registration is controlled: the only definitions that reach a run are those
   * this process constructed, because there is no path from a request body, a
   * model response or a user to this method. That is the property that keeps
   * the tool set fixed at build time.
   *
   * A duplicate id throws rather than overwriting. Silently replacing a tool
   * would mean the id a plan asked for resolved to something other than what
   * the plan was written against, and the receipt would name a version that
   * never ran.
   */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.id)) {
      throw new Error(`A tool with id "${tool.id}" is already registered.`);
    }

    if (tool.capabilities.length === 0) {
      // A tool that declares no capability has not stated what it needs, and
      // the deny-by-default rule would read that as "needs nothing" — which is
      // exactly the assumption worth refusing to make.
      throw new Error(
        `The tool "${tool.id}" declares no capabilities. Every tool must state what it requires.`,
      );
    }

    this.tools.set(tool.id, tool);
  }

  /** The definition, for the executor. Not an execution surface — see `ToolDefinition`. */
  get(toolId: string): ToolDefinition | undefined {
    return this.tools.get(toolId);
  }

  has(toolId: string): boolean {
    return this.tools.has(toolId);
  }

  /**
   * Whether this run may call this tool.
   *
   * Two conditions, both necessary. The tool must be one this registry holds —
   * checked by identity, so a definition constructed elsewhere cannot be
   * executed merely by claiming a registered id — and the run's permission must
   * grant every capability the tool declares.
   */
  canExecute(tool: ToolDefinition, context: ToolExecutionContext): boolean {
    if (this.tools.get(tool.id) !== tool) {
      return false;
    }

    const granted = new Set(context.grantedCapabilities);
    return tool.capabilities.every((capability) => granted.has(capability));
  }

  /** Public metadata for every registered tool. Contains no executable parts. */
  list(): Tool[] {
    return [...this.tools.values()].map(toToolMetadata);
  }

  /** Registered ids, in registration order. */
  ids(): string[] {
    return [...this.tools.keys()];
  }

  get size(): number {
    return this.tools.size;
  }
}

/**
 * An empty registry.
 *
 * Still the right thing for a test that wants to prove what happens when a plan
 * asks for a tool the runtime does not have — the `capability_unavailable`
 * path. A run does not use this: it uses `createDefaultToolRegistry()`, which
 * holds the catalogue.
 */
export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}
