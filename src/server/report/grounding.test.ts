import { describe, expect, it } from "vitest";

import { buildDeterministicReport } from "./deterministic";
import {
  collectGroundedNumbers,
  findUngroundedSentences,
  resolveFindingIndices,
  verifyReportInvariants,
} from "./grounding";
import {
  CONFLICT_ID,
  FINDING_COST_ID,
  FINDING_INFERENCE_ID,
  QUESTION,
  researchRecordFixture,
  researchResultFixture,
  SOURCE_BLOOMBERG_ID,
  SOURCE_COMMENTARY_ID,
  UNRESOLVED_QUESTION,
} from "./fixtures";

/**
 * §4's honesty arithmetic, tested as arithmetic.
 *
 * The claim these tests exist to support is narrow and total: a figure in a
 * report that no source supports is *caught*, and a citation that names
 * something the research did not retrieve cannot be constructed. Neither is a
 * property of the prompt, and neither can be checked by reading the generator —
 * so they are checked here, directly, on the two functions that implement them.
 */

const BRIEF =
  "Grid-scale battery pack costs fell by about 40% between 2019 and 2024. " +
  "Installed grid-scale storage capacity reached 90 GW worldwide in 2025.";

describe("collectGroundedNumbers", () => {
  it("collects every number in the text it was given", () => {
    const grounded = collectGroundedNumbers(BRIEF);

    expect(grounded.has("40")).toBe(true);
    expect(grounded.has("2019")).toBe(true);
    expect(grounded.has("2024")).toBe(true);
    expect(grounded.has("90")).toBe(true);
    expect(grounded.has("2025")).toBe(true);
  });

  it("treats a thousands separator as the same number without one", () => {
    const grounded = collectGroundedNumbers("Capacity reached 1,200 GW.");

    expect(grounded.has("1200")).toBe(true);
    // And the separator's absence does not hide the number either.
    const other = collectGroundedNumbers("Capacity reached 1200 GW.");
    expect(other.has("1200")).toBe(true);
  });

  it("treats a proportion below one as the percentage it equals", () => {
    const grounded = collectGroundedNumbers("The share rose to 0.47.");

    expect(grounded.has("0.47")).toBe(true);
    expect(grounded.has("47")).toBe(true);
  });

  it("always permits zero and one, which are ordinary English", () => {
    const grounded = collectGroundedNumbers("No figures here at all.");

    expect(grounded.has("0")).toBe(true);
    expect(grounded.has("1")).toBe(true);
  });

  it("reads only the text it was given, not a wider corpus", () => {
    // The design decision this pins down: grounding on the whole retrieved
    // corpus would let a fabricated figure pass whenever it happened to appear
    // in a page the model was never shown.
    const grounded = collectGroundedNumbers("Costs fell by about 40%.");

    expect(grounded.has("47")).toBe(false);
  });
});

describe("findUngroundedSentences", () => {
  it("passes a sentence whose figures are all in the brief", () => {
    const grounded = collectGroundedNumbers(BRIEF);

    expect(
      findUngroundedSentences(
        "Costs fell by about 40% between 2019 and 2024.",
        grounded,
      ),
    ).toStrictEqual([]);
  });

  it("flags a sentence carrying a figure that is in none of them", () => {
    const grounded = collectGroundedNumbers(BRIEF);

    expect(
      findUngroundedSentences("The market grew 47% over the same period.", grounded),
    ).toStrictEqual(["The market grew 47% over the same period."]);
  });

  it("flags only the offending sentence, not the whole block", () => {
    const grounded = collectGroundedNumbers(BRIEF);

    const flagged = findUngroundedSentences(
      "Costs fell by about 40% between 2019 and 2024. The market grew 47% over the same period. Capacity reached 90 GW in 2025.",
      grounded,
    );

    expect(flagged).toStrictEqual(["The market grew 47% over the same period."]);
  });

  it("does not flag a sentence with no figures in it", () => {
    const grounded = collectGroundedNumbers(BRIEF);

    expect(
      findUngroundedSentences("The sources disagree about the cause.", grounded),
    ).toStrictEqual([]);
  });

  it("does not flag a small number used as ordinary English", () => {
    const grounded = collectGroundedNumbers(BRIEF);

    expect(
      findUngroundedSentences("One source contradicts the other.", grounded),
    ).toStrictEqual([]);
  });

  it("flags a small number when it is stated as a quantity", () => {
    // The deliberate narrowness of the exemption. A fabricated statistic is very
    // often a small one, and a check that let every small integer through would
    // catch only conspicuous fabrications.
    const grounded = collectGroundedNumbers(BRIEF);

    expect(findUngroundedSentences("Only 12 plants were built.", grounded)).toStrictEqual([
      "Only 12 plants were built.",
    ]);
  });
});

