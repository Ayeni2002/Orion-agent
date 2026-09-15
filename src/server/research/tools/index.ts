import {
  createDefaultToolRegistry,
  type ToolRegistry,
} from "@/server/agent/tools";

import type { ResearchProvider } from "../provider/provider";
import { createResearchSearchTool } from "./search";

/**
 * The registry a research run uses.
 *
 * It is the Phase 4 catalogue plus one tool, composed through the Phase 4
 * registry's own `register`. That is §5's requirement met literally: research
 * enters the tool system through the existing registry, with the existing
 * registration rules — a duplicate id throws, a tool declaring no capabilities
 * throws, and nothing here bypasses either.
 *
 * **Why `createDefaultToolRegistry()` is not the thing that changes.** The
 * obvious alternative is to register the search tool inside the catalogue, so
 * `/api/tools` lists it and every run sees it. Three reasons that is wrong:
 *
 *   1. **The catalogue has no provider to give it.** A tool receives its
 *      dependencies at construction — `docs/TOOL_SYSTEM.md` §6 makes that
 *      structural — so registering the search tool in the default catalogue
 *      would mean the catalogue resolving a research provider from the
 *      environment. `getEngineCapabilities()` builds a default registry to
 *      describe the engine, and it would start performing retrieval
 *      configuration as a side effect of describing itself.
 *   2. **It would change Phase 3 and 4 behaviour.** `web.search` is the id the
 *      deterministic planner names, and `capability_unavailable` for it is live,
 *      tested behaviour that `docs/TOOL_SYSTEM.md` §9 documents deliberately.
 *      Registering a tool into that catalogue is how that path would quietly
 *      become a different one.
 *   3. **The grant is per-run, so the registry should be too.** A research run
 *      holds a widened permission and every other run does not. Keeping the
 *      research tool out of the shared catalogue keeps that difference visible:
 *      the only way to get a registry that can search is to build a research
 *      run, and the only way to do that is to name the research service.
 *
 * What this costs is that `/api/tools` does not list `research.search`. That is
 * a real consequence and it is answered rather than ignored: the research
 * capabilities endpoint reports the research tool and the grant it needs, so the
 * workspace can still be honest about what research can do before a run starts.
 */

export { createResearchSearchTool } from "./search";
export {
  DEFAULT_SEARCH_RESULTS,
  MAX_SEARCH_RESULTS,
  MAX_SOURCE_CONTENT_CHARACTERS,
  MAX_SOURCE_TITLE_CHARACTERS,
  RESEARCH_QUERY_MAX_LENGTH,
  RESEARCH_QUERY_MIN_LENGTH,
  RESEARCH_SEARCH_TOOL_ID,
  RESEARCH_SEARCH_TOOL_VERSION,
  researchSearchInputSchema,
} from "./search";
export type {
  ResearchSearchInput,
  ResearchSearchOutput,
  ResearchSearchToolOptions,
} from "./search";

export interface ResearchToolRegistryOptions {
  provider: ResearchProvider;
  /** The run's `maxSourcesPerTask`. The search tool's ceiling for one call. */
  maxResults: number;
}

/**
 * Builds the registry for one research run.
 *
 * A fresh registry per run, for the reason the Phase 4 catalogue records: a
 * shared mutable registry would let one run's registrations reach another's.
 */
export function createResearchToolRegistry({
  provider,
  maxResults,
}: ResearchToolRegistryOptions): ToolRegistry {
  const registry = createDefaultToolRegistry();

  registry.register(createResearchSearchTool({ provider, maxResults }));

  return registry;
}
