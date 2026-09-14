import { describe, expect, it } from "vitest";

import {
  MAX_PLAN_STEPS,
  PLANNED_STEP_MIN_LENGTH,
  planSchema,
  validatePlanGraph,
  type PlannedPlan,
} from "./schema";

const VALID_STEP = {
  description: "Identify the information the result depends on.",
  expectedOutput: "A list of required facts.",
};

function planWith(steps: unknown[]): unknown {
  return { steps };
}

describe("planSchema", () => {
  it("accepts a single well-formed step", () => {
    const result = planSchema.safeParse(planWith([VALID_STEP]));

    expect(result.success).toBe(true);
  });

  it("accepts a step with dependencies and a tool", () => {
    const result = planSchema.safeParse(
      planWith([VALID_STEP, { ...VALID_STEP, dependsOn: [0], toolId: "web.search" }]),
    );

    expect(result.success).toBe(true);
  });

  it("rejects a plan with no steps", () => {
    const result = planSchema.safeParse(planWith([]));

    expect(result.success).toBe(false);
  });

  it("rejects a plan with more steps than the limit", () => {
    const steps = Array.from({ length: MAX_PLAN_STEPS + 1 }, () => VALID_STEP);
    const result = planSchema.safeParse(planWith(steps));

    expect(result.success).toBe(false);
  });

  it("rejects a step description that is too short", () => {
    const result = planSchema.safeParse(
      planWith([{ ...VALID_STEP, description: "a".repeat(PLANNED_STEP_MIN_LENGTH - 1) }]),
    );

    expect(result.success).toBe(false);
  });

  it("rejects a step that does not say what it should produce", () => {
    const result = planSchema.safeParse(
      planWith([{ description: VALID_STEP.description }]),
    );

    expect(result.success).toBe(false);
  });

  it("rejects a negative or fractional dependency index", () => {
    expect(
      planSchema.safeParse(planWith([VALID_STEP, { ...VALID_STEP, dependsOn: [-1] }]))
        .success,
    ).toBe(false);
    expect(
      planSchema.safeParse(planWith([VALID_STEP, { ...VALID_STEP, dependsOn: [0.5] }]))
        .success,
    ).toBe(false);
  });

  it("rejects a non-object response", () => {
    expect(planSchema.safeParse(null).success).toBe(false);
    expect(planSchema.safeParse("a plan").success).toBe(false);
    expect(planSchema.safeParse({ steps: "two" }).success).toBe(false);
  });

  // Model output routinely carries fields nobody asked for. Rejecting the whole
  // plan over an extra key would make the engine brittle against the very
  // output it has to tolerate, so unknown keys are stripped instead.
  it("strips fields the schema does not define", () => {
    const result = planSchema.safeParse(
      planWith([{ ...VALID_STEP, confidence: "high" }]),
    );

    expect(result.success).toBe(true);

    if (!result.success) {
      throw new Error("Expected the plan to validate.");
    }

    expect(Object.keys(result.data.steps[0] ?? {})).not.toContain("confidence");
  });
});

describe("validatePlanGraph", () => {
  const plan = (steps: PlannedPlan["steps"]): PlannedPlan => ({ steps });

  it("accepts a linear chain", () => {
    const issues = validatePlanGraph(
      plan([
        { ...VALID_STEP },
        { ...VALID_STEP, dependsOn: [0] },
        { ...VALID_STEP, dependsOn: [1] },
      ]),
    );

    expect(issues).toStrictEqual([]);
  });

  it("accepts a step depending on several earlier steps", () => {
    const issues = validatePlanGraph(
      plan([
        { ...VALID_STEP },
        { ...VALID_STEP },
        { ...VALID_STEP, dependsOn: [0, 1] },
      ]),
    );

    expect(issues).toStrictEqual([]);
  });

  it("rejects a step that depends on itself", () => {
    const issues = validatePlanGraph(
      plan([{ ...VALID_STEP }, { ...VALID_STEP, dependsOn: [1] }]),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.index).toBe(1);
  });

  it("rejects a forward reference", () => {
    const issues = validatePlanGraph(
      plan([{ ...VALID_STEP, dependsOn: [2] }, { ...VALID_STEP }, { ...VALID_STEP }]),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.index).toBe(0);
  });

  it("rejects a duplicated dependency", () => {
    const issues = validatePlanGraph(
      plan([{ ...VALID_STEP }, { ...VALID_STEP }, { ...VALID_STEP, dependsOn: [0, 0] }]),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.index).toBe(2);
  });

  // A cycle needs an edge pointing forwards, so the backwards-only rule makes
  // one unrepresentable. This asserts the guarantee rather than assuming it.
  it("cannot express a cycle", () => {
    const issues = validatePlanGraph(
      plan([{ ...VALID_STEP, dependsOn: [1] }, { ...VALID_STEP, dependsOn: [0] }]),
    );

    expect(issues.length).toBeGreaterThan(0);
  });
});