describe("resolveFindingIndices", () => {
  const { findings } = researchResultFixture();

  it("resolves an index to the finding behind it", () => {
    const resolved = resolveFindingIndices([0, 2], findings);

    expect(resolved.findings.map((finding) => finding.id)).toStrictEqual([
      FINDING_COST_ID,
      FINDING_INFERENCE_ID,
    ]);
    expect(resolved.droppedCount).toBe(0);
  });

  it("drops an index with nothing behind it and counts it", () => {
    const resolved = resolveFindingIndices([0, 99], findings);

    expect(resolved.findings.map((finding) => finding.id)).toStrictEqual([
      FINDING_COST_ID,
    ]);
    expect(resolved.droppedCount).toBe(1);
  });

  it("collapses a finding cited twice", () => {
    const resolved = resolveFindingIndices([0, 0], findings);

    expect(resolved.findings).toHaveLength(1);
    expect(resolved.droppedCount).toBe(0);
  });

  it("resolves nothing when the model cited nothing", () => {
    expect(resolveFindingIndices([], findings)).toStrictEqual({
      findings: [],
      droppedCount: 0,
    });
  });
});

describe("verifyReportInvariants", () => {
  it("passes a report built from the record it was built from", () => {
    const record = researchRecordFixture();
    const result = researchResultFixture();

    // The strongest single assertion in this file: whatever the generator does
    // to a document, the document still describes the research it came from.
    expect(verifyReportInvariants(buildDeterministicReport({ record, result }), result)).toStrictEqual(
      [],
    );
  });

  it("catches an objective that is not the question that was asked", () => {
    const record = researchRecordFixture();
    const result = researchResultFixture();
    const report = buildDeterministicReport({ record, result });

    const violations = verifyReportInvariants(
      { ...report, objective: "A question nobody asked." },
      result,
    );

    expect(violations).toContain(
      "The report's objective is not the question the research run asked.",
    );
  });

  it("catches a citation naming a source that was not retrieved", () => {
    const record = researchRecordFixture();
    const result = researchResultFixture();
    const report = buildDeterministicReport({ record, result });

    const violations = verifyReportInvariants(
      {
        ...report,
        citations: [
          ...report.citations,
          {
            findingId: FINDING_COST_ID,
            statement: "A claim resting on nothing that was retrieved.",
            basis: "source",
            sourceId: "src_invented",
            url: "https://invented.example/x",
          },
        ],
      },
      result,
    );

    expect(violations).toContain(
      'A citation names source "src_invented", which was not retrieved.',
    );
  });

  it("catches a citation whose URL is not the URL of the source it names", () => {
    const record = researchRecordFixture();
    const result = researchResultFixture();
    const report = buildDeterministicReport({ record, result });

    const violations = verifyReportInvariants(
      {
        ...report,
        citations: report.citations.map((citation) =>
          citation.sourceId === SOURCE_BLOOMBERG_ID
            ? { ...citation, url: "https://www.bloomberg.com/news/other-article" }
            : citation,
        ),
      },
      result,
    );

    expect(violations).toContain(
      `A citation's URL does not match the source "${SOURCE_BLOOMBERG_ID}" it names.`,
    );
  });

  it("catches a dropped conflict", () => {
    const record = researchRecordFixture();
    const result = researchResultFixture();
    const report = buildDeterministicReport({ record, result });

    const violations = verifyReportInvariants({ ...report, conflicts: [] }, result);

    expect(violations).toContain(
      "The report carries 0 conflict(s) where the research recorded 1.",
    );
  });

  it("catches a dropped unresolved question", () => {
    const record = researchRecordFixture();
    const result = researchResultFixture();
    const report = buildDeterministicReport({ record, result });

    const violations = verifyReportInvariants(
      { ...report, unresolvedQuestions: [] },
      result,
    );

    expect(violations).toContain(
      "The report carries 0 unresolved question(s) where the research recorded 1.",
    );
  });

  it("catches a source that was retrieved and left out of the report", () => {
    const record = researchRecordFixture();
    const result = researchResultFixture();
    const report = buildDeterministicReport({ record, result });

    const violations = verifyReportInvariants(
      {
        ...report,
        sources: report.sources.filter((source) => source.id !== SOURCE_COMMENTARY_ID),
      },
      result,
    );

    expect(violations).toContain(
      `The report omits source "${SOURCE_COMMENTARY_ID}", which the research retrieved.`,
    );
  });

  it("catches a report with no title and no sections", () => {
    const record = researchRecordFixture();
    const result = researchResultFixture();
    const report = buildDeterministicReport({ record, result });

    expect(
      verifyReportInvariants({ ...report, title: "  ", sections: [] }, result),
    ).toStrictEqual([
      "The report has no title.",
      "The report has no sections.",
    ]);
  });

  it("counts the conflict the fixture recorded, not a number of its own", () => {
    const record = researchRecordFixture();
    const result = researchResultFixture();

    expect(
      buildDeterministicReport({ record, result }).conflicts.map((c) => c.id),
    ).toStrictEqual([CONFLICT_ID]);
  });

  it("carries the question verbatim, which is what makes the check possible", () => {
    const record = researchRecordFixture();
    const result = researchResultFixture();

    expect(buildDeterministicReport({ record, result }).objective).toBe(QUESTION);
    expect(
      buildDeterministicReport({ record, result }).unresolvedQuestions,
    ).toStrictEqual([UNRESOLVED_QUESTION]);
  });
});
