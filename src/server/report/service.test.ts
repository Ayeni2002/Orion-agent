import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type ModelOperation, type ModelProvider } from "@/server/agent";
import { createStubModelProvider } from "@/server/agent/provider/stub-provider";
import { clearResearch, saveResearch } from "@/server/research";
import type { Report, ReportGenerationResult } from "@/types/report";

import {
  RESEARCH_ID,
  type RecordOverrides,
  researchRecordFixture,
} from "./fixtures";
import { generateReportFor, toReportSummary } from "./service";
import {
  MAX_RETAINED_REPORTS,
  clearReports,
  findReportByResearchId,
  getReport,
  listReports,
  saveReport,
} from "./store";

/**
 * Reports as the rest of the application reaches them.
 *
 * Two stores are process-local module state, so every case clears both before it
 * runs — a report retained by an earlier case is exactly the kind of cross-test
 * coupling that makes the reuse rule look like it works when it is only finding a
 * leftover.
 *
 * **The store is exercised here rather than in a file of its own**, because every
 * one of its functions exists to answer a question this service asks: "is there
 * already a report for this record?", "what is in the list?", "what does that
 * report hold?". Driving them only through the service would leave the eviction
 * bound reachable by generating twenty-six reports, so the last describe calls
 * them directly and says so.
 */

const GOOD_SUMMARY =
  "Grid-scale pack costs fell by about 40% between 2019 and 2024, and installed capacity reached 90 GW in 2025.";

const VALID_RESPONSE = {
  summary: { body: GOOD_SUMMARY, findingIndices: [0] },
  sections: [
    {
      heading: "The cost decline",
      body: "Grid-scale pack costs fell by about 40% between 2019 and 2024, according to the survey.",
      findingIndices: [0],
    },
  ],
};

/** A scripted external provider, with its call counter handed back. */
function scriptedProvider(response: unknown = VALID_RESPONSE) {
  const calls: Record<ModelOperation, number> = {
    plan: 0,
    execute_step: 0,
    evaluate: 0,
    research_plan: 0,
    research_findings: 0,
    report: 0,
  };

  const provider = createStubModelProvider({
    script: { report: () => response as Record<string, unknown> },
    descriptor: { isExternal: true },
    calls,
  });

  return { provider, calls };
}

/**
 * The report from an outcome, or a failure.
 *
 * The refusal branch is the assertion in several tests below, so reaching for
 * `outcome.report` behind a shared narrowing keeps each case about the thing it
 * names instead of about the shape of the result type.
 */
function reportOf(outcome: ReportGenerationResult): Report {
  if (!outcome.ok) {
    throw new Error(`expected a report, but the outcome was: ${outcome.reason}`);
  }

  return outcome.report;
}

/** Puts a finished research record in the research store, as a run would. */
function givenResearch(overrides: RecordOverrides = {}): void {
  saveResearch(researchRecordFixture(overrides));
}

beforeEach(() => {
  clearReports();
  clearResearch();
});

afterEach(() => {
  clearReports();
  clearResearch();
});

