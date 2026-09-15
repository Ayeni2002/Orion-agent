import type { ToolCatalog } from "@/types/agent";
import { createDefaultToolRegistry, DEFAULT_TOOL_PERMISSION } from "../agent";

/**
 * The tool catalogue, as the rest of the application sees it.
 *
 * A second service module alongside `agent.ts`, following the convention stated
 * in `./index.ts`: a service takes plain arguments, returns plain data, and
 * imports no React and nothing from `next/headers`.
 *
 * What this deliberately does NOT do is expose a way to run a tool. There is no
 * `executeTool(input)` here and there must not be one: tool calls happen inside
 * the agent execution flow, where the input has been validated against the
 * tool's schema and the run's permission has been checked. An endpoint that ran
 * an arbitrary tool on an arbitrary input would be a general-purpose execution
 * surface with a friendly name, and would bypass every control the tool system
 * exists to impose.
 */

/**
 * Reads the catalogue.
 *
 * Built fresh per call rather than held in a module-level singleton, matching
 * how the runner builds a registry per run — a shared mutable catalogue is the
 * kind of state that leaks between requests.
 *
 * The return shape is the domain type from `src/types/agent.ts` rather than one
 * declared here, so the workspace can consume the same response without
 * importing this module. See `ToolCatalog` for why that matters.
 */
export function getToolCatalog(): ToolCatalog {
  const registry = createDefaultToolRegistry();

  return {
    tools: registry.list(),
    grantedCapabilities: DEFAULT_TOOL_PERMISSION.list(),
  };
}
