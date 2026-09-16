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

export {
  ModelProviderError,
  parseModelJson,
  resolveModelProvider,
} from "./provider";
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
  receiptError,
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

/**
 * Primitives the research subsystem reuses rather than reimplementing.
 *
 * Phase 5 asked for a second kind of run — research — and the temptation with a
 * second run is a second copy of the things every run needs: an id scheme, a
 * clock, an event log, a state builder, a JSON parser for model output. §26 of
 * the Phase 5 brief rules that out, and these exports are how it is ruled out
 * concretely: `src/server/research/` imports these four and defines none of its
 * own.
 *
 * They are exported from the barrel rather than reached for by deep path
 * because the rule this file states applies to research as much as to any other
 * caller — the engine's internal layout stays free to change only if nothing
 * outside it has baked that layout in.
 *
 * `EventLog` and `ExecutionStateBuilder` are the two that matter most. A
 * research run emits the same `AgentEvent`s an agent run does and tracks state
 * through the same builder, so the workspace follows either with the same
 * component and there is exactly one answer to "how does a run report
 * progress?".
 */
export { createId, now } from "./ids";
export { EventLog } from "./runtime/events";
export type { EventSink } from "./runtime/events";
export { ExecutionStateBuilder } from "./runtime/state";
