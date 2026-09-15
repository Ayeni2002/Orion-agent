import { describe, expect, it, vi } from "vitest";

import {
  createStubModelProvider,
  scriptedResearchPlan,
  type StubResponse,
} from "@/server/agent/provider/stub-provider";
import { DEFAULT_TOOL_PERMISSION } from "@/server/agent";
import type { ResearchLimits, ResearchRecord } from "@/types/research";

import { createStubResearchProvider, sourceFixture } from "./provider/stub-provider";
import { RESEARCH_SEARCH_TOOL_ID } from "./tools";
import { runResearch } from "./service";

/**
 * The research loop, end to end, with both providers scripted.
 *
 * Every test here drives the real planner, the real tool registry, the real
 * `ToolExecutor`, the real normaliser, the real finding extractor and the real
 * evaluator. Only two things are substituted — who searches and who reasons —
 * and they are substituted through the seams those components were built to have,
 * not by mocking the components themselves. A test that mocked the planner would
 * be testing the mock.
 *
 * No test in this file contacts anything. The retrieval provider is scripted, so
 * the sources that come back are the sources the test asked for; the model
 * provider is scripted, so the findings are the findings the test asked for. The
 * subject under test is what the subsystem *does* with both.
 */

const COST_CONTENT =
  "Grid-scale battery pack costs fell by about 40% between 2019 and 2024.";
const DEPLOYMENT_CONTENT =
  "Installed grid-scale storage capacity reached 90 GW worldwide in 2025.";

/**
 * Distinct questions that satisfy the plan schema.
 *
 * Every one clears `RESEARCH_QUESTION_MIN_LENGTH` and every one is different
 * from the others, because the planner refuses a plan whose tasks repeat a
 * query — and a test that tripped that rule would be testing the refusal rather
 * than the thing it names. `scriptedResearchPlan` derives each task's query from
 * its question, so these are the queries too.
 */
const QUESTIONS = [
  "What did grid-scale battery storage cost in 2024?",
  "How did grid-scale battery storage costs change since 2019?",
  "How much grid-scale storage capacity was installed worldwide?",
  "Which regions led grid-scale storage deployment?",
] as const;

/** The first `count` of `QUESTIONS`, for tests that need a specific plan size. */
function questions(count: number): string[] {
  return QUESTIONS.slice(0, count);
}

/** Limits small enough that a test can reach them deliberately. */
function limits(overrides: Partial<ResearchLimits> = {}): ResearchLimits {
  return {
    maxTasks: 5,
    maxSourcesPerTask: 5,
    maxSourcesTotal: 20,
    maxFindings: 50,
    maxDurationMs: 60_000,
    ...overrides,
  };
}

/** A model provider scripted for planning and for extraction. */
function modelWith({
  questions = ["What did grid-scale storage cost?"],
  findings,
}: {
  questions?: string[];
  findings?: (context: Record<string, unknown>) => StubResponse;
}) {
  return createStubModelProvider({
    script: {
      research_plan: () => scriptedResearchPlan(questions),
      research_findings:
        findings ?? (() => ({ findings: [], gaps: ["nothing established here"] })),
    },
  });
}

/** A finding that quotes the opening of the source at the given index. */
function quoteFinding(index: number, quote: string, statement: string) {
  return { statement, sourceIndex: index, quote };
}

