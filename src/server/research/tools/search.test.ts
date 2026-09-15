import { describe, expect, it } from "vitest";

import { DEFAULT_TOOL_PERMISSION, ToolExecutor } from "@/server/agent";
import type {
  ToolDefinition,
  ToolExecutionContext,
} from "@/server/agent/tools/definition";

import { RESEARCH_TOOL_PERMISSION } from "../permission";
import {
  createStubResearchProvider,
  sourceFixture,
  type StubSearchResult,
} from "../provider/stub-provider";
import {
  MAX_SEARCH_RESULTS,
  MAX_SOURCE_CONTENT_CHARACTERS,
  MAX_SOURCE_TITLE_CHARACTERS,
  RESEARCH_QUERY_MAX_LENGTH,
  RESEARCH_QUERY_MIN_LENGTH,
  RESEARCH_SEARCH_TOOL_ID,
  createResearchSearchTool,
  researchSearchInputSchema,
  type ResearchSearchInput,
  type ResearchSearchOutput,
} from "./search";
import { createResearchToolRegistry } from "./index";

/**
 * The one tool in Orion that reaches the network.
 *
 * Two groups of tests here carry more weight than the rest.
 *
 * The first is the vetted-URL group. A source's URL is returned over HTTP and
 * rendered as a link, so a `javascript:` URL that survives this tool is script
 * execution in a reader's session. The tool counts what it refuses rather than
 * throwing, and both halves of that are asserted.
 *
 * The second is the §6 group. `research.search` declares `network`, the default
 * grant is `read_only`, and so the tool is refused by construction anywhere the
 * grant has not been widened on purpose. That refusal is the entire mechanism
 * behind "read-only network permissions, denied by default", and a test that
 * only exercised the widened path would not notice if it stopped working.
 */

const CONTEXT: ToolExecutionContext = {
  executionId: "exec-1",
  taskId: "task-1",
  stepId: "step-1",
  toolId: RESEARCH_SEARCH_TOOL_ID,
  objective: "What did grid-scale storage cost?",
  startedAt: "2026-01-01T00:00:00.000Z",
  grantedCapabilities: ["network"],
};

/**
 * The search tool, with the output it actually produces named on it.
 *
 * `ToolDefinition.execute` is declared `Promise<ToolOutput>` — a
 * `Record<string, unknown>` — because the registry holds every tool under one
 * type, and the single cast that buys an author a typed `execute` body lives in
 * `defineTool`. This is that cast's mirror on the reading side, and it is
 * declared once here rather than restated at each of the assertions below.
 *
 * It is an assertion rather than an invention: `ResearchSearchOutput` is a
 * `type` rather than an `interface` precisely so it carries the implicit index
 * signature that makes it assignable to the `ToolOutput` the tool promises. If
 * the tool stopped returning that shape the assertions would fail on the values,
 * which is what a test is for.
 */
type SearchTool = Omit<ToolDefinition, "execute"> & {
  execute(
    input: ResearchSearchInput,
    context: ToolExecutionContext,
  ): Promise<ResearchSearchOutput>;
};

/**
 * Builds the tool over a scripted provider.
 *
 * `sources` is typed loosely because the tests deliberately hand it things a
 * well-behaved provider would not send — a `javascript:` URL, a source with no
 * URL at all — and the tool's job is to survive them rather than to be protected
 * from them by the compiler.
 */
function toolReturning(
  sources: StubSearchResult,
  options: { maxResults?: number; isConfigured?: boolean } = {},
): SearchTool {
  return createResearchSearchTool({
    provider: createStubResearchProvider({
      script: { search: () => sources },
      ...(options.isConfigured === undefined
        ? {}
        : { isConfigured: options.isConfigured }),
    }),
    maxResults: options.maxResults ?? 5,
  }) as SearchTool;
}

