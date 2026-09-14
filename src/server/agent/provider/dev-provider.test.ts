import { describe, expect, it } from "vitest";

import { planSchema } from "../planner/schema";
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
});
