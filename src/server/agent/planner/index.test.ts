import { describe, expect, it } from "vitest";

import type { Tool } from "@/types/agent";
import { AgentEngineError } from "../errors";
import type { ModelOperation } from "../provider";
import { createStubModelProvider, scriptedPlan } from "../provider/stub-provider";
import { createPlan, MAX_PLAN_ATTEMPTS } from "./index";

const TASK_ID = "task_test";

/** A catalogue entry, shaped as `ToolRegistry.list()` returns one. */
const TEXT_TOOL: Tool = {
  id: "text.analyze",
  name: "Text analysis",
  description:
    "Counts characters, words, sentences and paragraphs in a block of text.",
  version: "1.0.0",
  capabilities: ["read_only"],
};

/** A plan step missing `expectedOutput`, which the schema requires. */
const STEP_WITHOUT_OUTPUT = {
  steps: [{ description: "A step with no expected output." }],
};

function errorFrom(error: unknown): AgentEngineError {
  expect(error).toBeInstanceOf(AgentEngineError);
  return error as AgentEngineError;
}

function countingCalls(): Record<ModelOperation, number> {
  return {
    plan: 0,
    execute_step: 0,
    evaluate: 0,
    research_plan: 0,
    research_findings: 0,
  };
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
      tools: [],
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

    const steps = await createPlan({
      taskId: TASK_ID,
      objective: "An objective.",
      provider,
      tools: [],
    });

    const [first, second] = steps;

    expect(second?.dependsOn).toStrictEqual([first?.id]);
  });

  it("mints a distinct id for every step", async () => {
    const provider = createStubModelProvider({
      script: {
        plan: () => scriptedPlan(["First step here.", "Second step here.", "Third step here."]),
      },
    });

    const steps = await createPlan({
      taskId: TASK_ID,
      objective: "An objective.",
      provider,
      tools: [],
    });
    const ids = new Set(steps.map((step) => step.id));

    expect(ids.size).toBe(steps.length);
  });

  it("reports planner_failed when the response is not JSON", async () => {
    const provider = createStubModelProvider({
      script: { plan: () => "I'm afraid I can't do that." },
    });

    const error = errorFrom(
      await createPlan({
        taskId: TASK_ID,
        objective: "An objective.",
        provider,
        tools: [],
      }).catch((thrown: unknown) => thrown),
    );

    expect(error.code).toBe("planner_failed");
  });

  it("reports planner_failed when the response is empty", async () => {
    const provider = createStubModelProvider({ script: { plan: () => "   " } });

    const error = errorFrom(
      await createPlan({
        taskId: TASK_ID,
        objective: "An objective.",
        provider,
        tools: [],
      }).catch((thrown: unknown) => thrown),
    );

    expect(error.code).toBe("planner_failed");
  });

  it("reports invalid_plan when the response parses but is not a plan", async () => {
    const provider = createStubModelProvider({
      script: { plan: () => ({ steps: [] }) },
    });

    const error = errorFrom(
      await createPlan({
        taskId: TASK_ID,
        objective: "An objective.",
        provider,
        tools: [],
      }).catch((thrown: unknown) => thrown),
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
      await createPlan({
        taskId: TASK_ID,
        objective: "An objective.",
        provider,
        tools: [],
      }).catch((thrown: unknown) => thrown),
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

    const steps = await createPlan({
      taskId: TASK_ID,
      objective: "An objective.",
      provider,
      tools: [],
    });

    expect(steps).toHaveLength(1);
  });

  describe("the tool catalogue", () => {
    /** Runs one plan against a capturing provider and returns what it was sent. */
    async function captureContext(
      tools: readonly Tool[],
    ): Promise<Record<string, unknown>> {
      const contexts: Array<Record<string, unknown>> = [];

      const provider = createStubModelProvider({
        script: {
          plan: (context) => {
            contexts.push(context);
            return scriptedPlan(["Only step here."]);
          },
        },
      });

      await createPlan({
        taskId: TASK_ID,
        objective: "A specific objective.",
        provider,
        tools,
      });

      const [first] = contexts;

      if (first === undefined) {
        throw new Error("The planner never asked the provider for a plan.");
      }

      return first;
    }

    it("tells the provider which tools this run can call", async () => {
      const context = await captureContext([TEXT_TOOL]);

      // Id and description only. `version` and `capabilities` are metadata for
      // the engine's own accounting, and the model has no rule for either.
      expect(context.tools).toStrictEqual([
        { id: TEXT_TOOL.id, description: TEXT_TOOL.description },
      ]);
    });

    it("sends an empty catalogue when the run has no tools", async () => {
      const context = await captureContext([]);

      // Empty, not absent: the prompt tells the model the list is the complete
      // set of valid ids, so a run with no tools has to say so rather than
      // leaving the model to infer it from a missing key.
      expect(context.tools).toStrictEqual([]);
    });

    it("carries an objective alongside the catalogue", async () => {
      const context = await captureContext([TEXT_TOOL]);

      expect(context.objective).toBe("A specific objective.");
    });
  });

  describe("repairing a rejected plan", () => {
    it("asks again and returns the repaired plan", async () => {
      const calls = countingCalls();
      let attempt = 0;

      const provider = createStubModelProvider({
        script: {
          plan: () => {
            attempt += 1;
            return attempt === 1 ? STEP_WITHOUT_OUTPUT : scriptedPlan(["Repaired step here."]);
          },
        },
        calls,
      });

      const steps = await createPlan({
        taskId: TASK_ID,
        objective: "An objective.",
        provider,
        tools: [],
      });

      expect(steps).toHaveLength(1);
      expect(steps[0]?.description).toBe("Repaired step here.");
      expect(calls.plan).toBe(2);
    });

    it("repairs a plan whose dependencies are illegal", async () => {
      let attempt = 0;

      const provider = createStubModelProvider({
        script: {
          plan: () => {
            attempt += 1;

            return attempt === 1
              ? {
                  steps: [
                    {
                      description: "First step here.",
                      expectedOutput: "Output.",
                      dependsOn: [1],
                    },
                    { description: "Second step here.", expectedOutput: "Output." },
                  ],
                }
              : scriptedPlan(["First step here.", "Second step here."]);
          },
        },
      });

      const steps = await createPlan({
        taskId: TASK_ID,
        objective: "An objective.",
        provider,
        tools: [],
      });

      expect(steps).toHaveLength(2);
    });

    it("shows the model its rejected reply and what was wrong with it", async () => {
      const contexts: Array<Record<string, unknown>> = [];

      const provider = createStubModelProvider({
        script: {
          plan: (context) => {
            contexts.push(context);

            return contexts.length === 1
              ? STEP_WITHOUT_OUTPUT
              : scriptedPlan(["Repaired step here."]);
          },
        },
      });

      await createPlan({
        taskId: TASK_ID,
        objective: "An objective.",
        provider,
        tools: [],
      });

      const first = contexts[0];
      const repair = contexts[1];

      // The first ask carries no rejection material — there is nothing to show.
      expect(first?.previousResponse).toBeUndefined();
      expect(first?.issues).toBeUndefined();

      expect(typeof repair?.previousResponse).toBe("string");
      expect(repair?.previousResponse).toContain("A step with no expected output.");

      const issues = repair?.issues as Array<{ path: string }> | undefined;

      expect(issues).toHaveLength(1);
      expect(issues?.[0]?.path).toBe("steps.0.expectedOutput");
    });

    it("gives up after one repair and reports how many attempts were spent", async () => {
      const calls = countingCalls();

      const provider = createStubModelProvider({
        script: { plan: () => STEP_WITHOUT_OUTPUT },
        calls,
      });

      const error = errorFrom(
        await createPlan({
          taskId: TASK_ID,
          objective: "An objective.",
          provider,
          tools: [],
        }).catch((thrown: unknown) => thrown),
      );

      expect(error.code).toBe("invalid_plan");
      expect(error.details?.attempts).toBe(MAX_PLAN_ATTEMPTS);
      expect(calls.plan).toBe(MAX_PLAN_ATTEMPTS);
    });

    it("does not retry a provider that could not answer at all", async () => {
      const calls = countingCalls();

      const provider = createStubModelProvider({
        script: {
          plan: () => {
            throw new Error("upstream is down");
          },
        },
        calls,
      });

      await expect(
        createPlan({
          taskId: TASK_ID,
          objective: "An objective.",
          provider,
          tools: [],
        }),
      ).rejects.toThrow("upstream is down");

      // One call, not two. A transport failure is an infrastructure problem and
      // the repair exists for model-output problems; retrying it would blur the
      // distinction between planner_failed and invalid_plan.
      expect(calls.plan).toBe(1);
    });
  });
});
