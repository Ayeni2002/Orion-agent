import { describe, expect, it } from "vitest";

import type {
  ResearchConflict,
  ResearchEvidence,
  ResearchFinding,
  ResearchLimitKind,
  ResearchSource,
  ResearchTask,
} from "@/types/research";

import { evaluateResearch, type ResearchEvaluationInput } from "./index";

/**
 * The evaluator, tested as a decision procedure rather than as prose.
 *
 * Every input here is built by hand rather than produced by a run, which is the
 * point: the verdict is supposed to be a function of the recorded facts alone,
 * so a test that constructs those facts directly is testing the whole of it.
 * The summary strings are asserted on for one property only — that they name
 * the fact that decided the verdict — because a summary that hides its reason
 * is the failure mode worth guarding against.
 *
 * The precedence order gets its own group. `failed` before `conflicting` before
 * `sufficient` before `insufficient` is not arbitrary, and a test that only
 * checked each verdict in isolation would pass with the branches in any order.
 */

function task(overrides: Partial<ResearchTask> = {}): ResearchTask {
  return {
    id: "task-1",
    planId: "plan-1",
    index: 0,
    question: "What did grid-scale storage cost?",
    query: "grid-scale storage cost",
    status: "completed",
    sourceIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function source(overrides: Partial<ResearchSource> = {}): ResearchSource {
  return {
    id: "source-1",
    url: "https://example.org/a",
    domain: "example.org",
    content: "Grid-scale battery pack costs fell by about 40%.",
    providerId: "test",
    retrievedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function finding(overrides: Partial<ResearchFinding> = {}): ResearchFinding {
  return {
    id: "finding-1",
    statement: "Grid-scale battery costs fell by roughly 40%.",
    taskId: "task-1",
    basis: "source",
    sourceIds: ["source-1"],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function evidence(overrides: Partial<ResearchEvidence> = {}): ResearchEvidence {
  return {
    id: "evidence-1",
    findingId: "finding-1",
    sourceId: "source-1",
    quote: "battery pack costs fell by about 40%",
    url: "https://example.org/a",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function conflict(overrides: Partial<ResearchConflict> = {}): ResearchConflict {
  return {
    id: "conflict-1",
    findingIds: ["finding-1", "finding-2"],
    description: "The two sources disagree about the trend.",
    sourceIds: ["source-1", "source-2"],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A run that answered the question from one source, unless told otherwise. */
function input(
  overrides: Partial<ResearchEvaluationInput> = {},
): ResearchEvaluationInput {
  return {
    question: "What did grid-scale storage cost?",
    tasks: [task()],
    sources: [source()],
    findings: [finding()],
    evidence: [evidence()],
    conflicts: [],
    errors: [],
    performedRetrieval: true,
    limitsReached: [],
    cancelled: false,
    ...overrides,
  };
}

describe("evaluateResearch", () => {
  describe("sufficient", () => {
    it("returns sufficient when a claim is traced to a retrieved source", () => {
      const result = evaluateResearch(input());

      expect(result.sufficiency).toBe("sufficient");
      expect(result.summary).toContain("answered");
    });

    it("returns sufficient when only some of the findings are source-backed", () => {
      const result = evaluateResearch(
        input({
          findings: [
            finding(),
            finding({ id: "finding-2", basis: "model", sourceIds: [] }),
          ],
        }),
      );

      // A model inference alongside a sourced claim does not undo the sourced
      // claim. The inference is labelled where a reader meets it.
      expect(result.sufficiency).toBe("sufficient");
    });
  });

  describe("failed", () => {
    it("returns failed when the run was cancelled", () => {
      const result = evaluateResearch(input({ cancelled: true }));

      expect(result.sufficiency).toBe("failed");
      expect(result.summary).toContain("cancelled");
    });

    it("returns failed when the plan produced no tasks", () => {
      const result = evaluateResearch(input({ tasks: [] }));

      expect(result.sufficiency).toBe("failed");
      expect(result.summary).toContain("no tasks");
    });

    it("returns failed when every task in the plan failed", () => {
      const result = evaluateResearch(
        input({
          tasks: [
            task({ status: "failed" }),
            task({ id: "task-2", index: 1, status: "failed" }),
          ],
        }),
      );

      // Distinct from "insufficient": nothing was learned at all, so there is
      // no partial answer to report.
      expect(result.sufficiency).toBe("failed");
      expect(result.summary).toContain("failed");
    });

    it("carries the run's errors through with the verdict", () => {
      const error = { code: "tool_failed" as const, message: "The tool failed." };

      expect(evaluateResearch(input({ errors: [error] })).errors).toStrictEqual([
        error,
      ]);
    });
  });

  describe("conflicting", () => {
    it("returns conflicting when a conflict was recorded", () => {
      const result = evaluateResearch(input({ conflicts: [conflict()] }));

      expect(result.sufficiency).toBe("conflicting");
      expect(result.summary).toContain("disagree");
      expect(result.summary).toContain("recorded rather than resolved");
    });

    it("reports the conflict even when the run also fell short", () => {
      const result = evaluateResearch(
        input({
          conflicts: [conflict()],
          tasks: [task(), task({ id: "task-2", index: 1, status: "failed" })],
        }),
      );

      // Both facts are stated. A verdict that reported only the conflict would
      // hide that a task failed; one that reported only the shortfall would
      // hide the disagreement.
      expect(result.sufficiency).toBe("conflicting");
      expect(result.summary).toContain("fell short");
      expect(result.summary).toContain("failed");
    });

    it("counts the conflicts and the sources they span", () => {
      const result = evaluateResearch(
        input({
          conflicts: [conflict(), conflict({ id: "conflict-2" })],
          sources: [source(), source({ id: "source-2", url: "https://example.org/b" })],
        }),
      );

      expect(result.summary).toContain("2 unresolved conflicts");
      expect(result.summary).toContain("2 sources");
    });
  });

  describe("insufficient", () => {
    it("returns insufficient when no retrieval was performed", () => {
      const result = evaluateResearch(input({ performedRetrieval: false }));

      expect(result.sufficiency).toBe("insufficient");
      expect(result.summary).toContain("no retrieval was performed");
    });

    it("returns insufficient when nothing was retrieved", () => {
      const result = evaluateResearch(input({ sources: [] }));

      expect(result.sufficiency).toBe("insufficient");
      expect(result.summary).toContain("no sources were retrieved");
    });

    it("distinguishes no findings from unsupported findings", () => {
      const none = evaluateResearch(input({ findings: [], evidence: [] }));

      expect(none.summary).toContain("no findings were extracted");

      const unsupported = evaluateResearch(
        input({
          findings: [finding({ basis: "model", sourceIds: [] })],
          evidence: [],
        }),
      );

      expect(unsupported.summary).toContain("no finding could be traced");
    });

    it("returns insufficient when one task failed and the rest completed", () => {
      const result = evaluateResearch(
        input({
          tasks: [task(), task({ id: "task-2", index: 1, status: "failed" })],
        }),
      );

      // One failure is a gap rather than a malfunction — the run still produced
      // something — but the plan said that task needed establishing.
      expect(result.sufficiency).toBe("insufficient");
      expect(result.summary).toContain("1 task of 2 failed");
    });

    it.each<ResearchLimitKind>([
      "max_tasks",
      "max_sources_per_task",
      "max_sources_total",
      "max_findings",
      "max_duration",
    ])("returns insufficient when %s was reached", (limit) => {
      const result = evaluateResearch(input({ limitsReached: [limit] }));

      // A run stopped at a ceiling has not finished looking, so it cannot be
      // reported as sufficient even though it found something.
      expect(result.sufficiency).toBe("insufficient");
      expect(result.summary).toContain("reached");
    });

    it("still reports what it found alongside the shortfall", () => {
      const result = evaluateResearch(input({ limitsReached: ["max_tasks"] }));

      expect(result.summary).toContain("partial results");
    });

    it("reports every shortfall rather than the first", () => {
      const result = evaluateResearch(
        input({
          performedRetrieval: false,
          sources: [],
          findings: [],
          evidence: [],
          limitsReached: ["max_duration"],
        }),
      );

      expect(result.summary).toContain("no retrieval was performed");
      expect(result.summary).toContain("no sources were retrieved");
      expect(result.summary).toContain("no findings were extracted");
      expect(result.summary).toContain("reached");
    });
  });

  describe("precedence", () => {
    it("prefers failed to conflicting, because there is nothing to judge", () => {
      const result = evaluateResearch(
        input({ cancelled: true, conflicts: [conflict()] }),
      );

      expect(result.sufficiency).toBe("failed");
    });

    it("prefers failed to sufficient when every task failed", () => {
      const result = evaluateResearch(input({ tasks: [task({ status: "failed" })] }));

      expect(result.sufficiency).toBe("failed");
    });

    it("prefers conflicting to insufficient", () => {
      const result = evaluateResearch(
        input({ conflicts: [conflict()], limitsReached: ["max_tasks"] }),
      );

      expect(result.sufficiency).toBe("conflicting");
    });

    it("prefers sufficient to insufficient when nothing actually fell short", () => {
      const result = evaluateResearch(
        input({ tasks: [task({ status: "skipped" }), task({ id: "t2", index: 1 })] }),
      );

      // A skipped task is not a failed one. Nothing the run set out to do went
      // wrong, so the verdict reflects the evidence rather than the plan size.
      expect(result.sufficiency).toBe("sufficient");
    });
  });

  describe("determinism", () => {
    it("returns the same verdict for the same recorded facts", () => {
      const facts = input();

      // No clock, no provider and no randomness takes part in the decision —
      // which is what lets a run's sufficiency be reproducible and testable
      // without any provider at all.
      expect(evaluateResearch(facts)).toStrictEqual(evaluateResearch(facts));
    });

    it("does not mutate the findings it was given", () => {
      const findings = [finding()];
      const before = JSON.stringify(findings);

      evaluateResearch(input({ findings }));

      expect(JSON.stringify(findings)).toBe(before);
    });
  });
});
