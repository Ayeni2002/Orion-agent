import { describe, expect, it } from "vitest";

import type { ReportSection, ReportSectionKind } from "@/types/report";

import {
  MAX_DERIVED_NEXT_STEPS,
  MAX_REPORT_TITLE_LENGTH,
  buildCitations,
  buildDeterministicReport,
  buildNextSteps,
  buildServerSections,
  deriveTitle,
  toReportSources,
} from "./deterministic";
import {
  FINDING_COST_ID,
  FINDING_INFERENCE_ID,
  QUESTION,
  SOURCE_BLOOMBERG_ID,
  SOURCE_COMMENTARY_ID,
  SOURCE_IEA_ID,
  UNRESOLVED_QUESTION,
  researchRecordFixture,
  researchResultFixture,
} from "./fixtures";

/**
 * The builder that needs no model, which is also half of every report.
 *
 * §15 asks for a deterministic fallback and §4 asks for every statement to be
 * traceable; this file is where the two meet, so the tests are about *what the
 * builder is allowed to produce* rather than about output formatting:
 *
 *   - it copies what the record holds, verbatim, and composes nothing;
 *   - it omits the two conditional sections when there is nothing for them (§3);
 *   - it derives a title only by trimming, never by rewriting;
 *   - it never invents a source, a quote, a date or a figure.
 */

function kinds(sections: readonly ReportSection[]): ReportSectionKind[] {
  return sections.map((section) => section.kind);
}

describe("deriveTitle", () => {
  it("uses a short question as it stands", () => {
    expect(deriveTitle("What did storage cost?")).toBe("What did storage cost?");
  });

  it("collapses whitespace before deciding", () => {
    expect(deriveTitle("  What   did\nstorage cost?  ")).toBe(
      "What did storage cost?",
    );
  });

  it("cuts a long question at a word boundary and marks the cut", () => {
    const title = deriveTitle(`${"word ".repeat(40)}end`);

    expect(title.length).toBeLessThanOrEqual(MAX_REPORT_TITLE_LENGTH);
    expect(title.endsWith("…")).toBe(true);
    // A word boundary, not a slice: the character before the marker is never a
    // fragment of a word.
    expect(title.slice(0, -1).endsWith("word")).toBe(true);
  });

  it("falls back to a plain noun phrase for an empty question", () => {
    expect(deriveTitle("   ")).toBe("Research report");
  });

  it("does not rewrite the question's words", () => {
    const question = "how many GW were installed in 2025?";

    expect(deriveTitle(question)).toBe(question);
  });
});

describe("toReportSources", () => {
  it("drops the retrieved body text and keeps everything else", () => {
    const sources = toReportSources(researchResultFixture().sources);
    const bloomberg = sources.find((source) => source.id === SOURCE_BLOOMBERG_ID);

    expect(bloomberg).toBeDefined();
    expect("content" in (bloomberg ?? {})).toBe(false);
    expect(bloomberg?.url).toBe(
      "https://www.bloomberg.com/news/battery-cost-survey",
    );
    expect(bloomberg?.domain).toBe("bloomberg.com");
    expect(bloomberg?.title).toBe("Battery pack prices fall again");
  });
});

describe("buildCitations", () => {
  it("emits one branch per finding-and-source pair", () => {
    const citations = buildCitations(researchResultFixture());

    // Two source-backed findings with one source each, and one inferred finding
    // with no source at all.
    expect(citations).toHaveLength(3);
  });

  it("carries the finding's own statement rather than a rewrite", () => {
    const citations = buildCitations(researchResultFixture());
    const cost = citations.find((citation) => citation.findingId === FINDING_COST_ID);

    expect(cost?.statement).toBe(
      "Grid-scale battery pack costs fell by about 40% between 2019 and 2024.",
    );
    expect(cost?.url).toBe("https://www.bloomberg.com/news/battery-cost-survey");
    expect(cost?.domain).toBe("bloomberg.com");
  });

  it("takes the quote from the verified evidence, not from the source's text", () => {
    const citations = buildCitations(researchResultFixture());
    const cost = citations.find((citation) => citation.findingId === FINDING_COST_ID);

    // The evidence quote, which Phase 5 verified — not the source's fuller
    // `content`, from which a quote could have been composed.
    expect(cost?.quote).toBe("costs fell by about 40% between 2019 and 2024");
  });

  it("gives an inferred finding one branch, with no source and no quote", () => {
    const citations = buildCitations(researchResultFixture());
    const inferred = citations.filter(
      (citation) => citation.findingId === FINDING_INFERENCE_ID,
    );

    expect(inferred).toHaveLength(1);
    expect(inferred[0]?.basis).toBe("model");
    expect(inferred[0]?.sourceId).toBeUndefined();
    expect(inferred[0]?.url).toBeUndefined();
    expect(inferred[0]?.quote).toBeUndefined();
  });

  it("emits nothing for a result with no findings", () => {
    expect(buildCitations(researchResultFixture({ findings: [] }))).toStrictEqual([]);
  });

  it("does not emit a branch for a source that supports no finding", () => {
    const citations = buildCitations(researchResultFixture());

    expect(
      citations.some((citation) => citation.sourceId === SOURCE_COMMENTARY_ID),
    ).toBe(false);
  });
});

