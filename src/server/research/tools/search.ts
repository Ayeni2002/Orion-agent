import { z } from "zod";

import { createId, now } from "@/server/agent/ids";
import { defineTool, type ToolDefinition } from "@/server/agent/tools/definition";
import type { ResearchSource } from "@/types/research";

import type { ResearchProvider } from "../provider/provider";
import { parseSourceUrl } from "../url-safety";

/**
 * Research search — the one tool in Orion that reaches the network.
 *
 * It is a thin adapter, and deliberately so. Everything hard about retrieval
 * lives behind `ResearchProvider`; this module's job is to put that behind the
 * Phase 4 tool pipeline, so that a research step is permitted, validated,
 * timed, recorded and refused by exactly the same machinery as any other tool.
 * There is no second execution path, no second permission check and no second
 * receipt — which is what §5 of the Phase 5 brief asks for and what §26 means by
 * a strict phase boundary.
 *
 * **It declares `network` and only `network`.** Per `docs/TOOL_SYSTEM.md` §5,
 * `read_only` describes a tool that reads the input it was handed and nothing
 * else — a tool needing nothing further. Declaring both would be claiming two
 * requirements where there is one. The consequence is the intended friction and
 * the whole of §6: `DEFAULT_TOOL_PERMISSION` grants `read_only`, so this tool is
 * refused by construction in any run that has not widened its grant on purpose.
 * It cannot be reached by accident, and a caller that widens the grant has to
 * write the widened grant down.
 *
 * **Where the grant is actually widened is one call site** — the research
 * service. `DEFAULT_TOOL_PERMISSION` is unchanged, no global permission exists,
 * and there is no configuration flag that could widen it at a distance. A
 * research run has network access for the duration of that run and no other run
 * has it at all.
 *
 * **The URLs are vetted here, and this is the only place they are.** A retrieval
 * service returns links from the open web, so they are untrusted input, and
 * every one is passed through `parseSourceUrl` before it can reach a receipt.
 * That matters because a receipt is stored on the step, returned from
 * `/api/research` and rendered in the workspace: a `javascript:` URL surviving
 * this point is script execution in a reader's session. A rejected URL is
 * dropped and counted rather than thrown, because one bad link among twenty is
 * an ordinary outcome when reading the web, and a throw here would let a single
 * hostile link fail an entire run.
 */

export const RESEARCH_SEARCH_TOOL_ID = "research.search";
export const RESEARCH_SEARCH_TOOL_VERSION = "1.0.0";

/**
 * Query bounds.
 *
 * A query originates from model output, so it is bounded before it reaches a
 * provider. The minimum is not decoration: a one- or two-character query is
 * either a mistake or an attempt to make a metered service answer something
 * meaningless, and both are cheaper to refuse here.
 */
export const RESEARCH_QUERY_MIN_LENGTH = 3;
export const RESEARCH_QUERY_MAX_LENGTH = 400;

/**
 * The most results one call may ask for.
 *
 * A structural ceiling on the tool itself, distinct from the run's
 * `maxSourcesPerTask` limit. Both apply and the smaller wins. This one is the
 * belt: it means a plan cannot ask for 10,000 results even if a future limit
 * configuration is wrong, because the schema would refuse the input before the
 * provider was called at all.
 */
export const MAX_SEARCH_RESULTS = 10;
export const DEFAULT_SEARCH_RESULTS = 5;

/**
 * Bounds on the text carried back.
 *
 * Retrieved passages are unbounded and arrive from outside Orion, and whatever
 * comes back is copied into the tool receipt, into an observation, and out over
 * HTTP. These caps are what stop one page's worth of text becoming an execution
 * record measured in megabytes. The truncation is marked rather than silent, so
 * a reader can tell a passage was cut and a finding cannot quote text that was
 * never fully retrieved.
 */
export const MAX_SOURCE_CONTENT_CHARACTERS = 4_000;
export const MAX_SOURCE_TITLE_CHARACTERS = 300;

/** Appended to text that was cut, so a truncated passage is never read as complete. */
const TRUNCATION_MARKER = "…[truncated]";

export const researchSearchInputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(
      RESEARCH_QUERY_MIN_LENGTH,
      `A search query must be at least ${RESEARCH_QUERY_MIN_LENGTH} characters.`,
    )
    .max(
      RESEARCH_QUERY_MAX_LENGTH,
      `A search query must be at most ${RESEARCH_QUERY_MAX_LENGTH} characters.`,
    ),
  /**
   * How many results to ask for.
   *
   * Optional, because the planner should not have to know the run's limits, and
   * capped regardless of what it asks for. `maxResults` is advisory to the
   * provider and enforced here and by the service — a provider that ignores it
   * cannot cause unbounded state.
   */
  maxResults: z.number().int().positive().max(MAX_SEARCH_RESULTS).optional(),
});

export type ResearchSearchInput = z.infer<typeof researchSearchInputSchema>;

/**
 * A `type`, not an `interface`, and it is load-bearing: TypeScript gives an
 * object type alias an implicit index signature but withholds one from an
 * interface, so only this form is assignable to the `ToolOutput` a tool must
 * return. Same reason as `TextAnalysisOutput`.
 */
