import { describe, expect, it } from "vitest";

import {
  findingsResponseSchema,
  FINDING_STATEMENT_MAX_LENGTH,
  QUOTE_MAX_LENGTH,
  verifyQuote,
} from "@/server/research/findings/schema";
import {
  researchPlanSchema,
  validateResearchPlan,
} from "@/server/research/planner/schema";

import { planSchema, validatePlanGraph } from "../planner/schema";
import { TEXT_ANALYSIS_TOOL_ID } from "../tools/builtin/text-analysis";
import {
  createDevModelProvider,
  EXTERNAL_RESEARCH_CAPABILITY,
} from "./dev-provider";

async function planFor(objective: string) {
  const provider = createDevModelProvider();
  const response = await provider.generate({
    operation: "plan",
    instruction: "plan",
    context: { objective },
    responseFormat: "json",
  });

  return { response, parsed: JSON.parse(response.text) as unknown };
}

/**
 * The two research operations, asked of the adapter directly.
 *
 * The context is `unknown` to the adapter by design, so these helpers take
 * `unknown` too and the tests below hand it things a well-behaved caller would
 * not send.
 */
async function researchPlanFor(question?: string) {
  const provider = createDevModelProvider();
  const response = await provider.generate({
    operation: "research_plan",
    instruction: "plan the research",
    context: question === undefined ? {} : { question },
    responseFormat: "json",
  });

  return JSON.parse(response.text) as unknown;
}

async function findingsFor(
  sources: unknown,
  question = "What did grid-scale storage cost?",
) {
  const provider = createDevModelProvider();
  const response = await provider.generate({
    operation: "research_findings",
    instruction: "extract findings",
    context: { question, sources },
    responseFormat: "json",
  });

  return JSON.parse(response.text) as unknown;
}

/** A numbered source, in the shape the finding extractor supplies. */
function contextSource(index: number, content: string, title?: string) {
  return { index, url: `https://example.org/${index}`, title, content };
}