describe("generateReportFor", () => {
  describe("when the research can be reported on", () => {
    it("produces a report and returns it", async () => {
      givenResearch();
      const { provider, calls } = scriptedProvider();

      const report = reportOf(
        await generateReportFor({ researchId: RESEARCH_ID, provider }),
      );

      expect(report.researchId).toBe(RESEARCH_ID);
      expect(report.metadata.generation.mode).toBe("model");
      expect(calls.report).toBe(1);
    });

    it("keeps it, so the workspace can list it", async () => {
      givenResearch();
      const { provider } = scriptedProvider();

      const report = reportOf(
        await generateReportFor({ researchId: RESEARCH_ID, provider }),
      );

      expect(getReport(report.id)).toStrictEqual(report);
      expect(listReports()).toHaveLength(1);
    });

    it("builds one from the record alone when no provider is available", async () => {
      // §5, at the layer a caller actually reaches. A report must remain
      // producible with no paid model, and "no provider configured" is a
      // supported state rather than a feature being unavailable.
      givenResearch();

      const report = reportOf(await generateReportFor({ researchId: RESEARCH_ID }));

      expect(report.metadata.generation.mode).toBe("deterministic");
      expect(report.metadata.generation.reason).toBeTruthy();
      expect(report.citations.length).toBeGreaterThan(0);
      expect(report.sections.length).toBeGreaterThan(0);
    });

    it("still produces a report when the provider fails", async () => {
      givenResearch();

      const provider: ModelProvider = {
        descriptor: {
          id: "stub",
          label: "Scripted test provider",
          model: "stub-model",
          isExternal: true,
        },
        generate: () => Promise.reject(new Error("upstream is down")),
      };

      const report = reportOf(
        await generateReportFor({ researchId: RESEARCH_ID, provider }),
      );

      // A failed model call is a worse report, not a refusal: the caller gets a
      // document, and the metadata says why it is the plain one.
      expect(report.status).toBe("completed");
      expect(report.metadata.generation.mode).toBe("deterministic");
    });

    it("honours useModel: false even when a provider is available", async () => {
      givenResearch();
      const { provider, calls } = scriptedProvider();

      const report = reportOf(
        await generateReportFor({
          researchId: RESEARCH_ID,
          provider,
          useModel: false,
        }),
      );

      expect(calls.report).toBe(0);
      expect(report.metadata.generation.mode).toBe("deterministic");
    });
  });

  describe("when the research cannot be reported on", () => {
    it("refuses an id that names no record, and says asking again will not help", async () => {
      const outcome = await generateReportFor({ researchId: "res_nothing" });

      expect(outcome.ok).toBe(false);
      expect(outcome.ok ? "" : outcome.reason).toBe("not_found");
      expect(outcome.ok ? "" : outcome.error.message).toBe(
        "No research record with that id was found.",
      );
      expect(listReports()).toStrictEqual([]);
    });

    it("refuses a record that finished without a result", async () => {
      givenResearch({ result: undefined, status: "completed" });

      const outcome = await generateReportFor({ researchId: RESEARCH_ID });

      expect(outcome.ok).toBe(false);
      expect(outcome.ok ? "" : outcome.reason).toBe("not_ready");
      expect(outcome.ok ? "" : outcome.error.message).toBe(
        "That research run finished without recording a result, so there is nothing to report on.",
      );
    });

    it("refuses a record that failed before recording a result, and does not tell the caller to wait", async () => {
      // The default for a fixture with no result, and the case a person actually
      // meets. An earlier wording said "has not produced a result yet" for every
      // status but `completed`, which asked a reader to wait for a run that had
      // already stopped.
      givenResearch({ result: undefined });

      const outcome = await generateReportFor({ researchId: RESEARCH_ID });

      expect(outcome.ok ? "" : outcome.reason).toBe("not_ready");
      expect(outcome.ok ? "" : outcome.error.message).toBe(
        "That research run failed before recording a result, so there is nothing to report on.",
      );
    });

    it("distinguishes a run still in flight from one that has stopped", async () => {
      // Only the first is worth waiting for, and the message is the only place
      // that distinction reaches a person.
      givenResearch({ result: undefined, status: "running" });

      const outcome = await generateReportFor({ researchId: RESEARCH_ID });

      expect(outcome.ok ? "" : outcome.reason).toBe("not_ready");
      expect(outcome.ok ? "" : outcome.error.message).toBe(
        "That research run is still running, so there is nothing to report on yet.",
      );
    });

    it("stores nothing when it refuses", async () => {
      givenResearch({ result: undefined });

      await generateReportFor({ researchId: RESEARCH_ID });

      expect(listReports()).toStrictEqual([]);
      expect(findReportByResearchId(RESEARCH_ID)).toBeUndefined();
    });
  });

  describe("reuse (§22)", () => {
    it("returns the report already made for the record, without calling a model", async () => {
      givenResearch();
      const first = scriptedProvider();

      const one = reportOf(
        await generateReportFor({ researchId: RESEARCH_ID, provider: first.provider }),
      );

      const second = scriptedProvider();

      const two = reportOf(
        await generateReportFor({ researchId: RESEARCH_ID, provider: second.provider }),
      );

      expect(two.id).toBe(one.id);
      // The claim §22 is really making: no second generation happened.
      expect(second.calls.report).toBe(0);
      expect(listReports()).toHaveLength(1);
    });

    it("reuses across a different request, because the document is the record's", async () => {
      givenResearch();
      const model = scriptedProvider();

      const one = reportOf(
        await generateReportFor({ researchId: RESEARCH_ID, provider: model.provider }),
      );

      const two = reportOf(
        await generateReportFor({ researchId: RESEARCH_ID, useModel: false }),
      );

      expect(one.metadata.generation.mode).toBe("model");
      expect(two.metadata.generation.mode).toBe("model");
      expect(two.id).toBe(one.id);
    });

    it("makes a new one when the caller asks for one", async () => {
      givenResearch();
      const first = scriptedProvider();

      const one = reportOf(
        await generateReportFor({ researchId: RESEARCH_ID, provider: first.provider }),
      );

      const second = scriptedProvider();

      const two = reportOf(
        await generateReportFor({
          researchId: RESEARCH_ID,
          provider: second.provider,
          regenerate: true,
        }),
      );

      expect(second.calls.report).toBe(1);
      expect(two.id).not.toBe(one.id);
      expect(listReports()).toHaveLength(2);
    });

    it("does not reuse a report made for some other research record", async () => {
      givenResearch();
      saveResearch(researchRecordFixture({ id: "res_other" }));
      const { provider } = scriptedProvider();

      const one = reportOf(
        await generateReportFor({ researchId: RESEARCH_ID, provider }),
      );
      const two = reportOf(
        await generateReportFor({ researchId: "res_other", provider }),
      );

      expect(two.researchId).toBe("res_other");
      expect(two.id).not.toBe(one.id);
      expect(listReports()).toHaveLength(2);
    });
  });
});