describe("buildNextSteps", () => {
  it("restates an unresolved question behind a label, without reframing it", () => {
    const steps = buildNextSteps(researchResultFixture());

    expect(steps[0]).toBe(
      "The run did not establish: whether the cost decline continues through 2027.",
    );
  });

  it("keeps a gap's meaning when the gap is a full sentence", () => {
    // The regression this pins down: prefixing "Establish whether" onto a gap
    // that is already a statement produced the opposite of what was recorded.
    const steps = buildNextSteps(
      researchResultFixture({
        unresolvedQuestions: ["The sources do not state the 2024 price."],
        limitsReached: [],
      }),
    );

    expect(steps).toStrictEqual([
      "The run did not establish: the sources do not state the 2024 price.",
    ]);
  });

  it("leaves an acronym's capital letters alone", () => {
    const steps = buildNextSteps(
      researchResultFixture({
        unresolvedQuestions: ["GDP growth for the year."],
        limitsReached: [],
      }),
    );

    expect(steps).toStrictEqual(["The run did not establish: GDP growth for the year."]);
  });

  it("names a limit in words rather than as an enum member", () => {
    const steps = buildNextSteps(
      researchResultFixture({ unresolvedQuestions: [], limitsReached: ["max_duration"] }),
    );

    expect(steps[0]).toContain("time limit");
    expect(steps[0]).not.toContain("max_duration");
  });

  it("proposes no course of action, only what is missing", () => {
    const steps = buildNextSteps(researchResultFixture());

    expect(steps.every((step) => step.startsWith("The run did not establish:") || step.includes("This run was limited"))).toBe(
      true,
    );
  });

  it("stays inside its cap when the record holds more than that", () => {
    const steps = buildNextSteps(
      researchResultFixture({
        unresolvedQuestions: Array.from(
          { length: MAX_DERIVED_NEXT_STEPS + 5 },
          (_, index) => `Question number ${index}.`,
        ),
      }),
    );

    expect(steps).toHaveLength(MAX_DERIVED_NEXT_STEPS);
  });
});

describe("buildServerSections", () => {
  it("builds every section the record has material for, in document order", () => {
    expect(kinds(buildServerSections({ result: researchResultFixture() }))).toStrictEqual([
      "objective",
      "summary",
      "findings",
      "sources",
      "conflicts",
      "unresolved",
      "next_steps",
    ]);
  });

  it("omits the conflicts section when nothing conflicted (§3)", () => {
    const sections = buildServerSections({
      result: researchResultFixture({ conflicts: [] }),
    });

    expect(kinds(sections)).not.toContain("conflicts");
  });

  it("omits the unresolved section when nothing was left open", () => {
    const sections = buildServerSections({
      result: researchResultFixture({
        unresolvedQuestions: [],
        limitsReached: [],
        errors: [],
      }),
    });

    expect(kinds(sections)).not.toContain("unresolved");
  });

  it("keeps the unresolved section when only a limit was reached", () => {
    // "We did not establish this" and "we stopped before we could" are the same
    // thing to a reader, so a limit alone is enough to warrant the section.
    const sections = buildServerSections({
      result: researchResultFixture({
        unresolvedQuestions: [],
        limitsReached: ["max_findings"],
      }),
    });

    expect(kinds(sections)).toContain("unresolved");
  });

  it("keeps the sources section for a run that read pages and concluded nothing", () => {
    const sections = buildServerSections({
      result: researchResultFixture({
        findings: [],
        conflicts: [],
        unresolvedQuestions: [],
        limitsReached: [],
        summary: undefined,
      }),
    });

    expect(kinds(sections)).toStrictEqual(["objective", "sources"]);
  });

  it("marks the objective section from the research and the model's kinds apart", () => {
    const sections = buildServerSections({ result: researchResultFixture() });

    expect(sections.every((section) => section.origin === "research")).toBe(true);
  });

  it("skips the summary and next steps when the caller supplies them", () => {
    const sections = buildServerSections({
      result: researchResultFixture(),
      skip: ["summary", "next_steps"],
    });

    expect(kinds(sections)).not.toContain("summary");
    expect(kinds(sections)).not.toContain("next_steps");
    // And nothing else is affected.
    expect(kinds(sections)).toContain("findings");
  });

  it("carries the planner's restatement only when it was given", () => {
    const without = buildServerSections({ result: researchResultFixture() });
    const with_ = buildServerSections({
      result: researchResultFixture(),
      restatement: "Establish the 2024 cost.",
    });

    expect(without[0]?.body).toBeUndefined();
    expect(with_[0]?.body).toBe("Establish the 2024 cost.");
  });

  it("gives the findings section every finding, and no body", () => {
    const sections = buildServerSections({ result: researchResultFixture() });
    const findings = sections.find((section) => section.kind === "findings");

    expect(findings?.findingIds).toHaveLength(3);
    // The material is the citations, not prose — a body here would invite a
    // renderer to print a second, prose version of facts already below it.
    expect(findings?.body).toBeUndefined();
  });

  it("gives the next-steps section its items as a list", () => {
    const sections = buildServerSections({ result: researchResultFixture() });
    const nextSteps = sections.find((section) => section.kind === "next_steps");

    expect(nextSteps?.items).toHaveLength(2);
    expect(nextSteps?.body).toBeUndefined();
  });
});