describe("createDevModelProvider", () => {
  it("reports itself as a non-external provider", () => {
    const provider = createDevModelProvider();

    expect(provider.descriptor.isExternal).toBe(false);
    expect(provider.descriptor.id).toBe("dev");
  });

  it("produces output that satisfies the planner's schema", async () => {
    const { parsed } = await planFor("Compare grid-scale storage approaches.");

    const validated = planSchema.safeParse(parsed);

    expect(validated.success).toBe(true);
  });

  it("produces an identical plan for an identical objective", async () => {
    const objective = "Summarise the trade-offs of heat pumps versus hydrogen.";

    const first = await planFor(objective);
    const second = await planFor(objective);

    expect(second.parsed).toStrictEqual(first.parsed);
  });

  it("produces a different plan for a different objective", async () => {
    const first = await planFor("Assess the risk of drought in the Sahel.");
    const second = await planFor("Assess the risk of flooding in the Fens.");

    expect(second.parsed).not.toStrictEqual(first.parsed);
  });

  it("requests an external capability only when the objective asks for one", async () => {
    const research = await planFor("Search the web for recent battery prices.");
    const reasoning = await planFor("Assess the arguments for and against a tax.");

    const researchSteps = planSchema.parse(research.parsed).steps;
    const reasoningSteps = planSchema.parse(reasoning.parsed).steps;

    expect(researchSteps.some((step) => step.toolId !== undefined)).toBe(true);
    expect(reasoningSteps.some((step) => step.toolId !== undefined)).toBe(false);
  });

  it("names the same capability in every step that needs one", async () => {
    const { parsed } = await planFor("Browse the web for planning statistics.");

    const steps = planSchema.parse(parsed).steps;
    const withTools = steps.filter((step) => step.toolId !== undefined);

    expect(withTools.length).toBeGreaterThan(0);

    for (const step of withTools) {
      expect(step.toolId).toBe(EXTERNAL_RESEARCH_CAPABILITY);
    }
  });

  it("never emits a dependency on a later step", async () => {
    const { parsed } = await planFor("Search the web and compare three options.");

    const steps = planSchema.parse(parsed).steps;

    steps.forEach((step, index) => {
      for (const dependency of step.dependsOn ?? []) {
        expect(dependency).toBeLessThan(index);
      }
    });
  });

  it("answers the step and evaluate operations with valid JSON", async () => {
    const provider = createDevModelProvider();

    const step = await provider.generate({
      operation: "execute_step",
      instruction: "run",
      context: { stepDescription: "Do the thing.", objective: "An objective." },
      responseFormat: "json",
    });

    const evaluate = await provider.generate({
      operation: "evaluate",
      instruction: "evaluate",
      context: { stepOutcomes: ["completed", "failed"] },
      responseFormat: "json",
    });

    expect(() => JSON.parse(step.text)).not.toThrow();
    expect(() => JSON.parse(evaluate.text)).not.toThrow();
  });

  /**
   * Phase 4's tool-backed branch.
   *
   * The adapter may propose a tool call, but only for a tool that exists and
   * only with input the user actually supplied. Both halves of that are
   * asserted here, because the failure mode they guard against — a step whose
   * input the adapter invented — produces a result indistinguishable from a
   * real one.
   */
  describe("text analysis", () => {
    it("proposes the text analysis tool when the objective supplies text", async () => {
      const { parsed } = await planFor(
        "Analyse this text: One two. Three.\n\nFour.",
      );

      const steps = planSchema.parse(parsed).steps;
      const toolStep = steps.find((step) => step.toolId === TEXT_ANALYSIS_TOOL_ID);

      expect(toolStep).toBeDefined();
      expect(toolStep?.toolInput).toStrictEqual({
        text: "One two. Three.\n\nFour.",
      });
    });

    it("takes the text from a quoted run when there is no colon", async () => {
      const { parsed } = await planFor('Count the words in "A well-known don\'t".');

      const steps = planSchema.parse(parsed).steps;
      const toolStep = steps.find((step) => step.toolId === TEXT_ANALYSIS_TOOL_ID);

      expect(toolStep?.toolInput).toStrictEqual({ text: "A well-known don't" });
    });

    it("proposes no tool step when the objective asks for a count but supplies no text", async () => {
      const { parsed } = await planFor("How many words are in a typical novel?");

      const steps = planSchema.parse(parsed).steps;

      // Measuring the objective itself, or a placeholder, would be the adapter
      // inventing its own input.
      expect(steps.some((step) => step.toolId !== undefined)).toBe(false);
    });

    it("proposes no tool step when no measurement was asked for", async () => {
      const { parsed } = await planFor("Compare grid-scale storage approaches.");

      const steps = planSchema.parse(parsed).steps;

      expect(steps.some((step) => step.toolId === TEXT_ANALYSIS_TOOL_ID)).toBe(
        false,
      );
    });

    it("produces a plan the planner accepts, tool step included", async () => {
      const { parsed } = await planFor("Analyse the text: One two. Three.");

      expect(planSchema.safeParse(parsed).success).toBe(true);
      expect(validatePlanGraph(planSchema.parse(parsed))).toStrictEqual([]);
    });

    it("hangs the tool step off the analytical spine rather than the synthesis", async () => {
      const { parsed } = await planFor("Analyse this text: One two. Three.");

      const steps = planSchema.parse(parsed).steps;
      const toolIndex = steps.findIndex(
        (step) => step.toolId === TEXT_ANALYSIS_TOOL_ID,
      );
      const synthesisIndex = steps.findIndex((step) =>
        step.description.startsWith("Synthesise"),
      );

      // Synthesis must not depend on the tool step, or a failed analysis would
      // cancel the run instead of degrading it.
      expect(toolIndex).toBeGreaterThan(-1);
      expect(steps[synthesisIndex]?.dependsOn ?? []).not.toContain(toolIndex);
    });
  });

  /**
   * Phase 5's two research operations, tested against the consumers that read
   * them.
   *
   * These cases import the research subsystem's schemas, which the adapter
   * itself deliberately does not. That is the point of them: the adapter
   * duplicates the research bounds rather than importing them, and the only
   * thing that makes the duplication safe is a check that the real consumer
   * accepts the real output. A test that restated the bounds would agree with
   * the adapter by construction and would agree with the extractor only by
   * luck. Test-only import; the production module graph is unchanged.
   *
   * The property under test throughout is the one §12 rests on: this adapter
   * cannot invent, so the honest thing to check is not that it is honest but
   * that everything it emits survives the check a model's output has to pass.
   */
  describe("the research plan operation", () => {
    it("produces a plan the research planner accepts", async () => {
      const parsed = await researchPlanFor("What did grid-scale storage cost?");

      expect(researchPlanSchema.safeParse(parsed).success).toBe(true);
    });

    it("produces queries the planner does not report as duplicates", async () => {
      const parsed = await researchPlanFor("What did grid-scale storage cost?");

      // The adapter proposes several tasks, and the plan schema refuses two
      // tasks searching for the same thing — so an adapter reusing one query
      // for every facet would produce a plan the run refuses.
      expect(validateResearchPlan(researchPlanSchema.parse(parsed))).toStrictEqual([]);
    });

    it("produces the same plan for the same question", async () => {
      const question = "What did grid-scale battery storage cost in 2024?";

      expect(await researchPlanFor(question)).toStrictEqual(
        await researchPlanFor(question),
      );
    });

    it("produces different queries for different questions", async () => {
      const first = researchPlanSchema.parse(
        await researchPlanFor("What did grid-scale storage cost?"),
      );
      const second = researchPlanSchema.parse(
        await researchPlanFor("How much storage capacity was installed?"),
      );

      expect(second.tasks[0]?.query).not.toBe(first.tasks[0]?.query);
    });

    it("echoes the question into every query rather than interpreting it", async () => {
      const question = "What did grid-scale storage cost?";
      const plan = researchPlanSchema.parse(await researchPlanFor(question));

      // §7's rule that a plan says what to look up and never what is true. A
      // deterministic adapter has no way to be right about the subject, so the
      // only thing it may put in a query is the text it was handed.
      for (const task of plan.tasks) {
        expect(task.query).toContain(question);
      }
    });

    it("asks rather than asserts in every task question", async () => {
      const plan = researchPlanSchema.parse(
        await researchPlanFor("What did grid-scale storage cost?"),
      );

      for (const task of plan.tasks) {
        expect(task.question.startsWith("Establish the ")).toBe(true);
      }
    });

    it("says in its restatement that an adapter produced it", async () => {
      const plan = researchPlanSchema.parse(
        await researchPlanFor("What did grid-scale storage cost?"),
      );

      // The restatement is the field a reader would take for a model's reading
      // of the question, so it is the one that most needs to announce itself.
      expect(plan.restatement).toContain("deterministic development adapter");
    });

    it("still produces a valid plan when the context carries no question", async () => {
      const parsed = await researchPlanFor();

      // The operation is reachable with an empty context, so it answers with a
      // schema-valid plan rather than throwing at the boundary.
      expect(researchPlanSchema.safeParse(parsed).success).toBe(true);
    });

    it("proposes no more tasks than the plan schema allows", async () => {
      const plan = researchPlanSchema.parse(
        await researchPlanFor("a".repeat(300)),
      );

      expect(plan.tasks.length).toBeGreaterThan(0);
      expect(plan.tasks.length).toBeLessThanOrEqual(12);
    });

    it("bounds a long question rather than emitting an unbounded query", async () => {
      // A 300-character question must not become a 300-character-plus query on
      // every task — the query is bounded before it reaches a metered provider.
      const plan = researchPlanSchema.parse(await researchPlanFor("q".repeat(300)));

      for (const task of plan.tasks) {
        expect(task.query.length).toBeLessThanOrEqual(400);
      }
    });
  });

  describe("the research findings operation", () => {
    const COST = "Grid-scale battery pack costs fell by about 40% between 2019 and 2024.";

    it("quotes each source verbatim", async () => {
      const parsed = findingsResponseSchema.parse(
        await findingsFor([contextSource(0, COST)]),
      );
      const [finding] = parsed.findings;

      expect(finding).toBeDefined();
      // The extractor's own check, applied here rather than a restatement of
      // it: the quote must genuinely appear in the source it cites.
      expect(verifyQuote(COST, finding?.quote ?? "")).toBe(true);
    });

    it("attributes each finding to the source it quoted", async () => {
      const parsed = findingsResponseSchema.parse(
        await findingsFor([
          contextSource(2, COST),
          contextSource(5, "Installed grid-scale storage reached 90 GW in 2025."),
        ]),
      );

      // Non-contiguous indices, so a finding numbered by its position in the
      // array rather than by the index it was given fails here. The whole
      // evidence chain rests on this number.
      expect(parsed.findings.map((finding) => finding.sourceIndex)).toStrictEqual([
        2, 5,
      ]);
    });

    it("copies rather than summarises", async () => {
      const parsed = findingsResponseSchema.parse(
        await findingsFor([contextSource(0, COST)]),
      );

      // The statement carries its source's own words, so a reader can see that
      // nothing was concluded on the source's behalf.
      expect(parsed.findings[0]?.statement).toContain("battery pack costs fell");
    });

    it("emits no finding for a source with no text", async () => {
      const parsed = findingsResponseSchema.parse(
        await findingsFor([
          { index: 0, url: "https://example.org/a" },
          contextSource(1, COST),
        ]),
      );

      // There would be nothing to quote, and a finding resting on an unquoted
      // source is exactly the unsupported attribution §12 exists to catch.
      expect(parsed.findings.map((finding) => finding.sourceIndex)).toStrictEqual([1]);
    });

    it("emits no finding for a source whose text is only whitespace", async () => {
      const parsed = findingsResponseSchema.parse(
        await findingsFor([contextSource(0, "   \n\t  ")]),
      );

      expect(parsed.findings).toStrictEqual([]);
    });

    it("emits no finding for a source too short to quote", async () => {
      const parsed = findingsResponseSchema.parse(
        await findingsFor([contextSource(0, "Hi.")]),
      );

      // A three-character quote is below the extractor's own minimum, so
      // emitting one would fail the whole response's validation and turn a run's
      // findings into an extraction error — from a single stub page. Emitting
      // nothing is the outcome `excerpt` promises for an unquotable source.
      expect(parsed.findings).toStrictEqual([]);
    });

    it("emits no finding when there are no sources", async () => {
      const parsed = findingsResponseSchema.parse(await findingsFor([]));

      expect(parsed.findings).toStrictEqual([]);
    });

    it("ignores a malformed source entry rather than failing", async () => {
      const parsed = findingsResponseSchema.parse(
        await findingsFor([
          null,
          "a source",
          { url: "https://example.org/no-index" },
          { index: 1.5, url: "https://example.org/fractional", content: COST },
          { index: -1, url: "https://example.org/negative", content: COST },
          contextSource(0, COST),
        ]),
      );

      // The context is untrusted, so a malformed entry is skipped and the rest
      // of the extraction proceeds.
      expect(parsed.findings.map((finding) => finding.sourceIndex)).toStrictEqual([0]);
    });

    it("collapses a multi-line source before quoting it", async () => {
      const content = "Grid-scale battery pack costs\nfell by about 40%\nbetween 2019 and 2024.";
      const parsed = findingsResponseSchema.parse(
        await findingsFor([contextSource(0, content)]),
      );
      const quote = parsed.findings[0]?.quote ?? "";

      // Safe rather than lossy: the extractor normalises both sides, so a
      // collapsed quote still verifies against the raw retrieved text.
      expect(quote).not.toContain("\n");
      expect(verifyQuote(content, quote)).toBe(true);
    });

    it("keeps a very long source inside the quote bound", async () => {
      const content = `${"grid storage costs fell sharply ".repeat(400)}and then settled.`;
      const parsed = findingsResponseSchema.parse(
        await findingsFor([contextSource(0, content)]),
      );
      const quote = parsed.findings[0]?.quote ?? "";

      expect(quote.length).toBeLessThanOrEqual(QUOTE_MAX_LENGTH);
      // Still verbatim after the cut, which is the property the bound must not
      // break: a quote shortened mid-word would no longer appear in the source.
      expect(verifyQuote(content, quote)).toBe(true);
    });

    it("keeps every statement inside the schema's bound", async () => {
      const content = `${"a long retrieved passage about storage costs ".repeat(60)}end.`;
      const parsed = findingsResponseSchema.parse(
        await findingsFor([contextSource(0, content, "A very long source title indeed")]),
      );

      for (const finding of parsed.findings) {
        expect(finding.statement.length).toBeLessThanOrEqual(
          FINDING_STATEMENT_MAX_LENGTH,
        );
      }
    });

    it("reports the gap it did not close", async () => {
      const parsed = findingsResponseSchema.parse(
        await findingsFor([contextSource(0, COST)]),
      );

      // The truthful gap: this adapter does not judge whether the sources answer
      // the question, because judging that is inference and it does not infer.
      expect(parsed.gaps?.[0]).toContain("without interpreting");
    });

    it("states no conflict, because it cannot judge one", async () => {
      const parsed = findingsResponseSchema.parse(
        await findingsFor([
          contextSource(0, "Storage costs fell by 40% between 2019 and 2024."),
          contextSource(1, "Storage costs rose by 40% between 2019 and 2024."),
        ]),
      );

      // Two sources that plainly disagree, and the adapter still reports no
      // conflict — because recognising one is inference, and §16's conflicts are
      // recorded rather than guessed. Both findings are emitted; the reader sees
      // the disagreement in the text, which is where it actually is.
      expect(parsed.conflicts).toBeUndefined();
      expect(parsed.findings).toHaveLength(2);
    });

    it("produces the same findings for the same sources", async () => {
      const sources = [contextSource(0, COST)];

      expect(await findingsFor(sources)).toStrictEqual(await findingsFor(sources));
    });

    it("names the source by its title when it has one", async () => {
      const parsed = findingsResponseSchema.parse(
        await findingsFor([contextSource(0, COST, "Storage cost review")]),
      );

      expect(parsed.findings[0]?.statement).toContain("Storage cost review");
    });
  });
});