describe("createResearchSearchTool", () => {
  describe("what it reports about a search", () => {
    it("returns the sources a provider gave it", async () => {
      const tool = toolReturning([sourceFixture("https://example.org/a")]);
      const output = await tool.execute({ query: "grid storage cost" }, CONTEXT);

      expect(output.sources).toHaveLength(1);
      expect(output.query).toBe("grid storage cost");
    });

    it("reports that retrieval happened", async () => {
      const tool = toolReturning([sourceFixture("https://example.org/a")]);
      const output = await tool.execute({ query: "grid storage cost" }, CONTEXT);

      // Carried through rather than inferred from an empty list, because
      // "searched and found nothing" and "did not search" lead to different
      // conclusions and only one of them is evidence about the world.
      expect(output.performedRetrieval).toBe(true);
    });

    it("reports no retrieval when the provider says none happened", async () => {
      const tool = toolReturning({
        sources: [],
        providerId: "stub",
        performedRetrieval: false,
      });

      const output = await tool.execute({ query: "grid storage cost" }, CONTEXT);

      expect(output.performedRetrieval).toBe(false);
      expect(output.sources).toStrictEqual([]);
    });

    it("names the provider that served the search", async () => {
      const tool = toolReturning([sourceFixture("https://example.org/a")]);
      const output = await tool.execute({ query: "grid storage cost" }, CONTEXT);

      expect(output.providerId).toBe("stub");
    });

    it("fails rather than returning an empty success when unconfigured", async () => {
      const tool = toolReturning([], { isConfigured: false });

      // An empty success would be indistinguishable, downstream, from a search
      // that looked and found nothing.
      await expect(
        tool.execute({ query: "grid storage cost" }, CONTEXT),
      ).rejects.toThrow(/not configured/);
    });
  });

  describe("URL vetting", () => {
    it("drops a javascript: URL and counts it", async () => {
      const tool = toolReturning([
        { ...sourceFixture("https://example.org/a"), url: "javascript:alert(1)" },
        sourceFixture("https://example.org/b"),
      ]);

      const output = await tool.execute({ query: "grid storage cost" }, CONTEXT);

      expect(output.sources.map((source) => source.url)).toStrictEqual([
        "https://example.org/b",
      ]);
      expect(output.rejectedSourceCount).toBe(1);
    });

    it("drops a URL pointing at an internal host and counts it", async () => {
      const tool = toolReturning([
        { ...sourceFixture("https://example.org/a"), url: "http://169.254.169.254/" },
      ]);

      const output = await tool.execute({ query: "grid storage cost" }, CONTEXT);

      expect(output.sources).toStrictEqual([]);
      expect(output.rejectedSourceCount).toBe(1);
    });

    it("drops a URL carrying credentials and counts it", async () => {
      const tool = toolReturning([
        { ...sourceFixture("https://example.org/a"), url: "https://u:p@example.org/x" },
      ]);

      const output = await tool.execute({ query: "grid storage cost" }, CONTEXT);

      expect(output.rejectedSourceCount).toBe(1);
    });

    it("keeps the good sources alongside a bad one", async () => {
      // One hostile link among twenty is an ordinary outcome, and it must not
      // be able to fail a run.
      const tool = toolReturning([
        { ...sourceFixture("https://example.org/a"), url: "javascript:alert(1)" },
        sourceFixture("https://example.org/b"),
        sourceFixture("https://example.org/c"),
      ]);

      const output = await tool.execute({ query: "grid storage cost" }, CONTEXT);

      expect(output.sources).toHaveLength(2);
      expect(output.rejectedSourceCount).toBe(1);
    });

    it("re-derives the domain from the vetted URL", async () => {
      // A provider reporting one host in `domain` and another in `url` is a
      // phishing shape, so the domain is never taken from the provider.
      const tool = toolReturning([
        sourceFixture("https://example.org/a", { domain: "trusted-bank.example" }),
      ]);

      const output = await tool.execute({ query: "grid storage cost" }, CONTEXT);

      expect(output.sources[0]?.domain).toBe("example.org");
    });

    it("stores the canonical URL, not the one the provider sent", async () => {
      const tool = toolReturning([
        sourceFixture("https://example.org/a?utm_source=news#top"),
      ]);

      const output = await tool.execute({ query: "grid storage cost" }, CONTEXT);

      expect(output.sources[0]?.url).toBe("https://example.org/a");
    });

    it("drops a source whose URL is missing entirely", async () => {
      const tool = toolReturning([
        { ...sourceFixture("https://example.org/a"), url: "" },
      ]);

      const output = await tool.execute({ query: "grid storage cost" }, CONTEXT);

      expect(output.sources).toStrictEqual([]);
      expect(output.rejectedSourceCount).toBe(1);
    });
  });

  describe("the per-task ceiling", () => {
    it("keeps only as many results as it was allowed and counts the rest", async () => {
      const tool = toolReturning(
        ["a", "b", "c", "d"].map((slug) => sourceFixture(`https://example.org/${slug}`)),
        { maxResults: 2 },
      );

      const output = await tool.execute({ query: "grid storage cost" }, CONTEXT);

      expect(output.sources).toHaveLength(2);
      expect(output.droppedSourceCount).toBe(2);
    });

    it("reports no drops when the provider honoured the request", async () => {
      const tool = toolReturning([sourceFixture("https://example.org/a")], {
        maxResults: 5,
      });

      const output = await tool.execute({ query: "grid storage cost" }, CONTEXT);

      // The distinction the run's `max_sources_per_task` limit depends on:
      // a provider that returned what was asked for did not hit a ceiling.
      expect(output.droppedSourceCount).toBe(0);
    });

    it("clamps a misconfigured ceiling to the structural maximum", async () => {
      const tool = toolReturning(
        Array.from({ length: 12 }, (_unused, index) =>
          sourceFixture(`https://example.org/${index}`),
        ),
        { maxResults: 10_000 },
      );

      const output = await tool.execute({ query: "grid storage cost" }, CONTEXT);

      // The cap is on the tool rather than on the caller, so a plan cannot ask
      // for 10,000 results even if a future limit configuration is wrong.
      expect(output.sources).toHaveLength(MAX_SEARCH_RESULTS);
      expect(output.droppedSourceCount).toBe(2);
    });

    it("counts rejected results separately from dropped ones", async () => {
      const tool = toolReturning(
        [
          { ...sourceFixture("https://example.org/a"), url: "javascript:alert(1)" },
          sourceFixture("https://example.org/b"),
          sourceFixture("https://example.org/c"),
        ],
        { maxResults: 1 },
      );

      const output = await tool.execute({ query: "grid storage cost" }, CONTEXT);

      // Both numbers mean different things: one is a hostile link, the other is
      // a usable result excluded by a ceiling.
      expect(output.rejectedSourceCount).toBe(1);
      expect(output.droppedSourceCount).toBe(1);
      expect(output.sources).toHaveLength(1);
    });
  });

  describe("bounds on what is carried back", () => {
    it("truncates an oversized passage and marks it", async () => {
      const tool = toolReturning([
        sourceFixture("https://example.org/a", {
          content: "x".repeat(MAX_SOURCE_CONTENT_CHARACTERS + 500),
        }),
      ]);

      const output = await tool.execute({ query: "grid storage cost" }, CONTEXT);
      const content = output.sources[0]?.content ?? "";

      expect(content.length).toBeLessThan(MAX_SOURCE_CONTENT_CHARACTERS + 20);
      // Marked rather than silent, so a finding cannot quote text that was
      // never fully retrieved.
      expect(content.endsWith("…[truncated]")).toBe(true);
    });

    it("truncates an oversized title and marks it", async () => {
      const tool = toolReturning([
        sourceFixture("https://example.org/a", {
          title: "t".repeat(MAX_SOURCE_TITLE_CHARACTERS + 100),
        }),
      ]);

      const output = await tool.execute({ query: "grid storage cost" }, CONTEXT);

      expect(output.sources[0]?.title?.endsWith("…[truncated]")).toBe(true);
    });

    it("leaves a passage inside the cap untouched", async () => {
      const content = "Grid-scale battery pack costs fell by about 40%.";
      const tool = toolReturning([sourceFixture("https://example.org/a", { content })]);

      const output = await tool.execute({ query: "grid storage cost" }, CONTEXT);

      expect(output.sources[0]?.content).toBe(content);
    });

    it("omits content entirely when the provider sent none", async () => {
      const tool = toolReturning([sourceFixture("https://example.org/a")]);
      const output = await tool.execute({ query: "grid storage cost" }, CONTEXT);

      // Absent is a real state: a source with no body text cannot support a
      // quote, which is what `ResearchFinding.basis` exists to express.
      expect(output.sources[0]?.content).toBeUndefined();
    });
  });

  describe("input validation", () => {
    it("refuses a query shorter than the minimum", () => {
      expect(
        researchSearchInputSchema.safeParse({
          query: "a".repeat(RESEARCH_QUERY_MIN_LENGTH - 1),
        }).success,
      ).toBe(false);
    });

    it("refuses a query longer than the maximum", () => {
      expect(
        researchSearchInputSchema.safeParse({
          query: "a".repeat(RESEARCH_QUERY_MAX_LENGTH + 1),
        }).success,
      ).toBe(false);
    });

    it("refuses a maxResults above the structural maximum", () => {
      expect(
        researchSearchInputSchema.safeParse({
          query: "grid storage cost",
          maxResults: MAX_SEARCH_RESULTS + 1,
        }).success,
      ).toBe(false);
    });

    it("refuses a non-integer maxResults", () => {
      expect(
        researchSearchInputSchema.safeParse({
          query: "grid storage cost",
          maxResults: 2.5,
        }).success,
      ).toBe(false);
    });

    it("accepts a query with no maxResults", () => {
      expect(
        researchSearchInputSchema.safeParse({ query: "grid storage cost" }).success,
      ).toBe(true);
    });
  });
});

