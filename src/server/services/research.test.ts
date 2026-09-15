import { beforeEach, describe, expect, it } from "vitest";

import { clearResearch, listResearch } from "../research";
import { ServiceError } from "../errors";
import {
  getResearchById,
  listRecentResearch,
  listRecentResearchSummaries,
  startResearch,
  toResearchSummary,
} from "./research";

/**
 * The service layer, exercised through its public surface.
 *
 * **Why these tests cannot reach the network, stated plainly.** `startResearch`
 * resolves its own providers, and with the provider environment cleared,
 * `resolveResearchProvider()` returns the development adapter, whose
 * `isConfigured` is `false`. A run therefore stops at `search_not_configured`
 * before it plans anything, so no search is attempted and no model is called.
 * The environment is what makes this true, and `vitest.setup.ts` clears it before
 * every file, so the property holds on a machine that has `LLM_API_STYLE`
 * exported as well as on one that does not.
 *
 * Because of that, the assertions below are about the record's shape and the
 * store rather than about a particular verdict: the verdict a bare
 * `startResearch` reaches depends on environment resolution that this file has
 * no business pinning.
 *
 * The store is cleared between cases because it is process-local and module-level
 * — one case's run would otherwise be visible to the next, and a list assertion
 * would pass or fail on execution order.
 */

beforeEach(() => {
  clearResearch();
});

describe("startResearch", () => {
  describe("input validation", () => {
    it("refuses a body with no question", async () => {
      await expect(startResearch({})).rejects.toBeInstanceOf(ServiceError);
    });

    it("reports the refusal as a 400", async () => {
      await expect(startResearch({ question: "Why?" })).rejects.toMatchObject({
        status: 400,
      });
    });

    it("explains what was wrong in the message", async () => {
      await expect(startResearch({ question: "" })).rejects.toThrow(
        /at least 10 characters/,
      );
    });

    it("refuses a body that is not an object", async () => {
      await expect(startResearch("a question")).rejects.toMatchObject({
        status: 400,
      });
    });

    it("refuses a question longer than the ceiling", async () => {
      await expect(startResearch({ question: "a".repeat(501) })).rejects.toMatchObject(
        { status: 400 },
      );
    });

    it("records nothing when the input was refused", async () => {
      await expect(startResearch({})).rejects.toBeInstanceOf(ServiceError);

      // A rejected request must not leave a half-built record in the store.
      expect(listResearch()).toStrictEqual([]);
    });
  });

  describe("a request that passes validation", () => {
    it("returns a record whose question is the trimmed one", async () => {
      const record = await startResearch({
        question: "   What did grid-scale storage cost?   ",
      });

      expect(record.request.question).toBe("What did grid-scale storage cost?");
    });

    it("returns a record that has finished", async () => {
      const record = await startResearch({
        question: "What did grid-scale storage cost?",
      });

      // The run completes inside the call: there is no queue and no background
      // worker, so a returned record is terminal and carries its own result.
      expect(record.finishedAt).toBeDefined();
      expect(record.result).toBeDefined();
      expect(record.status).not.toBe("running");
    });

    it("stores the record before returning it", async () => {
      const record = await startResearch({
        question: "What did grid-scale storage cost?",
      });

      expect(getResearchById(record.id).id).toBe(record.id);
      expect(listRecentResearch().map((item) => item.id)).toStrictEqual([
        record.id,
      ]);
    });

    it("reports whether retrieval reached an external service", async () => {
      const record = await startResearch({
        question: "What did grid-scale storage cost?",
      });

      // The provenance a reader needs. In this build it is false, because the
      // only retrieval provider is the deterministic development adapter — and a
      // result that could not say so would be indistinguishable from one that
      // read the web.
      expect(typeof record.provider.isExternal).toBe("boolean");
      expect(record.provider.id).toBeTruthy();
    });

    it("never throws for a failure the run itself recorded", async () => {
      // A run that could not search is data, not an exception. Only a malformed
      // request and an unconstructable provider reach `toErrorResponse`.
      const record = await startResearch({
        question: "What did grid-scale storage cost?",
      });

      expect(record.result?.errors).toBeDefined();
      expect(Array.isArray(record.result?.errors)).toBe(true);
    });

    it("accepts a question supplied by the caller with a fabricated result", async () => {
      const record = await startResearch({
        question: "What did grid-scale storage cost?",
        status: "completed",
        findings: [{ statement: "Costs fell.", basis: "source" }],
        result: { sufficiency: "sufficient" },
      });

      // The caller cannot assert that work was done: unknown fields are dropped
      // by the schema, so nothing they sent reached the run.
      expect(record.result?.sufficiency).not.toBe("sufficient");
      expect(record.findings).toStrictEqual([]);
    });
  });
});