describe("toReportSummary", () => {
  it("carries exactly what the list needs and nothing that only matters once opened", async () => {
    givenResearch();
    const { provider } = scriptedProvider();

    const report = reportOf(
      await generateReportFor({ researchId: RESEARCH_ID, provider }),
    );

    const summary = toReportSummary(report);

    // The exact key set, rather than a spot check: §8's list needs a title, a
    // date, a status and the research it came from, and what it must not carry is
    // the document.
    expect(Object.keys(summary).sort()).toStrictEqual([
      "citationCount",
      "createdAt",
      "generationMode",
      "id",
      "objective",
      "researchId",
      "sectionCount",
      "sourceCount",
      "status",
      "title",
    ]);
    expect(summary).toStrictEqual({
      id: report.id,
      researchId: RESEARCH_ID,
      title: report.title,
      objective: report.objective,
      status: "completed",
      generationMode: "model",
      sectionCount: report.sections.length,
      citationCount: report.citations.length,
      sourceCount: report.sources.length,
      createdAt: report.generatedAt,
    });
  });

  it("carries the mode the report was actually made in", async () => {
    givenResearch();

    const report = reportOf(
      await generateReportFor({ researchId: RESEARCH_ID, useModel: false }),
    );

    expect(toReportSummary(report).generationMode).toBe("deterministic");
  });
});

describe("the store", () => {
  it("lists the most recently written first", async () => {
    givenResearch();
    saveResearch(researchRecordFixture({ id: "res_other" }));
    const { provider } = scriptedProvider();

    const one = reportOf(
      await generateReportFor({ researchId: RESEARCH_ID, provider }),
    );
    const two = reportOf(
      await generateReportFor({ researchId: "res_other", provider }),
    );

    expect(listReports().map((report) => report.id)).toStrictEqual([two.id, one.id]);
  });

  it("bounds what it retains, evicting the oldest", () => {
    const overflow = 3;

    for (let index = 0; index < MAX_RETAINED_REPORTS + overflow; index += 1) {
      saveReport({ ...buildReport(), id: `report_${index}` });
    }

    expect(listReports()).toHaveLength(MAX_RETAINED_REPORTS);
    expect(getReport("report_0")).toBeUndefined();
    expect(getReport(`report_${MAX_RETAINED_REPORTS + overflow - 1}`)).toBeDefined();
  });

  it("moves a re-saved report to the end rather than leaving it to be evicted first", () => {
    for (let index = 0; index < MAX_RETAINED_REPORTS; index += 1) {
      saveReport({ ...buildReport(), id: `report_${index}` });
    }

    const oldest = getReport("report_0");

    if (oldest === undefined) {
      throw new Error("the fixture should have been retained");
    }

    saveReport(oldest);
    saveReport({ ...buildReport(), id: "report_new" });

    expect(getReport("report_0")).toBeDefined();
    expect(getReport("report_1")).toBeUndefined();
  });

  it("finds the newest report for a research record, and nothing when there is none", () => {
    saveReport({ ...buildReport(), id: "report_a", researchId: "res_a" });
    saveReport({ ...buildReport(), id: "report_b", researchId: "res_a" });

    expect(findReportByResearchId("res_a")?.id).toBe("report_b");
    expect(findReportByResearchId("res_absent")).toBeUndefined();
  });
});

/** A complete report, for the store cases that do not need generation. */
function buildReport() {
  return {
    id: "report_fixture",
    researchId: RESEARCH_ID,
    title: "A title",
    objective: "A question",
    status: "completed" as const,
    sections: [],
    citations: [],
    sources: [],
    conflicts: [],
    unresolvedQuestions: [],
    limitsReached: [],
    errors: [],
    metadata: {
      researchProvider: researchRecordFixture().provider,
      generation: {
        mode: "deterministic" as const,
        droppedCitationCount: 0,
        ungroundedNumberCount: 0,
        truncatedSectionCount: 0,
      },
    },
    generatedAt: "2026-01-01T00:00:00.000Z",
  };
}
