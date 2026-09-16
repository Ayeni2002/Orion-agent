import { describe, expect, it } from "vitest";

import type {
  Report,
  ReportCitation,
  ReportGeneration,
  ReportSource,
  ReportSummary,
  ReportStatus,
} from "@/types/report";

import {
  GENERATION_MODE_PRESENTATION,
  REPORT_STATUS_PRESENTATION,
  describeGeneration,
  describeGenerationCorrections,
  findingIdsForSource,
  findReportForResearch,
  formatGeneratedAt,
  formatRetrievedAt,
  groupCitationsByFinding,
  readErrorMessage,
  readReport,
  readReportSummaries,
  sourceLabel,
} from "./view";

/**
 * The report presentation rules.
 *
 * §20's UI bullet, met where it can be met. The project has no component test
 * infrastructure — no `@testing-library/react`, no jsdom, and every other test
 * file is server-side — so the rules a reader would otherwise see only as pixels
 * are extracted into `./view` and asserted here, and the components above it do
 * layout and nothing else. Render-level behaviour stays untested, and the final
 * implementation report says so rather than implying otherwise.
 *
 * The tests are grouped by what each rule is defending: that a state cannot go
 * unlabelled, that the two generation modes cannot be confused for one another,
 * that a malformed response is reported as malformed rather than repaired, and
 * that the citation relationships are read rather than recomputed.
 */