describe("getResearchById", () => {
  it("returns a stored record", async () => {
    const record = await startResearch({
      question: "What did grid-scale storage cost?",
    });

    expect(getResearchById(record.id)).toStrictEqual(record);
  });

  it("raises a 404 for an unknown id", () => {
    expect(() => getResearchById("research_does_not_exist")).toThrow(ServiceError);
  });

  it("reports the miss as a 404 rather than a 500", () => {
    // A read that misses is not found, not broken. Reconstructing a record
    // would mean inventing research nobody carried out.
    try {
      getResearchById("research_does_not_exist");
      throw new Error("Expected getResearchById to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceError);
      expect((error as ServiceError).status).toBe(404);
    }
  });
});

describe("listRecentResearch", () => {
  it("is empty before anything has been researched", () => {
    expect(listRecentResearch()).toStrictEqual([]);
  });

  it("lists the most recent first", async () => {
    const first = await startResearch({
      question: "What did grid-scale storage cost?",
    });
    const second = await startResearch({
      question: "How much grid-scale storage was installed?",
    });

    expect(listRecentResearch().map((item) => item.id)).toStrictEqual([
      second.id,
      first.id,
    ]);
  });
});

describe("toResearchSummary", () => {
  it("carries the counts a list needs and not the material itself", async () => {
    const record = await startResearch({
      question: "What did grid-scale storage cost?",
    });

    const summary = toResearchSummary(record);

    expect(summary.id).toBe(record.id);
    expect(summary.question).toBe(record.request.question);
    expect(summary.status).toBe(record.status);
    expect(summary.sourceCount).toBe(record.sources.length);
    expect(summary.findingCount).toBe(record.findings.length);
    expect(summary.conflictCount).toBe(record.conflicts.length);
  });

  it("carries no source, finding or event log", async () => {
    const record = await startResearch({
      question: "What did grid-scale storage cost?",
    });

    const summary = toResearchSummary(record) as unknown as Record<string, unknown>;

    // A full record carries every retrieved passage and the whole event log,
    // which is the right size for one record and the wrong size for a list.
    expect(summary).not.toHaveProperty("sources");
    expect(summary).not.toHaveProperty("findings");
    expect(summary).not.toHaveProperty("evidence");
    expect(summary).not.toHaveProperty("events");
    expect(summary).not.toHaveProperty("observations");
  });

  it("omits a sufficiency that does not exist yet", () => {
    const summary = toResearchSummary({
      id: "research_1",
      request: {
        id: "rrequest_1",
        question: "What did grid-scale storage cost?",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      status: "created",
      provider: {
        id: "dev",
        label: "Development adapter",
        model: "none",
        isExternal: false,
      },
      observations: [],
      events: [],
      sources: [],
      findings: [],
      evidence: [],
      conflicts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    // Absent rather than defaulted: an unfinished run has not been judged, and
    // `insufficient` would be a verdict it never reached.
    expect(summary.sufficiency).toBeUndefined();
    expect(summary.summary).toBeUndefined();
    expect(summary.finishedAt).toBeUndefined();
  });
});

describe("listRecentResearchSummaries", () => {
  it("has one summary per stored record", async () => {
    await startResearch({ question: "What did grid-scale storage cost?" });

    expect(listRecentResearchSummaries()).toHaveLength(listRecentResearch().length);
  });

  it("is empty before anything has been researched", () => {
    expect(listRecentResearchSummaries()).toStrictEqual([]);
  });
});
