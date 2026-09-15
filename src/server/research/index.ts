/**
 * The research subsystem.
 *
 * Public surface of everything under `src/server/research`. Callers outside it —
 * services, routes, tests — import from here rather than reaching into
 * subdirectories, so the internal layout stays free to change. The same rule
 * `agent/index.ts` states for the engine, applied to the thing built on top of
 * it.
 *
 * **The shape of this subsystem, in one paragraph.** A question goes in. The
 * planner — the Phase 3 `ModelProvider`, asked a research-shaped question —
 * turns it into validated retrieval tasks. Each task calls one tool through the
 * Phase 4 `ToolExecutor`, which checks the run's permission, validates the
 * input, calls the `ResearchProvider` behind the tool, and returns a receipt.
 * The retrieved sources are normalised and deduplicated, and the same model
 * provider is asked what they establish, quoting them. A deterministic evaluator
 * then judges whether that is enough, and everything — sources, findings, the
 * evidence linking them, conflicts, limits reached, the whole event log — comes
 * back as one record.
 *
 * **What is not here.** No runner, no registry, no executor, no event system, no
 * state builder, no id scheme, no JSON parser for model output. All seven are
 * Phase 3's or Phase 4's and are imported from `@/server/agent`. §26 of the
 * Phase 5 brief rules out re-implementing them, and the import list below is how
 * that is enforced rather than promised.
 *
 * **What is exported and what is not.** The service, the store, the capability
 * read, and the two seams a test needs to substitute — the research provider and
 * its scripted stub. The planner, the finding extractor, the normaliser and the
 * evaluator are exercised through `runResearch` rather than called directly by
 * callers, so their signatures stay free to change; tests that need one of them
 * in isolation import the module directly, which is a statement that the test is
 * about that module.
 */

export {
  getResearchCapabilities,
  runResearch,
  type RunResearchParams,
} from "./service";

export {
  clearResearch,
  getResearch,
  listResearch,
  MAX_RETAINED_RESEARCH,
  saveResearch,
} from "./store";

/**
 * The retrieval seam.
 *
 * Exported because a caller may legitimately need to know what retrieval
 * resolved to before starting a run, and because a test substitutes it. The
 * *implementations* are not all exported: `resolveResearchProvider` is the only
 * place one is chosen, the development adapter is exported because a caller may
 * need to name it, the web-search adapter is exported so a test can construct
 * one directly, and the scripted stub is exported for tests.
 */
export { resolveResearchProvider } from "./provider";
export type {
  ResearchProvider,
  ResearchProviderDescriptor,
  ResearchProviderRequest,
  ResearchProviderResponse,
} from "./provider";
export { ResearchProviderError } from "./provider";
export { DEV_RESEARCH_PROVIDER_ID, createDevResearchProvider } from "./provider";
export { OPENROUTER_SEARCH_PROVIDER_ID } from "./provider";

export {
  createStubResearchProvider,
  noRetrievalResponse,
  STUB_RESEARCH_PROVIDER_ID,
  sourceFixture,
  type StubResearchProviderOptions,
  type StubResearchScript,
  type StubSearchResult,
} from "./provider/stub-provider";

/**
 * The tool a research run calls, and the registry that holds it.
 *
 * Exported so a test can assert that the id the service calls is the id the
 * registry registers — the one failure mode that would make every run fail with
 * "tool not registered" while every unit test passed.
 */
export {
  createResearchToolRegistry,
  RESEARCH_SEARCH_TOOL_ID,
  RESEARCH_SEARCH_TOOL_VERSION,
} from "./tools";

/**
 * The limits a run operates under, read from the environment.
 *
 * Exported for the same reason `getEngineCapabilities` reads the real catalogue:
 * a caller reporting what a run will do should be reading the values the run
 * will actually use.
 */
export { getResearchConfig, type ResearchConfig } from "@/lib/env";

/**
 * URL vetting, exported for the security test that exercises it directly.
 *
 * §24's rules are worth their own test rather than only being covered through a
 * search tool that happens to call them — a regression in the private-address
 * check would otherwise be invisible until a URL reached a renderer.
 */
export { parseSourceUrl, type SourceUrlRejection, type SourceUrlResult } from "./url-safety";
