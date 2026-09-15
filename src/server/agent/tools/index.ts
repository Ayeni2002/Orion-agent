/**
 * The tool system — Orion's controlled tool runtime.
 *
 * Layering, and the direction dependencies are allowed to flow:
 *
 *   catalog.ts     decides which tools exist            (knows every tool)
 *   registry.ts    answers "do we have this, may we?"   (knows no tool)
 *   executor.ts    validates, permits, runs, records    (knows no tool)
 *   definition.ts  what a tool is, and what it may ask for
 *   builtin/       the tools themselves
 *
 * The arrow points one way. A tool imports `definition.ts` and nothing else; the
 * executor imports the registry and the definitions; the catalogue imports the
 * tools. That is what makes the system extensible without editing the engine,
 * and it is why `catalog.ts` is the only file in the engine permitted to name a
 * tool id.
 *
 * There is no web search, browser, scraper, shell, filesystem, code execution or
 * external integration anywhere in this directory, and the capability union in
 * `src/types/agent.ts` has no member that could express one. See
 * `docs/TOOL_SYSTEM.md`.
 */

export { createDefaultToolRegistry } from "./catalog";

export {
  createToolRegistry,
  ToolRegistry,
} from "./registry";

export { ToolExecutor, receiptError } from "./executor";
export type { ExecuteToolRequest } from "./executor";

export {
  DEFAULT_TOOL_PERMISSION,
  defineTool,
  toToolMetadata,
  ToolPermission,
} from "./definition";
export type {
  ToolDefinition,
  ToolExecutionContext,
  ToolReceipt,
} from "./definition";

export {
  MAX_ANALYSIS_CHARACTERS,
  TEXT_ANALYSIS_TOOL_ID,
  TEXT_ANALYSIS_TOOL_VERSION,
  textAnalysisInputSchema,
  textAnalysisTool,
} from "./builtin/text-analysis";
export type {
  TextAnalysisInput,
  TextAnalysisOutput,
} from "./builtin/text-analysis";
