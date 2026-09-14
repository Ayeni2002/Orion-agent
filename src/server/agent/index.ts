/**
 * The agent engine.
 *
 * Public surface of everything under `src/server/agent`. Callers outside the
 * engine — services, routes, tests — import from here rather than reaching into
 * subdirectories, so the internal layout stays free to change.
 *
 * There is no web search, browser automation, scraping or external integration
 * anywhere behind this barrel, and no tool implementations at all. The tool
 * ecosystem is a later phase; see `executor/registry.ts` for what that means in
 * practice.
 */

export { AGENT_ID, runAgent } from "./runtime/runner";
export type { RunAgentParams } from "./runtime/runner";

export { resolveModelProvider } from "./provider";
export type {
  ModelOperation,
  ModelProvider,
  ModelProviderRequest,
  ModelProviderResponse,
} from "./provider";

export {
  createToolRegistry,
  ToolRegistry,
} from "./executor/registry";
export type { AgentTool, ToolInvocationContext } from "./executor/registry";

export { AgentEngineError, toAgentExecutionError } from "./errors";

export {
  clearExecutions,
  getExecution,
  listExecutions,
  saveExecution,
} from "./runtime/store";
