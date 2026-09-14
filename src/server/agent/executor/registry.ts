import type { Tool } from "@/types/agent";

/**
 * The tool seam.
 *
 * Phase 3 ships this registry **empty**, deliberately. The tool ecosystem is
 * Phase 4's subject, and the brief for this phase is explicit that web search,
 * browsing, scraping and external integrations are out of scope.
 *
 * What is in scope is the engine's behaviour when a plan asks for a capability
 * the runtime cannot supply — and that behaviour only exists if there is a
 * place to look the capability up. So the registry is the lookup, and it
 * currently answers "no" to everything. Every step naming a tool therefore
 * fails with `capability_unavailable`, reported plainly. Nothing is stubbed,
 * and no placeholder returns invented data.
 */

export interface ToolInvocationContext {
  executionId: string;
  stepId: string;
  objective: string;
}

export interface AgentTool {
  id: string;
  name: string;
  description: string;
  /**
   * Runs the tool.
   *
   * `input` comes from the planner and is therefore untrusted: an implementation
   * must validate it before use. A tool must not receive credentials through
   * this channel, and must not be able to reach the filesystem, a shell or a
   * browser — no such tool exists here, and none should be added without
   * revisiting the security section of the architecture document.
   */
  run(
    input: Record<string, unknown>,
    context: ToolInvocationContext,
  ): Promise<Record<string, unknown>>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    if (this.tools.has(tool.id)) {
      throw new Error(`A tool with id "${tool.id}" is already registered.`);
    }

    this.tools.set(tool.id, tool);
  }

  resolve(toolId: string): AgentTool | undefined {
    return this.tools.get(toolId);
  }

  /** Domain view of what is registered, for display and for the API. */
  list(): Tool[] {
    return [...this.tools.values()].map((tool) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
    }));
  }

  get size(): number {
    return this.tools.size;
  }
}

/**
 * Builds the registry for a run.
 *
 * A function rather than a shared singleton: registries are cheap, and a
 * process-wide mutable one would let one run's registrations leak into another's
 * — the same class of bug the store avoids. Phase 3 registers nothing here.
 */
export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}