describe("runResearch", () => {
  describe("when retrieval is not configured", () => {
    it("fails before planning, and says which configuration is missing", async () => {
      let planned = 0;

      const record = await runResearch({
        question: "What did grid-scale storage cost?",
        limits: limits(),
        researchProvider: createStubResearchProvider({
          script: {},
          isConfigured: false,
        }),
        provider: createStubModelProvider({
          script: {
            research_plan: () => {
              planned += 1;
              return scriptedResearchPlan(["unused"]);
            },
          },
        }),
      });

      expect(record.status).toBe("failed");
      expect(record.result?.sufficiency).toBe("failed");
      expect(record.result?.errors[0]?.code).toBe("search_not_configured");
      expect(record.sources).toStrictEqual([]);
      expect(record.findings).toStrictEqual([]);

      // The point of stopping here rather than after a search: nothing was
      // planned and nothing was searched, so nothing could be mistaken for a
      // run that looked at the web.
      expect(planned).toBe(0);
      expect(record.plan).toBeUndefined();

      // The run-level observation exists and is attributed to nobody, because
      // there is no step it belongs to.
      expect(record.observations).toHaveLength(1);
      expect(record.observations[0]?.stepId).toBeUndefined();
      expect(record.observations[0]?.source).toBe("engine");
    });

    it("reports the run as failed in its event log without claiming any step ran", async () => {
      const record = await runResearch({
        question: "What did grid-scale storage cost?",
        limits: limits(),
        researchProvider: createStubResearchProvider({
          script: {},
          isConfigured: false,
        }),
        provider: modelWith({}),
      });

      expect(record.events.map((event) => event.type)).toStrictEqual([
        "execution.created",
        "execution.failed",
      ]);
    });
  });

  describe("a run that finds an answer", () => {
    it("returns sufficient, with each finding traced to the URL it came from", async () => {
      const sources = [
        sourceFixture("https://example.org/costs", { content: COST_CONTENT }),
      ];

      const record = await runResearch({
        question: "What did grid-scale storage cost?",
        limits: limits(),
        researchProvider: createStubResearchProvider({
          script: { search: () => sources },
        }),
        provider: modelWith({
          findings: () => ({
            findings: [
              quoteFinding(
                0,
                "battery pack costs fell by about 40%",
                "Grid-scale battery costs fell by roughly 40% over five years.",
              ),
            ],
          }),
        }),
      });

      expect(record.status).toBe("completed");
      expect(record.result?.sufficiency).toBe("sufficient");
      expect(record.result?.limitsReached).toStrictEqual([]);

      expect(record.findings).toHaveLength(1);
      const finding = record.findings[0];
      expect(finding?.basis).toBe("source");

      // §13's chain, walked in the test: finding → evidence → source → URL.
      expect(record.evidence).toHaveLength(1);
      const evidence = record.evidence[0];
      expect(evidence?.findingId).toBe(finding?.id);
      expect(finding?.sourceIds).toStrictEqual([evidence?.sourceId]);

      const source = record.sources.find((item) => item.id === evidence?.sourceId);
      expect(source?.url).toBe(evidence?.url);
      expect(evidence?.url).toBe("https://example.org/costs");

      // The quote is the retrieved text as it arrived, not the model's words.
      expect(evidence?.quote).toBe("battery pack costs fell by about 40%");
    });

    it("records the model provider alongside the retrieval provider", async () => {
      const record = await runResearch({
        question: "What did grid-scale storage cost?",
        limits: limits(),
        researchProvider: createStubResearchProvider({
          script: {
            search: () => [
              sourceFixture("https://example.org/a", { content: COST_CONTENT }),
            ],
          },
        }),
        provider: modelWith({}),
      });

      expect(record.provider.id).toBe("stub");
      expect(record.modelProvider?.id).toBe("stub");

      // Both are declared non-external, so a result can never imply that a real
      // service was reached when the test's own stand-ins served it.
      expect(record.provider.isExternal).toBe(false);
      expect(record.modelProvider?.isExternal).toBe(false);
    });

    it("emits the Phase 3 event types a workspace already knows how to render", async () => {
      const record = await runResearch({
        question: "What did grid-scale storage cost?",
        limits: limits(),
        researchProvider: createStubResearchProvider({
          script: {
            search: () => [
              sourceFixture("https://example.org/a", { content: COST_CONTENT }),
            ],
          },
        }),
        provider: modelWith({}),
      });

      expect(record.events.map((event) => event.type)).toStrictEqual([
        "execution.created",
        "execution.planning",
        "execution.planned",
        "execution.started",
        "step.started",
        "tool.started",
        "tool.completed",
        "step.completed",
        "execution.evaluating",
        "execution.completed",
      ]);
    });
  });

  describe("claims that cannot be traced to retrieved text", () => {
    it("keeps the claim but records it as a model inference, with no evidence", async () => {
      const record = await runResearch({
        question: "What did grid-scale storage cost?",
        limits: limits(),
        researchProvider: createStubResearchProvider({
          script: {
            search: () => [
              sourceFixture("https://example.org/a", { content: COST_CONTENT }),
            ],
          },
        }),
        provider: modelWith({
          findings: () => ({
            findings: [
              // The quote is a fluent paraphrase and appears nowhere in the
              // source. This is the shape §12 exists to catch.
              quoteFinding(
                0,
                "prices halved in three years",
                "Grid-scale battery costs halved in three years.",
              ),
            ],
          }),
        }),
      });

      expect(record.findings).toHaveLength(1);

      // Kept rather than deleted: a model's inference can be worth reading.
      const finding = record.findings[0];
      expect(finding?.basis).toBe("model");
      expect(finding?.sourceIds).toStrictEqual([]);

      // Stripped of the attribution it did not earn.
      expect(record.evidence).toStrictEqual([]);

      // And the run says so rather than passing it off as sourced.
      expect(record.result?.sufficiency).toBe("insufficient");
      expect(record.result?.summary).toContain("no finding could be traced");
    });

    it("counts the unverified claims in the step observation", async () => {
      const record = await runResearch({
        question: "What did grid-scale storage cost?",
        limits: limits(),
        researchProvider: createStubResearchProvider({
          script: {
            search: () => [
              sourceFixture("https://example.org/a", { content: COST_CONTENT }),
            ],
          },
        }),
        provider: modelWith({
          findings: () => ({
            findings: [
              quoteFinding(0, "not present anywhere", "An unsupported claim."),
              quoteFinding(0, "battery pack costs", "A supported claim."),
            ],
          }),
        }),
      });

      const completed = record.observations.find(
        (item) => item.status === "completed",
      );

      expect(completed?.output?.unverified).toBe(1);
      expect(completed?.output?.sourceBacked).toBe(1);
      expect(record.evidence).toHaveLength(1);
    });

    it("records a claim that cites nothing at all as a model inference", async () => {
      const record = await runResearch({
        question: "What did grid-scale storage cost?",
        limits: limits(),
        researchProvider: createStubResearchProvider({
          script: {
            search: () => [
              sourceFixture("https://example.org/a", { content: COST_CONTENT }),
            ],
          },
        }),
        provider: modelWith({
          findings: () => ({
            findings: [{ statement: "Costs will keep falling." }],
          }),
        }),
      });

      expect(record.findings[0]?.basis).toBe("model");
      expect(record.evidence).toStrictEqual([]);

      const completed = record.observations.find(
        (item) => item.status === "completed",
      );
      expect(completed?.output?.uncited).toBe(1);
    });
  });

  describe("deduplication across tasks", () => {
    it("keeps one source when two tasks retrieve the same document", async () => {
      // The same page, differing only in a tracking parameter, so the
      // canonicaliser is what makes them one source rather than the id.
      const first = sourceFixture("https://example.org/page?utm_source=news", {
        content: COST_CONTENT,
      });
      const second = sourceFixture("https://example.org/page", {
        content: COST_CONTENT,
      });

      let call = 0;

      const record = await runResearch({
        question: "What did grid-scale storage cost?",
        limits: limits(),
        researchProvider: createStubResearchProvider({
          script: {
            search: () => {
              call += 1;
              return call === 1 ? [first] : [second];
            },
          },
        }),
        provider: modelWith({
          questions: ["What did it cost?", "What did it cost per kWh?"],
          findings: () => ({
            findings: [
              quoteFinding(0, "battery pack costs", "Costs fell substantially."),
            ],
          }),
        }),
      });

      expect(record.sources).toHaveLength(1);
      expect(record.findings).toHaveLength(1);

      // The finding from the second task cited a duplicate id; the chain still
      // terminates on the one source that was kept.
      const evidence = record.evidence[0];
      expect(record.sources[0]?.id).toBe(evidence?.sourceId);
      expect(evidence?.url).toBe("https://example.org/page");
    });

    it("skips a finding whose statement the run has already recorded", async () => {
      let call = 0;

      const record = await runResearch({
        question: "What did grid-scale storage cost?",
        limits: limits(),
        researchProvider: createStubResearchProvider({
          script: {
            search: () => {
              call += 1;
              return [
                sourceFixture(`https://example.org/p${call}`, {
                  content: COST_CONTENT,
                }),
              ];
            },
          },
        }),
        provider: modelWith({
          questions: ["What did it cost?", "What did it cost per kWh?"],
          findings: () => ({
            findings: [
              quoteFinding(0, "battery pack costs", "Costs fell substantially."),
            ],
          }),
        }),
      });

      // Two tasks produced the same sentence from two different pages. Counting
      // it twice would read as corroboration that does not exist.
      expect(record.findings).toHaveLength(1);
      expect(record.sources).toHaveLength(2);
      expect(record.result?.sufficiency).toBe("sufficient");
    });
  });

  describe("conflicts", () => {
    it("reports conflicting when two source-backed findings cannot both be true", async () => {
      const record = await runResearch({
        question: "What did grid-scale storage cost?",
        limits: limits(),
        researchProvider: createStubResearchProvider({
          script: {
            search: () => [
              sourceFixture("https://example.org/costs", { content: COST_CONTENT }),
              sourceFixture("https://example.org/capacity", {
                content: DEPLOYMENT_CONTENT,
              }),
            ],
          },
        }),
        provider: modelWith({
          findings: () => ({
            findings: [
              quoteFinding(0, "battery pack costs", "Costs fell."),
              quoteFinding(1, "Installed grid-scale storage", "Capacity grew."),
            ],
            conflicts: [
              {
                description: "The two sources describe different trends.",
                findingIndices: [0, 1],
              },
            ],
          }),
        }),
      });

      expect(record.result?.sufficiency).toBe("conflicting");
      expect(record.conflicts).toHaveLength(1);

      const conflict = record.conflicts[0];
      expect(conflict?.findingIds).toHaveLength(2);
      expect(conflict?.sourceIds).toHaveLength(2);
      expect(record.result?.summary).toContain("disagree");
    });

    it("drops a conflict whose side is not backed by retrieved text", async () => {
      const record = await runResearch({
        question: "What did grid-scale storage cost?",
        limits: limits(),
        researchProvider: createStubResearchProvider({
          script: {
            search: () => [
              sourceFixture("https://example.org/costs", { content: COST_CONTENT }),
            ],
          },
        }),
        provider: modelWith({
          findings: () => ({
            findings: [
              quoteFinding(0, "battery pack costs", "Costs fell."),
              // No citation, so this side is a model inference.
              { statement: "Costs actually rose." },
            ],
            conflicts: [
              {
                description: "Two claims disagree.",
                findingIndices: [0, 1],
              },
            ],
          }),
        }),
      });

      // Two disagreeing inferences are not evidence that the sources disagree.
      expect(record.conflicts).toStrictEqual([]);

      // And the run is not penalised for it. One claim that *did* pass
      // verification is still an answer drawn from a retrieved source; the
      // unroutable conflict changed nothing except what is not being claimed.
      expect(record.result?.sufficiency).toBe("sufficient");
    });
  });

  describe("limits", () => {
    it("truncates an oversized plan and reports the ceiling it hit", async () => {
      const record = await runResearch({
        question: "What did grid-scale storage cost?",
        limits: limits({ maxTasks: 2 }),
        researchProvider: createStubResearchProvider({
          script: {
            search: () => [
              sourceFixture("https://example.org/a", { content: COST_CONTENT }),
            ],
          },
        }),
        provider: modelWith({
          questions: questions(4),
        }),
      });

      expect(record.plan?.tasks).toHaveLength(2);
      expect(record.result?.limitsReached).toContain("max_tasks");

      // A run that stopped at a ceiling has not finished looking, so it cannot
      // be reported as sufficient even though it found things.
      expect(record.result?.sufficiency).toBe("insufficient");
    });

    it("stops at the run-wide source ceiling and marks the rest skipped", async () => {
      const record = await runResearch({
        question: "What did grid-scale storage cost?",
        limits: limits({ maxSourcesTotal: 1, maxSourcesPerTask: 1 }),
        researchProvider: createStubResearchProvider({
          script: {
            search: () => [
              sourceFixture("https://example.org/a", { content: COST_CONTENT }),
            ],
          },
        }),
        provider: modelWith({ questions: questions(3) }),
      });

      expect(record.sources).toHaveLength(1);
      expect(record.result?.limitsReached).toContain("max_sources_total");

      const statuses = record.plan?.tasks.map((task) => task.status);
      expect(statuses).toStrictEqual(["completed", "skipped", "skipped"]);

      expect(
        record.events.filter((event) => event.type === "step.skipped"),
      ).toHaveLength(2);

      // Partial results survive: the source that was retrieved is still here.
      expect(record.result?.sources).toHaveLength(1);
    });

    it("reports the per-task ceiling only when a provider ignored it", async () => {
      const record = await runResearch({
        question: "What did grid-scale storage cost?",
        limits: limits({ maxSourcesPerTask: 2 }),
        researchProvider: createStubResearchProvider({
          script: {
            search: () =>
              ["a", "b", "c", "d"].map((slug) =>
                sourceFixture(`https://example.org/${slug}`, {
                  content: COST_CONTENT,
                }),
              ),
          },
        }),
        provider: modelWith({}),
      });

      expect(record.sources).toHaveLength(2);
      expect(record.result?.limitsReached).toContain("max_sources_per_task");

      const completed = record.observations.find(
        (item) => item.status === "completed",
      );
      expect(completed?.output?.dropped).toBe(2);
    });

    it("does not claim the per-task ceiling was reached when the provider honoured it", async () => {
      const record = await runResearch({
        question: "What did grid-scale storage cost?",
        limits: limits({ maxSourcesPerTask: 5 }),
        researchProvider: createStubResearchProvider({
          script: {
            search: () => [
              sourceFixture("https://example.org/a", { content: COST_CONTENT }),
            ],
          },
        }),
        provider: modelWith({}),
      });

      expect(record.result?.limitsReached).toStrictEqual([]);
    });

    it("stops at the wall-clock ceiling between tasks and keeps what it found", async () => {
      // The deadline is checked between tasks, so the only way to test it
      // deterministically is to make one task genuinely outlast it. The search
      // handler burns real milliseconds rather than the test relying on the
      // clock advancing on its own — a sleep of "about one millisecond" would
      // be a race, and a test that races is a test that fails on a fast machine.
      const record = await runResearch({
        question: "What did grid-scale storage cost?",
        limits: limits({ maxDurationMs: 10, maxTasks: 3 }),
        researchProvider: createStubResearchProvider({
          script: {
            search: () => {
              const until = Date.now() + 60;
              while (Date.now() < until) {
                // Deliberate: the point is to consume wall-clock time.
              }

              return [
                sourceFixture("https://example.org/a", { content: COST_CONTENT }),
              ];
            },
          },
        }),
        provider: modelWith({ questions: questions(3) }),
      });

      expect(record.result?.limitsReached).toContain("max_duration");

      // The first task ran and its source is in the result. §22's requirement
      // is not that a run stopped early reports nothing, but that it reports
      // everything it had when it stopped.
      const statuses = record.plan?.tasks.map((task) => task.status);
      expect(statuses).toStrictEqual(["completed", "skipped", "skipped"]);
      expect(record.sources).toHaveLength(1);
      expect(record.result?.sources).toHaveLength(1);

      // A run cut short has not finished looking, so it cannot be sufficient.
      expect(record.result?.sufficiency).toBe("insufficient");
    });
  });

  describe("cancellation", () => {
    it("stops before the first task and reports the run as cancelled", async () => {
      let searched = 0;

      const record = await runResearch({
        question: "What did grid-scale storage cost?",
        limits: limits(),
        isCancelled: () => true,
        researchProvider: createStubResearchProvider({
          script: {
            search: () => {
              searched += 1;
              return [];
            },
          },
        }),
        provider: modelWith({ questions: questions(2) }),
      });

      expect(record.status).toBe("cancelled");
      expect(record.result?.sufficiency).toBe("failed");
      expect(searched).toBe(0);

      expect(
        record.events.some((event) => event.type === "execution.cancelled"),
      ).toBe(true);

      // Cancellation is not a failure, so it is recorded without an error.
      expect(record.result?.errors).toStrictEqual([]);
    });
  });

  describe("when a step fails", () => {
    it("fails one task, keeps the run going and still returns the other results", async () => {
      // The executor logs a tool's exception server-side, by design. Silenced
      // here so a run that is supposed to fail does not read as a broken suite.
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        let call = 0;

        const record = await runResearch({
          question: "What did grid-scale storage cost?",
          limits: limits(),
          researchProvider: createStubResearchProvider({
            script: {
              search: () => {
                call += 1;

                if (call === 1) {
                  throw new Error("The retrieval service refused the request.");
                }

                return [
                  sourceFixture("https://example.org/b", { content: COST_CONTENT }),
                ];
              },
            },
          }),
          provider: modelWith({
            questions: questions(2),
            findings: () => ({
              findings: [
                quoteFinding(0, "battery pack costs", "Costs fell substantially."),
              ],
            }),
          }),
        });

        const statuses = record.plan?.tasks.map((task) => task.status);
        expect(statuses).toStrictEqual(["failed", "completed"]);

        // A failing tool does not throw out of the executor; it comes back as a
        // receipt, which is what keeps one bad task from destroying the run.
        expect(record.plan?.tasks[0]?.error?.code).toBe("tool_failed");

        expect(record.sources).toHaveLength(1);
        expect(record.findings).toHaveLength(1);

        // One failed task is a gap, not a malfunction — but it does rule out
        // "sufficient", because the plan said that task needed establishing.
        expect(record.result?.sufficiency).toBe("insufficient");
        expect(record.result?.summary).toContain("failed");
      } finally {
        logged.mockRestore();
      }
    });

    it("survives a provider that returns something the schema rejects", async () => {
      const record = await runResearch({
        question: "What did grid-scale storage cost?",
        limits: limits(),
        researchProvider: createStubResearchProvider({
          script: {
            search: () => [
              { ...sourceFixture("https://example.org/a"), url: "javascript:alert(1)" },
              sourceFixture("https://example.org/b", { content: COST_CONTENT }),
            ],
          },
        }),
        provider: modelWith({}),
      });

      // The dangerous URL never became a source, and the good one did.
      expect(record.sources).toHaveLength(1);
      expect(record.sources[0]?.url).toBe("https://example.org/b");

      const completed = record.observations.find(
        (item) => item.status === "completed",
      );
      expect(completed?.output?.rejected).toBe(1);
    });
  });

  describe("when the finding extraction step fails", () => {
    it("fails that task only, keeping the sources it retrieved", async () => {
      // The executor logs tool failures server-side. Silenced so a test that
      // deliberately causes one does not look like a broken test run.
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        const record = await runResearch({
          question: "What did grid-scale storage cost?",
          limits: limits(),
          researchProvider: createStubResearchProvider({
            script: {
              search: () => [
                sourceFixture("https://example.org/a", { content: COST_CONTENT }),
              ],
            },
          }),
          provider: modelWith({
            // Not JSON, so the extractor cannot use it.
            findings: () => "I could not determine anything from these sources.",
          }),
        });

        expect(record.plan?.tasks[0]?.status).toBe("failed");
        expect(record.plan?.tasks[0]?.error?.code).toBe("evaluation_failed");

        // §22: the sources are still there. Failing to interpret retrieved
        // material does not un-retrieve it.
        expect(record.sources).toHaveLength(1);
        expect(record.result?.sources).toHaveLength(1);

        // Every task failed, which the evaluator treats as a malfunction
        // rather than a thin result — distinct from the "insufficient" a partial
        // result earns, and the distinction is the point: nothing was learned
        // here, so there is no partial answer to report.
        expect(record.result?.sufficiency).toBe("failed");
      } finally {
        logged.mockRestore();
      }
    });
  });

  describe("when the whole run goes wrong", () => {
    it("returns a failed record rather than throwing", async () => {
      const record = await runResearch({
        question: "What did grid-scale storage cost?",
        limits: limits(),
        researchProvider: createStubResearchProvider({
          script: {
            search: () => [
              sourceFixture("https://example.org/a", { content: COST_CONTENT }),
            ],
          },
        }),
        provider: createStubModelProvider({
          // Nothing scripted for research_plan, so the stub throws.
          script: {},
        }),
      });

      expect(record.status).toBe("failed");
      expect(record.result?.errors.length).toBeGreaterThan(0);
      expect(record.result?.errors[0]?.code).toBe("planner_failed");
    });
  });

  describe("the tool grant", () => {
    it("widens the grant per run and leaves the default untouched", async () => {
      const record = await runResearch({
        question: "What did grid-scale storage cost?",
        limits: limits(),
        researchProvider: createStubResearchProvider({
          script: {
            search: () => [
              sourceFixture("https://example.org/a", { content: COST_CONTENT }),
            ],
          },
        }),
        provider: modelWith({}),
      });

      const started = record.events.find(
        (event) => event.type === "execution.started",
      );

      expect(started?.data?.grantedCapabilities).toStrictEqual([
        "read_only",
        "network",
      ]);

      // §6: the narrowing is the whole point. An agent run still gets this.
      expect([...DEFAULT_TOOL_PERMISSION.list()]).toStrictEqual(["read_only"]);

      // And the run called the tool through the registry that holds it.
      expect(
        record.events.some(
          (event) =>
            event.type === "tool.started" &&
            event.data?.toolId === RESEARCH_SEARCH_TOOL_ID,
        ),
      ).toBe(true);
    });
  });
});
