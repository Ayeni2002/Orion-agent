/**
 * The agent engine.
 *
 * Public surface of everything under `src/server/agent`. Callers outside the
 * engine — services, routes, tests — import from here rather than reaching into
 * subdirectories, so the internal layout stays free to change.
 *
 * Phase 4 gave the engine a tool system: a catalogue, a registry, a validating
 * and permission-checking executor, and one real read-only tool. There is still
 * no web search, browser automation, scraping or external integration anywhere
 * behind this barrel — not by omission, but because the capability union those
 * tools would have to declare has no member that could describe them. See
 * `tools/index.ts` and `docs/TOOL_SYSTEM.md`.
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
  createDefaultToolRegistry,
  createToolRegistry,
  DEFAULT_TOOL_PERMISSION,
  defineTool,
  MAX_ANALYSIS_CHARACTERS,
  TEXT_ANALYSIS_TOOL_ID,
  TEXT_ANALYSIS_TOOL_VERSION,
  textAnalysisTool,
  ToolExecutor,
  ToolPermission,
  ToolRegistry,
} from "./tools";
export type {
  ExecuteToolRequest,
  TextAnalysisInput,
  TextAnalysisOutput,
  ToolDefinition,
  ToolExecutionContext,
  ToolReceipt,
} from "./tools";

export { AgentEngineError, toAgentExecutionError } from "./errors";

export {
  clearExecutions,
  getExecution,
  listExecutions,
  saveExecution,
} from "./runtime/store";
