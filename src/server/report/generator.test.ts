import { describe, expect, it } from "vitest";

import {
  ModelProviderError,
  type ModelProvider,
  type ModelOperation,
  type ModelProviderRequest,
} from "@/server/agent";
import {
  createStubModelProvider,
  type StubResponse,
} from "@/server/agent/provider/stub-provider";

import { buildDeterministicReport } from "./deterministic";
import {
  FINDING_COST_ID,
  RESEARCH_ID,
  SOURCE_COMMENTARY_ID,
  SOURCE_IEA_ID,
  SOURCES,
  researchRecordFixture,
  researchResultFixture,
} from "./fixtures";
import { verifyReportInvariants } from "./grounding";
import { REPORT_INSTRUCTION, buildFindingBrief, generateReport } from "./generator";
import { MAX_NEXT_STEPS, MAX_REPORT_SECTIONS } from "./schema";

/**
 * The model path, and the four ways it is allowed to fail.
 *
 * Every test here drives the real generator against a scripted provider. The
 * provider is the project's own `createStubModelProvider` rather than an inline
 * mock, because the thing under test is what the generator *does* with a
 * response — checking it against the research, keeping the parts that survive and
 * discarding the parts that do not — and a hand-written mock of `generate` would
 * test the mock.
 *
 * **The scripted provider reports `isExternal: false` by default**, so every test
 * that intends to reach the model path passes `{ isExternal: true }` explicitly.
 * The generator refuses to ask a non-external provider for prose at all, which is
 * the behaviour one test below pins down; the rest would silently be testing the
 * deterministic builder if the descriptor were left at its default.
 *
 * **No test contacts anything.** The scripted provider never calls out, and the
 * suite must pass with no API key present — that is the rule
 * `docs/DEVELOPMENT_PHASES.md` sets for the gates.
 */

/**
 * Prose whose figures all appear in the brief.
 *
 * Every number here — 40, 2019, 2024, 90, 2025, 2027 — is in the finding
 * statements the brief is built from, which is what makes these bodies pass the
 * grounding check rather than trip it.
 */
const GOOD_SUMMARY =
  "Grid-scale pack costs fell by about 40% between 2019 and 2024, and installed capacity reached 90 GW in 2025.";
const GOOD_ANALYSIS =
  "Grid-scale pack costs fell by about 40% between 2019 and 2024, according to the survey.";
const GOOD_STEP = "Establish whether the decline continues through 2027.";

/** A response that satisfies every rule, as the base for the mutations below. */
/**
 * A response that should survive every check.
 *
 * Typed as the object half of `StubResponse` rather than as `StubResponse`
 * itself, because one case below spreads this to change a single section, and
 * the union's other member is a bare string — which cannot be spread. The
 * response a model actually returns is untrusted JSON, so an open object is
 * also the more honest type here.
 */
function validResponse(): Record<string, unknown> {
  return {
    summary: { body: GOOD_SUMMARY, findingIndices: [0] },
    sections: [
      { heading: "The cost decline", body: GOOD_ANALYSIS, findingIndices: [0] },
    ],
    nextSteps: [{ body: GOOD_STEP, findingIndices: [2] }],
  };
}

/**
 * A scripted provider, with its call counter handed back.
 *
 * `isExternal` is a parameter rather than an option because it is the whole
 * distinction between the two paths through `generateReport`, and a test that
 * had to remember to spell it out in a descriptor literal would be a test that
 * could forget to.
 */
function scripted(response: StubResponse, isExternal: boolean) {
  const calls: Record<ModelOperation, number> = {
    plan: 0,
    execute_step: 0,
    evaluate: 0,
    research_plan: 0,
    research_findings: 0,
    report: 0,
  };

  const provider = createStubModelProvider({
    script: { report: () => response },
    descriptor: { isExternal },
    calls,
  });

  return { provider, calls };
}

/** The same provider, wrapped so a test can read the request it was sent. */
function recording(provider: ModelProvider) {
  const requests: ModelProviderRequest[] = [];

  return {
    requests,
    provider: {
      descriptor: provider.descriptor,
      generate: (request: ModelProviderRequest) => {
        requests.push(request);
        return provider.generate(request);
      },
    } satisfies ModelProvider,
  };
}

function kinds(report: { sections: readonly { kind: string }[] }): string[] {
  return report.sections.map((section) => section.kind);
}

