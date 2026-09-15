import { describe, expect, it } from "vitest";

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
});
