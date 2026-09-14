import { describe, expect, it } from "vitest";

import { AgentEngineError } from "../errors";
import { createStubModelProvider, scriptedPlan } from "../provider/stub-provider";
import { createPlan } from "./index";

const TASK_ID = "task_test";

function errorFrom(error: unknown): AgentEngineError {
  expect(error).toBeInstanceOf(AgentEngineError);
  return error as AgentEngineError;
}

describe("createPlan", () => {
  it("turns a valid response into ordered steps with resolved dependencies", async () => {
    const provider = createStubModelProvider({
      script: {
        plan: () => scriptedPlan(["First step here.", "Second step here.", "Third step here."]),
      },
    });

    const steps = await createPlan({
      taskId: TASK_ID,
      objective: "An objective.",
      provider,
    });

    expect(steps).toHaveLength(3);
    expect(steps.map((step) => step.index)).toStrictEqual([0, 1, 2]);
    expect(steps.every((step) => step.status === "pending")).toBe(true);
    expect(steps.every((step) => step.taskId === TASK_ID)).toBe(true);
  });

  it("resolves dependency indices into step ids", async () => {
    const provider = createStubModelProvider({
      script: {
        plan: () => scriptedPlan(["First step here.", "Second step here."]),
      },
    });

    const steps = await createPlan({ taskId: TASK_ID, objective: "An objective.", provider });

    const [first, second] = steps;

    expect(second?.dependsOn).toStrictEqual([first?.id]);
  });

  it("mints a distinct id for every step", async () => {
    const provider = createStubModelProvider({
      script: {
        plan: () => scriptedPlan(["First step here.", "Second step here.", "Third step here."]),
      },
    });

    const steps = await createPlan({ taskId: TASK_ID, objective: "An objective.", provider });
    const ids = new Set(steps.map((step) => step.id));

    expect(ids.size).toBe(steps.length);
  });

  it("reports planner_failed when the response is not JSON", async () => {
    const provider = createStubModelProvider({
      script: { plan: () => "I'm afraid I can't do that." },
    });

    const error = errorFrom(
      await createPlan({ taskId: TASK_ID, objective: "An objective.", provider }).catch(
        (thrown: unknown) => thrown,
      ),
    );

    expect(error.code).toBe("planner_failed");
  });

  it("reports planner_failed when the response is empty", async () => {
    const provider = createStubModelProvider({ script: { plan: () => "   " } });

    const error = errorFrom(
      await createPlan({ taskId: TASK_ID, objective: "An objective.", provider }).catch(
        (thrown: unknown) => thrown,
      ),
    );

    expect(error.code).toBe("planner_failed");
  });

  it("reports invalid_plan when the response parses but is not a plan", async () => {
    const provider = createStubModelProvider({
      script: { plan: () => ({ steps: [] }) },
    });

    const error = errorFrom(
      await createPlan({ taskId: TASK_ID, objective: "An objective.", provider }).catch(
        (thrown: unknown) => thrown,
      ),
    );

    expect(error.code).toBe("invalid_plan");
    expect(error.details?.issues).toBeDefined();
  });

  it("reports invalid_plan for a forward dependency", async () => {
    const provider = createStubModelProvider({
      script: {
        plan: () => ({
          steps: [
            { description: "First step here.", expectedOutput: "Output.", dependsOn: [1] },
            { description: "Second step here.", expectedOutput: "Output." },
          ],
        }),
      },
    });

    const error = errorFrom(
      await createPlan({ taskId: TASK_ID, objective: "An objective.", provider }).catch(
        (thrown: unknown) => thrown,
      ),
    );

    expect(error.code).toBe("invalid_plan");
  });

  it("accepts JSON wrapped in a markdown fence", async () => {
    const provider = createStubModelProvider({
      script: {
        plan: () =>
          `\`\`\`json\n${JSON.stringify(scriptedPlan(["Only step here."]))}\n\`\`\``,
      },
    });

    const steps = await createPlan({ taskId: TASK_ID, objective: "An objective.", provider });

    expect(steps).toHaveLength(1);
  });

  it("lets a provider failure propagate for the caller to convert", async () => {
    const provider = createStubModelProvider({
      script: {
        plan: () => {
          throw new Error("upstream is down");
        },
      },
    });

    await expect(
      createPlan({ taskId: TASK_ID, objective: "An objective.", provider }),
    ).rejects.toThrow("upstream is down");
  });
});