describe("buildFindingBrief", () => {
  const result = researchResultFixture();

  it("numbers the findings from zero, which is the model's only vocabulary", () => {
    const brief = buildFindingBrief(result);

    expect(brief).toContain("[0] Grid-scale battery pack costs fell by about 40%");
    expect(brief).toContain(
      "[1] Installed grid-scale storage capacity reached 90 GW worldwide in 2025.",
    );
    expect(brief).toContain("[2] Cost declines are likely to continue through 2027.");
  });

  it("says which findings the extractor could not tie to retrieved text", () => {
    const brief = buildFindingBrief(result);

    expect(brief).toContain("(inferred: the extractor could not tie this to retrieved text)");
    // And the sourced ones name where they came from.
    expect(brief).toContain("Battery pack prices fall again — bloomberg.com");
  });

  it("falls back to the domain for a source that has no title", () => {
    const brief = buildFindingBrief(
      researchResultFixture({
        findings: [
          {
            id: FINDING_COST_ID,
            statement:
              "Grid-scale battery pack costs fell by about 40% between 2019 and 2024.",
            taskId: "rtk_one",
            basis: "source",
            sourceIds: [SOURCE_COMMENTARY_ID],
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );

    expect(brief).toContain("(from: example.org)");
  });

  it("states the counts, so the model knows what it is not being shown", () => {
    const brief = buildFindingBrief(result);

    expect(brief).toContain(
      "The run retrieved 3 source(s), recorded 1 conflict(s), and left 1 question(s) it could not establish.",
    );
  });

  it("lists the questions the run did not establish", () => {
    expect(buildFindingBrief(result)).toContain(
      "- Whether the cost decline continues through 2027.",
    );
  });

  it("omits the list entirely when nothing was left open", () => {
    const brief = buildFindingBrief(
      researchResultFixture({ unresolvedQuestions: [] }),
    );

    expect(brief).not.toContain("Questions the run did not establish:");
  });

  it("does not include a source's retrieved body text", () => {
    // The narrowness that makes the number check meaningful: grounding a figure
    // on the whole retrieved corpus would pass a fabricated statistic whenever it
    // happened to appear on a page the model was never shown.
    const brief = buildFindingBrief(result);

    expect(brief).not.toContain("according to the survey");
    expect(brief).not.toContain(SOURCES[0]!.content ?? "");
  });
});

describe("generateReport", () => {
  describe("when no prose is wanted or possible", () => {
    it("builds a deterministic report when the caller asked for one", async () => {
      const { provider, calls } = scripted(validResponse(), true);

      const report = await generateReport({
        record: researchRecordFixture(),
        result: researchResultFixture(),
        provider,
        useModel: false,
      });

      expect(report.metadata.generation.mode).toBe("deterministic");
      expect(report.metadata.generation.reason).toBe(
        "The report was requested without model-written prose.",
      );
      // The provider was available and was not asked. §22 in one assertion: a
      // report that needs no model does not call one.
      expect(calls.report).toBe(0);
    });

    it("builds a deterministic report when no provider is configured", async () => {
      const report = await generateReport({
        record: researchRecordFixture(),
        result: researchResultFixture(),
      });

      expect(report.metadata.generation.mode).toBe("deterministic");
      expect(report.metadata.generation.reason).toContain(
        "No model provider is configured",
      );
      // §5: the report exists, is complete, and says plainly that no model wrote
      // it. There is no state in which "no key" means "no report".
      expect(report.sections.length).toBeGreaterThan(0);
      expect(report.citations.length).toBeGreaterThan(0);
    });

    it("refuses to ask a deterministic stand-in for prose", async () => {
      // The development adapter says of itself that it "must never be presented
      // to a user as if a model produced it". A report is where that would matter
      // most, so the refusal is structural rather than a matter of the adapter
      // behaving well.
      const { provider, calls } = scripted(validResponse(), false);

      const report = await generateReport({
        record: researchRecordFixture(),
        result: researchResultFixture(),
        provider,
      });

      expect(calls.report).toBe(0);
      expect(report.metadata.generation.mode).toBe("deterministic");
      expect(report.metadata.generation.reason).toContain(
        "Scripted test provider",
      );
      expect(report.metadata.modelProvider).toBeUndefined();
    });
  });

  describe("when the model's prose survives checking", () => {
    it("uses it, and says a model wrote it", async () => {
      const { provider, calls } = scripted(validResponse(), true);

      const report = await generateReport({
        record: researchRecordFixture(),
        result: researchResultFixture(),
        provider,
      });

      expect(calls.report).toBe(1);
      expect(report.metadata.generation.mode).toBe("model");
      expect(report.metadata.modelProvider?.id).toBe("stub");
      expect(report.status).toBe("completed");
      expect(report.errors).toStrictEqual([]);
    });

    it("puts the prose where the document's argument puts it", async () => {
      const { provider } = scripted(validResponse(), true);

      const report = await generateReport({
        record: researchRecordFixture(),
        result: researchResultFixture(),
        provider,
      });

      // The order is the argument: what was asked, what was found, what it means,
      // what it rests on, what is disputed, what is missing, what to do next.
      expect(kinds(report)).toStrictEqual([
        "objective",
        "summary",
        "findings",
        "analysis",
        "sources",
        "conflicts",
        "unresolved",
        "next_steps",
      ]);
    });

    it("marks which sections a model wrote and which the record did", async () => {
      const { provider } = scripted(validResponse(), true);

      const report = await generateReport({
        record: researchRecordFixture(),
        result: researchResultFixture(),
        provider,
      });

      const byKind = new Map(report.sections.map((s) => [s.kind, s]));

      expect(byKind.get("summary")?.origin).toBe("model");
      expect(byKind.get("analysis")?.origin).toBe("model");
      expect(byKind.get("next_steps")?.origin).toBe("model");
      expect(byKind.get("findings")?.origin).toBe("research");
      expect(byKind.get("sources")?.origin).toBe("research");
    });

    it("keeps the model's words unaltered", async () => {
      const { provider } = scripted(validResponse(), true);

      const report = await generateReport({
        record: researchRecordFixture(),
        result: researchResultFixture(),
        provider,
      });

      const summary = report.sections.find((section) => section.kind === "summary");

      expect(summary?.body).toBe(GOOD_SUMMARY);
      expect(summary?.heading).toBe("Executive summary");
    });

    it("carries the model's next steps as a list rather than as prose", async () => {
      const { provider } = scripted(validResponse(), true);

      const report = await generateReport({
        record: researchRecordFixture(),
        result: researchResultFixture(),
        provider,
      });

      const steps = report.sections.find((section) => section.kind === "next_steps");

      expect(steps?.items).toStrictEqual([GOOD_STEP]);
      // And the derived list is not printed alongside it — one section of a kind,
      // not two.
      expect(kinds(report).filter((kind) => kind === "next_steps")).toHaveLength(1);
    });

    it("ties each prose section to the findings it named", async () => {
      const { provider } = scripted(validResponse(), true);

      const report = await generateReport({
        record: researchRecordFixture(),
        result: researchResultFixture(),
        provider,
      });

      const summary = report.sections.find((section) => section.kind === "summary");

      // §4 at section granularity: "where did Orion get this?" is answerable for
      // a paragraph, not only for a finding.
      expect(summary?.findingIds).toStrictEqual(["fnd_cost"]);
    });

    it("produces a report that still describes the research it came from", async () => {
      const result = researchResultFixture();
      const { provider } = scripted(validResponse(), true);

      const report = await generateReport({
        record: researchRecordFixture(),
        result,
        provider,
      });

      // §14's checks, applied to a model-written document rather than to a
      // deterministic one. The generator is allowed to add prose; it is not
      // allowed to change what the report is about.
      expect(verifyReportInvariants(report, result)).toStrictEqual([]);
    });
  });

  describe("the chain is the server's, and the model has no syntax for it", () => {
    it("builds the same citations a deterministic report would", async () => {
      const record = researchRecordFixture();
      const result = researchResultFixture();
      const { provider } = scripted(validResponse(), true);

      const model = await generateReport({ record, result, provider });
      const plain = buildDeterministicReport({ record, result });

      // Not filtered, not merged — equal. A model names findings by index, and
      // only the record can say which passage supports one at which URL.
      expect(model.citations).toStrictEqual(plain.citations);
      expect(model.sources).toStrictEqual(plain.sources);
    });

    it("does not turn a URL the model wrote into a citation", async () => {
      const result = researchResultFixture();
      const record = researchRecordFixture();
      const { provider } = scripted(
        {
          ...validResponse(),
          sections: [
            {
              heading: "The cost decline",
              body: "Costs fell by about 40% between 2019 and 2024, per https://invented.example/study.",
              findingIndices: [0],
            },
          ],
        },
        true,
      );

      const report = await generateReport({ record, result, provider });
      const evidenceUrls = [
        ...report.citations.map((citation) => citation.url ?? ""),
        ...report.sources.map((source) => source.url),
      ];
      const prose = report.sections
        .map((section) => section.body ?? "")
        .join("\n");

      // Two claims, and they need two assertions: the prose keeps the text — the
      // renderer emits it as a text node, never as an anchor — while nothing in
      // the report's evidence chain points at it. `toContain` on the combined
      // array would have compared whole section bodies for equality and passed
      // for the wrong reason.
      expect(prose).toContain("https://invented.example/study");
      expect(evidenceUrls).not.toContain("https://invented.example/study");
    });

    it("does not let prose displace an evidence-bearing section", async () => {
      const { provider } = scripted(
        {
          summary: { body: GOOD_SUMMARY, findingIndices: [0] },
          sections: [
            { heading: "Key findings", body: GOOD_ANALYSIS, findingIndices: [0] },
            { heading: "Sources and evidence", body: GOOD_ANALYSIS, findingIndices: [1] },
          ],
        },
        true,
      );

      const report = await generateReport({
        record: researchRecordFixture(),
        result: researchResultFixture(),
        provider,
      });

      // The model titled its sections after the server's. It got two analysis
      // sections; it did not get the server's sections, and it did not get to
      // put the record's findings behind its own prose.
      expect(kinds(report).filter((kind) => kind === "findings")).toHaveLength(1);
      expect(kinds(report).filter((kind) => kind === "sources")).toHaveLength(1);
      expect(kinds(report).filter((kind) => kind === "analysis")).toHaveLength(2);

      const findings = report.sections.find((section) => section.kind === "findings");

      expect(findings?.origin).toBe("research");
      expect(findings?.body).toBeUndefined();
    });
  });

  describe("when a claim has to be degraded", () => {
    it("drops a citation that resolves to nothing, and counts it", async () => {
      const { provider } = scripted(
        {
          summary: { body: GOOD_SUMMARY, findingIndices: [0] },
          sections: [
            { heading: "The cost decline", body: GOOD_ANALYSIS, findingIndices: [7] },
          ],
        },
        true,
      );

      const report = await generateReport({
        record: researchRecordFixture(),
        result: researchResultFixture(),
        provider,
      });

      // Kept, not rejected: one section cited a finding that does not exist and
      // the report says so rather than discarding the whole document.
      expect(report.metadata.generation.mode).toBe("model");
      expect(report.metadata.generation.droppedCitationCount).toBe(1);

      const analysis = report.sections.find((section) => section.kind === "analysis");

      expect(analysis?.findingIds).toStrictEqual([]);
      expect(analysis?.body).toBe(GOOD_ANALYSIS);
    });

    it("flags a sentence stating a figure nothing supports, and keeps it", async () => {
      const invented = "The market grew 47% over the same period.";
      const { provider } = scripted(
        {
          summary: { body: GOOD_SUMMARY, findingIndices: [0] },
          sections: [
            {
              heading: "The cost decline",
              body: `Costs fell by about 40% between 2019 and 2024. ${invented}`,
              findingIndices: [0],
            },
          ],
        },
        true,
      );

      const report = await generateReport({
        record: researchRecordFixture(),
        result: researchResultFixture(),
        provider,
      });

      const analysis = report.sections.find((section) => section.kind === "analysis");

      expect(report.metadata.generation.mode).toBe("model");
      expect(report.metadata.generation.ungroundedNumberCount).toBe(1);
      // The same disposition `verifyQuote` gives an unverifiable quote: the claim
      // survives, marked, rather than being silently deleted.
      expect(analysis?.ungroundedSentences).toStrictEqual([invented]);
      expect(analysis?.body).toContain(invented);
    });

    it("checks a figure against the brief, not against the retrieved page", async () => {
      // The source's body text says 118 GW in 2018; the finding drawn from it says
      // 90 GW in 2025. The model was shown the finding, so a figure it could only
      // have got from the page is a figure it did not get from anywhere.
      const result = researchResultFixture({
        sources: SOURCES.map((source) =>
          source.id === SOURCE_IEA_ID
            ? { ...source, content: "Installed capacity reached 118 GW in 2018." }
            : source,
        ),
      });
      const invented = "Capacity reached 118 GW in 2018.";
      const { provider } = scripted(
        {
          summary: { body: GOOD_SUMMARY, findingIndices: [0] },
          sections: [
            { heading: "Capacity", body: invented, findingIndices: [1] },
          ],
        },
        true,
      );

      const report = await generateReport({
        record: researchRecordFixture(),
        result,
        provider,
      });

      const analysis = report.sections.find((section) => section.kind === "analysis");

      expect(analysis?.ungroundedSentences).toStrictEqual([invented]);
    });

    it("truncates sections past the cap rather than rejecting the response", async () => {
      const section = {
        heading: "The cost decline",
        body: GOOD_ANALYSIS,
        findingIndices: [0],
      };
      const { provider } = scripted(
        {
          summary: { body: GOOD_SUMMARY, findingIndices: [0] },
          sections: Array.from({ length: MAX_REPORT_SECTIONS + 2 }, () => ({
            ...section,
          })),
        },
        true,
      );

      const report = await generateReport({
        record: researchRecordFixture(),
        result: researchResultFixture(),
        provider,
      });

      expect(report.metadata.generation.mode).toBe("model");
      expect(report.metadata.generation.truncatedSectionCount).toBe(2);
      // Sections are dropped whole, so everything retained is intact.
      expect(
        kinds(report).filter((kind) => kind === "analysis"),
      ).toHaveLength(MAX_REPORT_SECTIONS);
    });

    it("truncates next steps past their cap too", async () => {
      const { provider } = scripted(
        {
          summary: { body: GOOD_SUMMARY, findingIndices: [0] },
          sections: [
            { heading: "The cost decline", body: GOOD_ANALYSIS, findingIndices: [0] },
          ],
          nextSteps: Array.from({ length: MAX_NEXT_STEPS + 2 }, () => ({
            body: GOOD_STEP,
            findingIndices: [2],
          })),
        },
        true,
      );

      const report = await generateReport({
        record: researchRecordFixture(),
        result: researchResultFixture(),
        provider,
      });

      expect(report.metadata.generation.truncatedSectionCount).toBe(2);

      const steps = report.sections.find((section) => section.kind === "next_steps");

      expect(steps?.items).toHaveLength(MAX_NEXT_STEPS);
    });
  });

  describe("when the prose has to be rejected", () => {
    it("falls back when the provider throws a provider error", async () => {
      const provider: ModelProvider = {
        descriptor: {
          id: "stub",
          label: "Scripted test provider",
          model: "stub-model",
          isExternal: true,
        },
        generate: () =>
          Promise.reject(new ModelProviderError("stub", "The endpoint refused.")),
      };

      const report = await generateReport({
        record: researchRecordFixture(),
        result: researchResultFixture(),
        provider,
      });

      expect(report.metadata.generation.mode).toBe("deterministic");
      expect(report.metadata.generation.reason).toContain(
        "The model could not be reached",
      );
      expect(report.metadata.generation.reason).toContain("The endpoint refused.");
    });

    it("does not repeat an unknown error's message into the report", async () => {
      // A report's metadata is rendered to a user. An unexpected error's message
      // could carry anything, including a URL with a key in it.
      const provider: ModelProvider = {
        descriptor: {
          id: "stub",
          label: "Scripted test provider",
          model: "stub-model",
          isExternal: true,
        },
        generate: () =>
          Promise.reject(new Error("failed calling https://api.example/?key=sk-live-1")),
      };

      const report = await generateReport({
        record: researchRecordFixture(),
        result: researchResultFixture(),
        provider,
      });

      expect(report.metadata.generation.reason).toBe(
        "The model call failed, so the report was built from the research record alone.",
      );
      expect(JSON.stringify(report)).not.toContain("sk-live-1");
    });

    it("falls back when the response is not JSON", async () => {
      const { provider } = scripted("I'm afraid I can't do that.", true);

      const report = await generateReport({
        record: researchRecordFixture(),
        result: researchResultFixture(),
        provider,
      });

      expect(report.metadata.generation.mode).toBe("deterministic");
      expect(report.metadata.generation.reason).toContain(
        "The model's response was not usable.",
      );
    });

    it("falls back when the JSON does not match the report structure", async () => {
      const { provider } = scripted(
        { summary: { body: "Too short.", findingIndices: [0] }, sections: [] },
        true,
      );

      const report = await generateReport({
        record: researchRecordFixture(),
        result: researchResultFixture(),
        provider,
      });

      expect(report.metadata.generation.mode).toBe("deterministic");
      expect(report.metadata.generation.reason).toBe(
        "The model's response did not match the required report structure.",
      );
    });

    it("falls back when the prose cites no finding at all", async () => {
      // The rejection that matters most. Prose that names no finding is prose
      // about nothing that was researched, and there is no way to check a word of
      // it — so it is refused rather than marked.
      const { provider } = scripted(
        {
          summary: {
            body: "The research run established nothing that could be cited.",
            findingIndices: [],
          },
          sections: [],
        },
        true,
      );

      const report = await generateReport({
        record: researchRecordFixture(),
        result: researchResultFixture(),
        provider,
      });

      expect(report.metadata.generation.mode).toBe("deterministic");
      expect(report.metadata.generation.reason).toBe(
        "The model's prose named no finding from the research run, so there was nothing to check it against.",
      );
      expect(report.metadata.modelProvider).toBeUndefined();
    });

    it("keeps a whole response whose only fault is an uncited summary", async () => {
      // The boundary of that rejection. One uncited paragraph among cited ones is
      // worth keeping and marking; it is not a model that ignored the contract.
      const { provider } = scripted(
        {
          summary: {
            body: "This paragraph refers to no finding in particular at all.",
            findingIndices: [],
          },
          sections: [
            { heading: "The cost decline", body: GOOD_ANALYSIS, findingIndices: [0] },
          ],
        },
        true,
      );

      const report = await generateReport({
        record: researchRecordFixture(),
        result: researchResultFixture(),
        provider,
      });

      expect(report.metadata.generation.mode).toBe("model");

      const summary = report.sections.find((section) => section.kind === "summary");

      expect(summary?.findingIds).toStrictEqual([]);
    });

    it("falls back for every rejection, and the report is still complete", async () => {
      const cases: StubResponse[] = [
        "not json",
        { summary: { body: "x", findingIndices: [] } },
        { summary: { body: GOOD_SUMMARY, findingIndices: [] }, sections: [] },
      ];

      for (const response of cases) {
        const { provider } = scripted(response, true);

        const report = await generateReport({
          record: researchRecordFixture(),
          result: researchResultFixture(),
          provider,
        });

        expect(report.metadata.generation.mode).toBe("deterministic");
        expect(report.metadata.generation.reason).toBeTruthy();
        expect(report.citations.length).toBeGreaterThan(0);
        expect(report.sections.length).toBeGreaterThan(0);
        expect(report.title.length).toBeGreaterThan(0);
      }
    });
  });

  describe("what the model is asked", () => {
    it("asks the report operation, for JSON, with room for the answer", async () => {
      const { provider } = scripted(validResponse(), true);
      const recorder = recording(provider);

      await generateReport({
        record: researchRecordFixture(),
        result: researchResultFixture(),
        provider: recorder.provider,
      });

      const [request] = recorder.requests;

      expect(request?.operation).toBe("report");
      expect(request?.responseFormat).toBe("json");
      expect(request?.maxOutputTokens).toBe(4_000);
      expect(request?.instruction).toBe(REPORT_INSTRUCTION);
    });

    it("sends the same brief it checks the answer against", async () => {
      // One string, sent and checked — not two renderings of one. A second
      // rendering would be a second thing to keep in step, and the first time the
      // two diverged the check would be measuring something the model never saw.
      const result = researchResultFixture();
      const { provider } = scripted(validResponse(), true);
      const recorder = recording(provider);

      await generateReport({
        record: researchRecordFixture(),
        result,
        provider: recorder.provider,
      });

      expect(recorder.requests[0]?.context).toStrictEqual({
        brief: buildFindingBrief(result),
      });
    });

    it("names the research it is reporting on, and nothing else", async () => {
      const { provider } = scripted(validResponse(), true);

      const report = await generateReport({
        record: researchRecordFixture(),
        result: researchResultFixture(),
        provider,
      });

      expect(report.researchId).toBe(RESEARCH_ID);
      expect(report.objective).toBe(researchResultFixture().question);
      // The title is derived from the question by the server. §14 checks the
      // objective against the record precisely because the title is free to be
      // readable.
      expect(report.title).toBe(researchResultFixture().question);
    });

    it("does not tell the model what a URL is, because it cannot ask for one", () => {
      // Collapsed first: the instruction is written as wrapped source lines, so a
      // phrase can straddle a newline and a raw `toContain` would fail on the
      // formatting rather than on the wording.
      const instruction = REPORT_INSTRUCTION.replace(/\s+/g, " ");

      expect(instruction).toContain(
        "never a title, a URL, a publication name or a quotation of your own",
      );
      // And the instruction is advice; the schema is what makes it true.
      expect(instruction).toContain("Respond with JSON only");
    });
  });
});