export type ResearchSearchOutput = {
  /** The query as executed, after trimming. Echoed so a receipt explains itself. */
  query: string;
  providerId: string;
  /**
   * Whether a retrieval service was actually reached.
   *
   * Carried through to the result rather than inferred from an empty source
   * list, because "searched and found nothing" and "did not search" lead to
   * different conclusions and only one of them is evidence about the world.
   */
  performedRetrieval: boolean;
  sources: ResearchSource[];
  /**
   * How many results were dropped by URL vetting.
   *
   * Reported rather than hidden. A run whose results were mostly rejected has
   * a different problem from one that found nothing, and a count is what makes
   * that visible without logging a URL that was refused for being dangerous.
   */
  rejectedSourceCount: number;
  /**
   * How many usable results were discarded for exceeding the requested count.
   *
   * The observable form of the per-task ceiling. `maxResults` is sent as a
   * request parameter, so a provider that honours it never produces this — but a
   * provider that returns more, or ignores the parameter, would otherwise have
   * its surplus vanish without trace. A non-zero value here is what lets the
   * run record that `maxSourcesPerTask` actually truncated something, rather
   * than claiming the limit was reached every time a search returned its
   * requested number.
   */
  droppedSourceCount: number;
};

function truncate(value: string, limit: number): string {
  return value.length <= limit
    ? value
    : `${value.slice(0, limit).trimEnd()}${TRUNCATION_MARKER}`;
}

/**
 * Reads an optional string from untrusted provider output.
 *
 * The provider interface types these as strings, and the adapters Orion ships
 * honour that. This is defensive anyway because a provider is the one component
 * whose implementation may be replaced by something Orion does not control, and
 * a non-string reaching `truncate` would throw a `TypeError` inside a tool — a
 * confusing failure for what is really a malformed response.
 */
function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export interface ResearchSearchToolOptions {
  provider: ResearchProvider;
  /**
   * The most results this run will accept from one call.
   *
   * Comes from the run's limits rather than from the tool, so the ceiling is
   * configured in one place. The input may ask for fewer; it may never ask for
   * more.
   */
  maxResults: number;
}

/**
 * Builds the search tool for one run.
 *
 * A factory rather than a module constant, because the provider is an explicit
 * dependency: per `docs/TOOL_SYSTEM.md` §6 a tool receives no ambient anything,
 * and a module-level provider would be exactly the ambient dependency that rule
 * exists to prevent — it would also make the tool impossible to test without
 * reaching the real configuration.
 */
export function createResearchSearchTool({
  provider,
  maxResults,
}: ResearchSearchToolOptions): ToolDefinition {
  // Resolved once, at construction, so a nonsensical limit fails where it was
  // configured rather than at the first search.
  const ceiling = Math.max(1, Math.min(maxResults, MAX_SEARCH_RESULTS));

  return defineTool({
    id: RESEARCH_SEARCH_TOOL_ID,
    name: "Research search",
    description:
      "Retrieves sources from the web for a query and returns them with their " +
      "URLs and retrieved passages. Reaches an external service and requires " +
      "the network capability.",
    version: RESEARCH_SEARCH_TOOL_VERSION,
    capabilities: ["network"],
    inputSchema: researchSearchInputSchema,
    execute: async (
      input: ResearchSearchInput,
      context,
    ): Promise<ResearchSearchOutput> => {
      if (!provider.isConfigured) {
        // Deliberately a failure rather than an empty success. A search tool
        // that returned nothing when it had no way to search would be
        // indistinguishable, downstream, from one that searched and found
        // nothing — and the result built from it would report a run that looked
        // at the web when it never could. The service checks this before
        // starting a run, so this is the second line of defence, not the first.
        throw new Error(
          `The research provider "${provider.descriptor.id}" is not configured, so no search was performed.`,
        );
      }

      const requested = Math.min(input.maxResults ?? ceiling, ceiling);

      const response = await provider.search({
        query: input.query,
        maxResults: requested,
        taskId: context.taskId,
      });

      const sources: ResearchSource[] = [];
      let rejectedSourceCount = 0;
      let droppedSourceCount = 0;

      for (const candidate of response.sources) {
        // The only trusted-looking field is the URL, and it is not trusted
        // either — this is the check that decides whether the candidate becomes
        // a source at all.
        const vetted = parseSourceUrl(readOptionalString(candidate.url) ?? "");

        if (!vetted.ok) {
          rejectedSourceCount += 1;
          continue;
        }

        // Counted after vetting, so this reports usable results the ceiling
        // excluded — not results that were never usable anyway. The loop keeps
        // walking rather than breaking, because a rejection count that stopped
        // at the ceiling would understate what was refused.
        if (sources.length >= requested) {
          droppedSourceCount += 1;
          continue;
        }

        const title = readOptionalString(candidate.title);
        const content = readOptionalString(candidate.content);

        sources.push({
          id: readOptionalString(candidate.id) ?? createId("source"),
          url: vetted.url,
          // Re-derived from the vetted URL rather than copied, so a provider
          // cannot report one host in `domain` and another in `url`. A source
          // whose displayed host disagrees with its link is a phishing shape.
          domain: vetted.domain,
          ...(title === undefined
            ? {}
            : { title: truncate(title, MAX_SOURCE_TITLE_CHARACTERS) }),
          ...(content === undefined
            ? {}
            : { content: truncate(content, MAX_SOURCE_CONTENT_CHARACTERS) }),
          providerId:
            readOptionalString(candidate.providerId) ?? provider.descriptor.id,
          ...(typeof candidate.rank === "number" && Number.isFinite(candidate.rank)
            ? { rank: candidate.rank }
            : {}),
          retrievedAt: readOptionalString(candidate.retrievedAt) ?? now(),
        });
      }

      return {
        query: input.query,
        providerId: response.providerId,
        performedRetrieval: response.performedRetrieval,
        sources,
        rejectedSourceCount,
        droppedSourceCount,
      };
    },
  });
}