/** A report, for the rules that need a whole one. */
function reportFixture(overrides: {
  generation?: Partial<ReportGeneration>;
  status?: ReportStatus;
} = {}): Report {
  return {
    id: "report_fixture",
    researchId: "res_fixture",
    title: "What did storage cost?",
    objective: "What did storage cost?",
    status: overrides.status ?? "completed",
    sections: [],
    citations: [],
    sources: [],
    conflicts: [],
    unresolvedQuestions: [],
    limitsReached: [],
    errors: [],
    metadata: {
      researchProvider: {
        id: "stub",
        label: "Scripted retrieval",
        model: "stub-search",
        isExternal: false,
      },
      generation: {
        mode: "deterministic",
        droppedCitationCount: 0,
        ungroundedNumberCount: 0,
        truncatedSectionCount: 0,
        ...overrides.generation,
      },
    },
    generatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function citationFixture(overrides: Partial<ReportCitation> = {}): ReportCitation {
  return {
    findingId: "fnd_cost",
    statement: "Costs fell.",
    basis: "source",
    sourceId: "src_bloomberg",
    url: "https://www.bloomberg.com/news/battery-cost-survey",
    domain: "bloomberg.com",
    ...overrides,
  };
}

function sourceFixture(overrides: Partial<ReportSource> = {}): ReportSource {
  return {
    id: "src_bloomberg",
    url: "https://www.bloomberg.com/news/battery-cost-survey",
    domain: "bloomberg.com",
    title: "Battery pack prices fall again",
    providerId: "stub",
    rank: 0,
    retrievedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function summaryFixture(overrides: Partial<ReportSummary> = {}): ReportSummary {
  return {
    id: "report_one",
    researchId: "res_fixture",
    title: "What did storage cost?",
    objective: "What did storage cost?",
    status: "completed",
    generationMode: "deterministic",
    sectionCount: 7,
    citationCount: 3,
    sourceCount: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("REPORT_STATUS_PRESENTATION", () => {
  it("names every status a report can hold", () => {
    const statuses: ReportStatus[] = ["completed", "failed"];

    for (const status of statuses) {
      const presentation = REPORT_STATUS_PRESENTATION[status];

      expect(presentation.label.length).toBeGreaterThan(0);
      // §19: state is never carried by colour alone — every tone has a word
      // beside it, and this asserts the word is there.
      expect(["success", "error", "warning", "active", "idle"]).toContain(
        presentation.tone,
      );
    }
  });

  it("does not give two statuses the same reading", () => {
    const labels = Object.values(REPORT_STATUS_PRESENTATION).map((p) => p.label);

    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("GENERATION_MODE_PRESENTATION", () => {
  it("describes both modes, and describes them differently", () => {
    const { model, deterministic } = GENERATION_MODE_PRESENTATION;

    expect(model.label).not.toBe(deterministic.label);
    expect(model.description).not.toBe(deterministic.description);
    // The distinction a reader has to be able to make: one contains judgement,
    // the other contains none at all.
    expect(deterministic.description).toContain("No model wrote this report");
    expect(model.description).toContain("checked against them");
  });
});

describe("describeGeneration", () => {
  it("gives the description alone when nothing went wrong", () => {
    expect(describeGeneration(reportFixture())).toBe(
      GENERATION_MODE_PRESENTATION.deterministic.description,
    );
  });

  it("puts the reason in front of the description when there is one", () => {
    const description = describeGeneration(
      reportFixture({
        generation: {
          mode: "deterministic",
          reason: "No model provider is configured.",
        },
      }),
    );

    expect(description).toContain("No model provider is configured.");
    expect(description).toContain(
      GENERATION_MODE_PRESENTATION.deterministic.description,
    );
    expect(description.indexOf("No model provider")).toBe(0);
  });

  it("describes a model-written report as one", () => {
    const description = describeGeneration(
      reportFixture({ generation: { mode: "model" } }),
    );

    expect(description).toBe(GENERATION_MODE_PRESENTATION.model.description);
  });
});

describe("describeGenerationCorrections", () => {
  it("says nothing when nothing had to be corrected", () => {
    expect(describeGenerationCorrections(reportFixture())).toStrictEqual([]);
  });

  it("says what was dropped, and that it was dropped", () => {
    const notes = describeGenerationCorrections(
      reportFixture({ generation: { droppedCitationCount: 3 } }),
    );

    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("3 reference(s)");
    expect(notes[0]).toContain("removed");
  });

  it("says a flagged sentence was kept rather than deleted", () => {
    // The distinction the whole design turns on, stated to the reader.
    const notes = describeGenerationCorrections(
      reportFixture({ generation: { ungroundedNumberCount: 1 } }),
    );

    expect(notes[0]).toContain("1 sentence(s)");
    expect(notes[0]).toContain("kept and marked");
  });

  it("says what was left out, and that what remains is whole", () => {
    const notes = describeGenerationCorrections(
      reportFixture({ generation: { truncatedSectionCount: 2 } }),
    );

    expect(notes[0]).toContain("2 section(s)");
    expect(notes[0]).toContain("What remains is complete.");
  });

  it("lists all three when all three happened", () => {
    const notes = describeGenerationCorrections(
      reportFixture({
        generation: {
          droppedCitationCount: 1,
          ungroundedNumberCount: 2,
          truncatedSectionCount: 3,
        },
      }),
    );

    expect(notes).toHaveLength(3);
    expect(notes[0]).toContain("1 reference(s)");
    expect(notes[1]).toContain("2 sentence(s)");
    expect(notes[2]).toContain("3 section(s)");
  });
});

describe("readErrorMessage", () => {
  it("reads a non-empty message", () => {
    expect(readErrorMessage({ error: "Research not found." }, "fallback")).toBe(
      "Research not found.",
    );
  });

  it("falls back for a body that carries no usable message", () => {
    expect(readErrorMessage({ error: "" }, "fallback")).toBe("fallback");
    expect(readErrorMessage({ error: "   " }, "fallback")).toBe("fallback");
    expect(readErrorMessage({ error: 42 }, "fallback")).toBe("fallback");
    expect(readErrorMessage({}, "fallback")).toBe("fallback");
    expect(readErrorMessage("a string", "fallback")).toBe("fallback");
    expect(readErrorMessage(null, "fallback")).toBe("fallback");
    expect(readErrorMessage(undefined, "fallback")).toBe("fallback");
  });
});

describe("readReport", () => {
  it("reads a body that carries a report", () => {
    const report = reportFixture();

    expect(readReport({ report })).toStrictEqual(report);
  });

  it("refuses a body that is not one, rather than reconstructing it", () => {
    // A component that "helpfully" repairs a response the server did not send is
    // a component that can show a reader a document that does not exist.
    expect(readReport(undefined)).toBeUndefined();
    expect(readReport(null)).toBeUndefined();
    expect(readReport("a string")).toBeUndefined();
    expect(readReport({})).toBeUndefined();
    expect(readReport({ report: undefined })).toBeUndefined();
    expect(readReport({ report: null })).toBeUndefined();
    expect(readReport({ report: "a string" })).toBeUndefined();
    expect(readReport({ report: { title: "No id.", sections: [] } })).toBeUndefined();
    expect(readReport({ report: { id: "report_x", sections: [] } })).toBeUndefined();
    expect(
      readReport({ report: { id: "report_x", title: "No sections." } }),
    ).toBeUndefined();
    expect(
      readReport({ report: { id: "report_x", title: "Bad sections.", sections: {} } }),
    ).toBeUndefined();
  });
});

describe("readReportSummaries", () => {
  it("reads a list, including an empty one", () => {
    expect(readReportSummaries({ reports: [] })).toStrictEqual([]);
    expect(readReportSummaries({ reports: [summaryFixture()] })).toHaveLength(1);
  });

  it("refuses a body that is not a list", () => {
    expect(readReportSummaries(undefined)).toBeUndefined();
    expect(readReportSummaries({})).toBeUndefined();
    expect(readReportSummaries({ reports: "a string" })).toBeUndefined();
    expect(readReportSummaries({ reports: null })).toBeUndefined();
  });
});

describe("findReportForResearch", () => {
  it("finds the report made from a research record", () => {
    const found = findReportForResearch(
      [summaryFixture({ id: "report_a", researchId: "res_a" })],
      "res_a",
    );

    expect(found?.id).toBe("report_a");
  });

  it("returns nothing when no report was made from it", () => {
    expect(findReportForResearch([summaryFixture()], "res_absent")).toBeUndefined();
    expect(findReportForResearch([], "res_fixture")).toBeUndefined();
  });

  it("takes the first of several, which is the newest", () => {
    // `listReports` returns newest-first, so a record regenerated deliberately
    // resolves to the report a caller would expect to be shown.
    const found = findReportForResearch(
      [
        summaryFixture({ id: "report_new", researchId: "res_a" }),
        summaryFixture({ id: "report_old", researchId: "res_a" }),
      ],
      "res_a",
    );

    expect(found?.id).toBe("report_new");
  });
});

describe("groupCitationsByFinding", () => {
  it("groups a finding's branches together", () => {
    const grouped = groupCitationsByFinding([
      citationFixture({ findingId: "fnd_cost", sourceId: "src_a" }),
      citationFixture({ findingId: "fnd_capacity", sourceId: "src_b" }),
      citationFixture({ findingId: "fnd_cost", sourceId: "src_c" }),
    ]);

    expect([...grouped.keys()]).toStrictEqual(["fnd_cost", "fnd_capacity"]);
    expect(grouped.get("fnd_cost")?.map((c) => c.sourceId)).toStrictEqual([
      "src_a",
      "src_c",
    ]);
  });

  it("keeps an inferred finding's single source-less branch", () => {
    const grouped = groupCitationsByFinding([
      citationFixture({
        findingId: "fnd_inference",
        basis: "model",
        sourceId: undefined,
        url: undefined,
        domain: undefined,
      }),
    ]);

    expect(grouped.get("fnd_inference")).toHaveLength(1);
    expect(grouped.get("fnd_inference")?.[0]?.sourceId).toBeUndefined();
  });

  it("groups nothing when there is nothing to group", () => {
    expect(groupCitationsByFinding([]).size).toBe(0);
  });

  it("preserves the order the citations arrived in, which is the record's", () => {
    const grouped = groupCitationsByFinding([
      citationFixture({ findingId: "fnd_b" }),
      citationFixture({ findingId: "fnd_a" }),
    ]);

    expect([...grouped.keys()]).toStrictEqual(["fnd_b", "fnd_a"]);
  });
});

describe("findingIdsForSource", () => {
  it("reads the relation from the source towards the claims behind it", () => {
    const citations = [
      citationFixture({ findingId: "fnd_cost", sourceId: "src_a" }),
      citationFixture({ findingId: "fnd_capacity", sourceId: "src_a" }),
      citationFixture({ findingId: "fnd_cost", sourceId: "src_b" }),
    ];

    expect(findingIdsForSource(citations, "src_a")).toStrictEqual([
      "fnd_cost",
      "fnd_capacity",
    ]);
    expect(findingIdsForSource(citations, "src_b")).toStrictEqual(["fnd_cost"]);
  });

  it("returns nothing for a source that supported no finding", () => {
    // A real and interesting state: retrieved, and behind no claim.
    expect(findingIdsForSource([citationFixture()], "src_commentary")).toStrictEqual(
      [],
    );
    expect(findingIdsForSource([], "src_a")).toStrictEqual([]);
  });

  it("names a finding once even when several of its branches share the source", () => {
    const citations = [
      citationFixture({ findingId: "fnd_cost", sourceId: "src_a" }),
      citationFixture({ findingId: "fnd_cost", sourceId: "src_a", quote: "again" }),
    ];

    expect(findingIdsForSource(citations, "src_a")).toStrictEqual(["fnd_cost"]);
  });
});

describe("sourceLabel", () => {
  it("prefers the title", () => {
    expect(sourceLabel(sourceFixture())).toBe("Battery pack prices fall again");
  });

  it("falls back to the URL when the source has no title", () => {
    // Not to the domain, and not to a placeholder: the URL is what a reader would
    // otherwise have to reconstruct from the link.
    expect(sourceLabel(sourceFixture({ title: undefined }))).toBe(
      "https://www.bloomberg.com/news/battery-cost-survey",
    );
  });
});

describe("formatRetrievedAt", () => {
  it("labels the time as retrieval time, never as publication", () => {
    // §10 asks to show a publication date "where available". It is not available
    // — no retrieval provider returns one and inventing one is what §4 forbids —
    // so the nearest true fact is labelled for what it is.
    const formatted = formatRetrievedAt("2026-01-01T00:00:00.000Z");

    expect(formatted).toContain("Retrieved ");
    expect(formatted).not.toContain("Published");
  });

  it("shows nothing when the source carries no retrieval time", () => {
    expect(formatRetrievedAt(undefined)).toBeUndefined();
  });

  it("shows nothing rather than 'Invalid Date' for an unparseable value", () => {
    expect(formatRetrievedAt("not a date")).toBeUndefined();
  });
});

describe("formatGeneratedAt", () => {
  it("renders a timestamp in the reader's locale", () => {
    // Midday mid-year, so the assertion holds whatever the reader's timezone is
    // — an instant near midnight on new year's eve is a different date either
    // side of UTC, and a test that pinned one would be testing the machine.
    const formatted = formatGeneratedAt("2026-06-15T12:00:00.000Z");

    expect(formatted).toContain("2026");
    expect(formatted).not.toBe("2026-06-15T12:00:00.000Z");
  });

  it("falls back to the raw value rather than to 'Invalid Date'", () => {
    expect(formatGeneratedAt("not a date")).toBe("not a date");
  });
});