describe("the tool's capability declaration", () => {
  it("declares network and nothing else", () => {
    const tool = toolReturning([]);

    // Per `docs/TOOL_SYSTEM.md` §5, `read_only` describes a tool that reads the
    // input it was handed and needs nothing further. Declaring both would claim
    // two requirements where there is one.
    expect([...tool.capabilities]).toStrictEqual(["network"]);
  });
});

describe("the tool under the default grant", () => {
  it("is refused with tool_permission_denied", async () => {
    const provider = createStubResearchProvider({
      script: { search: () => [sourceFixture("https://example.org/a")] },
    });

    const registry = createResearchToolRegistry({ provider, maxResults: 5 });

    // The default grant, which is what every agent run gets. §6 in one test:
    // this tool cannot be reached by accident, and a run that wants it has to
    // construct a differently-permissioned executor, which is a visible act.
    const executor = new ToolExecutor(registry, DEFAULT_TOOL_PERMISSION);
    const receipt = await executor.execute({
      toolId: RESEARCH_SEARCH_TOOL_ID,
      input: { query: "grid storage cost" },
      executionId: "exec-1",
      taskId: "task-1",
      stepId: "step-1",
      objective: "What did grid-scale storage cost?",
    });

    expect(receipt.status).toBe("failed");
    expect(receipt.error?.code).toBe("tool_permission_denied");
    expect(receipt.error?.details?.missing).toStrictEqual(["network"]);
  });

  it("is refused without the provider being called at all", async () => {
    const calls = { search: 0 };
    const provider = createStubResearchProvider({
      script: { search: () => [sourceFixture("https://example.org/a")] },
      calls,
    });

    const registry = createResearchToolRegistry({ provider, maxResults: 5 });
    const executor = new ToolExecutor(registry, DEFAULT_TOOL_PERMISSION);

    await executor.execute({
      toolId: RESEARCH_SEARCH_TOOL_ID,
      input: { query: "grid storage cost" },
      executionId: "exec-1",
      taskId: "task-1",
      stepId: "step-1",
      objective: "What did grid-scale storage cost?",
    });

    // Permissions are checked before validation, so a tool the run may not use
    // is refused without its schema consuming untrusted input — and certainly
    // without a request leaving the process.
    expect(calls.search).toBe(0);
  });

  it("succeeds under the widened grant the research service constructs", async () => {
    const provider = createStubResearchProvider({
      script: { search: () => [sourceFixture("https://example.org/a")] },
    });

    const registry = createResearchToolRegistry({ provider, maxResults: 5 });
    const executor = new ToolExecutor(registry, RESEARCH_TOOL_PERMISSION);

    const receipt = await executor.execute({
      toolId: RESEARCH_SEARCH_TOOL_ID,
      input: { query: "grid storage cost" },
      executionId: "exec-1",
      taskId: "task-1",
      stepId: "step-1",
      objective: "What did grid-scale storage cost?",
    });

    expect(receipt.status).toBe("succeeded");
    expect(receipt.output?.performedRetrieval).toBe(true);
  });

  it("is registered under an id distinct from the agent engine's web.search", () => {
    const registry = createResearchToolRegistry({
      provider: createStubResearchProvider({ script: {} }),
      maxResults: 5,
    });

    // `web.search` is a documented Phase 3 behaviour: the deterministic planner
    // names it and the engine answers `capability_unavailable`. Registering
    // anything under that id would change what an agent run does, so the
    // research tool has an id of its own.
    expect(registry.ids()).toContain(RESEARCH_SEARCH_TOOL_ID);
    expect(registry.ids()).not.toContain("web.search");
  });
});