describe("buildDeterministicReport", () => {
  it("reports on the record it was given", () => {
    const report = buildDeterministicReport({
      record: researchRecordFixture(),
      result: researchResultFixture(),
    });

    expect(report.objective).toBe(QUESTION);
    expect(report.status).toBe("completed");
    expect(report.errors).toStrictEqual([]);
    expect(report.metadata.generation.mode).toBe("deterministic");
  });

  it("carries the reason it fell back, when it fell back", () => {
    const withReason = buildDeterministicReport({
      record: researchRecordFixture(),
      result: researchResultFixture(),
      reason: "No model provider is configured.",
    });

    const withoutReason = buildDeterministicReport({
      record: researchRecordFixture(),
      result: researchResultFixture(),
    });

    expect(withReason.metadata.generation.reason).toBe(
      "No model provider is configured.",
    );
    expect(withoutReason.metadata.generation.reason).toBeUndefined();
  });

  it("records zero corrections, because it corrected nothing", () => {
    const report = buildDeterministicReport({
      record: researchRecordFixture(),
      result: researchResultFixture(),
    });

    expect(report.metadata.generation).toStrictEqual({
      mode: "deterministic",
      droppedCitationCount: 0,
      ungroundedNumberCount: 0,
      truncatedSectionCount: 0,
    });
  });

  it("preserves the conflicts and unresolved questions verbatim", () => {
    const result = researchResultFixture();
    const report = buildDeterministicReport({
      record: researchRecordFixture(),
      result,
    });

    expect(report.conflicts).toStrictEqual(result.conflicts);
    expect(report.unresolvedQuestions).toStrictEqual([UNRESOLVED_QUESTION]);
    expect(report.limitsReached).toStrictEqual(result.limitsReached);
  });

  it("carries every source the run retrieved, cited or not", () => {
    const report = buildDeterministicReport({
      record: researchRecordFixture(),
      result: researchResultFixture(),
    });

    expect(report.sources.map((source) => source.id)).toStrictEqual([
      SOURCE_BLOOMBERG_ID,
      SOURCE_IEA_ID,
      SOURCE_COMMENTARY_ID,
    ]);
  });

  it("keeps the question as the title when the question is short enough", () => {
    const report = buildDeterministicReport({
      record: researchRecordFixture({ question: "What did storage cost?" }),
      result: researchResultFixture({ question: "What did storage cost?" }),
    });

    expect(report.title).toBe("What did storage cost?");
  });

  it("names no model provider, because none wrote it", () => {
    const report = buildDeterministicReport({
      record: researchRecordFixture(),
      result: researchResultFixture(),
    });

    expect(report.metadata.modelProvider).toBeUndefined();
    expect(report.metadata.researchProvider.id).toBe("stub");
  });

  it("carries the execution id when the run had one", () => {
    const report = buildDeterministicReport({
      record: researchRecordFixture(),
      result: researchResultFixture(),
    });

    expect(report.executionId).toBe("exec_fixture");
  });

  it("omits the execution id when the run had none", () => {
    const { executionId: _executionId, ...result } = researchResultFixture();

    const report = buildDeterministicReport({
      record: researchRecordFixture(),
      result,
    });

    expect("executionId" in report).toBe(false);
  });

  it("builds a report for a run that found nothing at all", () => {
    const result = researchResultFixture({
      findings: [],
      evidence: [],
      sources: [],
      conflicts: [],
      unresolvedQuestions: [],
      limitsReached: [],
      summary: undefined,
      sufficiency: "insufficient",
    });

    const report = buildDeterministicReport({
      record: researchRecordFixture({
        findings: [],
        evidence: [],
        sources: [],
        conflicts: [],
      }),
      result,
    });

    expect(report.citations).toStrictEqual([]);
    expect(report.sources).toStrictEqual([]);
    expect(kinds(report.sections)).toStrictEqual(["objective"]);
  });
});
