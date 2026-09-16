import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { AgentEventType, ExecutionStatus } from "@/types/agent";
import { AgentEngineError } from "../errors";
import {
  createToolRegistry,
  TEXT_ANALYSIS_TOOL_ID,
  TEXT_ANALYSIS_TOOL_VERSION,
  ToolExecutor,
  ToolPermission,
} from "../tools";
// Test-only helper, deliberately outside the module's public barrel — the same
// arrangement `provider/stub-provider.ts` uses.
import { createTestTool, TEST_TOOL_ID, type TestToolOptions } from "../tools/testing";
import {
  createStubModelProvider,
  scriptedPlan,
  type StubProviderScript,
} from "../provider/stub-provider";
import { runAgent } from "./runner";

const OBJECTIVE = "Compare the leading approaches to grid-scale storage.";

/** A plan whose second step fails, plus an independent branch that should not. */
const BRANCHING_SCRIPT: StubProviderScript = {
  plan: () => ({
    steps: [
      { description: "First step here.", expectedOutput: "Output." },
      { description: "Second step here.", expectedOutput: "Output.", dependsOn: [0] },
      { description: "Third step here.", expectedOutput: "Output.", dependsOn: [0] },
      { description: "Fourth step here.", expectedOutput: "Output.", dependsOn: [1] },
    ],
  }),
  execute_step: (context) => {
    if (context.stepDescription === "Second step here.") {
      throw new Error("this step could not be completed");
    }

    return { produced: "something" };
  },
  evaluate: () => ({ summary: "A summary of the run." }),
};

const HAPPY_SCRIPT: StubProviderScript = {
  plan: () => scriptedPlan(["First step here.", "Second step here."]),
  execute_step: () => ({ produced: "something" }),
  evaluate: () => ({ summary: "A summary of the run." }),
};

describe("runAgent", () => {
  beforeEach(() => {
    // The engine logs unexpected and narrative failures on purpose. Silenced
    // here so a passing suite is readable; the behaviour is asserted instead.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("completes a run end to end", async () => {
    const provider = createStubModelProvider({ script: HAPPY_SCRIPT });

    const execution = await runAgent({ objective: OBJECTIVE, provider });

    expect(execution.state.status).toBe("completed");
    expect(execution.task.status).toBe("completed");
    expect(execution.task.steps).toHaveLength(2);
    expect(execution.task.steps.every((step) => step.status === "completed")).toBe(true);
    expect(execution.result?.status).toBe("completed");
  });

  it("produces a plan before running it", async () => {
    const provider = createStubModelProvider({ script: HAPPY_SCRIPT });

    const execution = await runAgent({ objective: OBJECTIVE, provider });

    expect(execution.task.steps.length).toBeGreaterThan(0);
    expect(execution.task.steps.every((step) => step.status !== "pending")).toBe(true);
  });

  it("records an observation for every step it ran", async () => {
    const provider = createStubModelProvider({ script: HAPPY_SCRIPT });

    const execution = await runAgent({ objective: OBJECTIVE, provider });
    const observedStepIds = new Set(
      execution.state.observations.map((observation) => observation.stepId),
    );

    expect(observedStepIds.size).toBe(execution.task.steps.length);
  });

  it("reports the provider that produced the run", async () => {
    const provider = createStubModelProvider({ script: HAPPY_SCRIPT });

    const execution = await runAgent({ objective: OBJECTIVE, provider });

    expect(execution.provider.id).toBe("stub");
    // The value the UI keys off to avoid presenting a run as model output.
    expect(execution.provider.isExternal).toBe(false);
  });

  it("emits lifecycle events in order", async () => {
    const provider = createStubModelProvider({ script: HAPPY_SCRIPT });

    const execution = await runAgent({ objective: OBJECTIVE, provider });
    const types = execution.events.map((event) => event.type);

    expect(types[0]).toBe("execution.created");
    expect(types).toContain("execution.planning");
    expect(types).toContain("execution.planned");
    expect(types).toContain("execution.started");
    expect(types).toContain("step.started");
    expect(types).toContain("step.completed");
    expect(types.at(-1)).toBe("execution.completed");
  });

  it("gives every event a distinct id and a parseable timestamp", async () => {
    const provider = createStubModelProvider({ script: HAPPY_SCRIPT });

    const execution = await runAgent({ objective: OBJECTIVE, provider });

    expect(new Set(execution.events.map((event) => event.id)).size).toBe(
      execution.events.length,
    );

    for (const event of execution.events) {
      expect(Number.isNaN(Date.parse(event.timestamp))).toBe(false);
    }
  });

  it("does not abort the run when a step fails", async () => {
    const provider = createStubModelProvider({ script: BRANCHING_SCRIPT });

    const execution = await runAgent({ objective: OBJECTIVE, provider });
    const byIndex = execution.task.steps;

    expect(byIndex[1]?.status).toBe("failed");
    // Depends on the failed step, so it never ran.
    expect(byIndex[3]?.status).toBe("skipped");
    // Depends only on the first step, which succeeded, so it still ran.
    expect(byIndex[2]?.status).toBe("completed");
  });

  it("marks the run failed when any step failed", async () => {
    const provider = createStubModelProvider({ script: BRANCHING_SCRIPT });

    const execution = await runAgent({ objective: OBJECTIVE, provider });

    expect(execution.state.status).toBe("failed");
    expect(execution.result?.status).toBe("failed");
  });

  it("attaches structured errors for failed steps", async () => {
    const provider = createStubModelProvider({ script: BRANCHING_SCRIPT });

    const execution = await runAgent({ objective: OBJECTIVE, provider });

    expect(execution.result?.errors).toBeDefined();
    expect(execution.result?.errors?.length).toBeGreaterThan(0);
    expect(execution.result?.errors?.[0]?.stepId).toBe(execution.task.steps[1]?.id);
  });

  it("reports a capability the runtime cannot supply as unavailable", async () => {
    const provider = createStubModelProvider({
      script: {
        plan: () => ({
          steps: [
            {
              description: "Gather supporting information.",
              expectedOutput: "Source material.",
              toolId: "web.search",
            },
          ],
        }),
        execute_step: () => ({ produced: "something" }),
        evaluate: () => ({ summary: "A summary of the run." }),
      },
    });

    const execution = await runAgent({ objective: OBJECTIVE, provider });

    expect(execution.state.status).toBe("failed");
    expect(execution.result?.errors?.[0]?.code).toBe("capability_unavailable");
    // Nothing invented a result for the step that could not run.
    expect(execution.task.steps[0]?.status).toBe("failed");
  });

  it("invokes a registered tool and records its output", async () => {
    const registry = createToolRegistry();

    registry.register(
      createTestTool({ execute: () => Promise.resolve({ echoed: true }) }),
    );

    const provider = createStubModelProvider({
      script: {
        plan: () => ({
          steps: [
            {
              description: "Use the echo capability.",
              expectedOutput: "An echo.",
              toolId: TEST_TOOL_ID,
            },
          ],
        }),
        execute_step: () => ({ produced: "something" }),
        evaluate: () => ({ summary: "A summary of the run." }),
      },
    });

    const execution = await runAgent({ objective: OBJECTIVE, provider, registry });

    expect(execution.state.status).toBe("completed");
    expect(execution.state.observations[0]?.output).toMatchObject({ echoed: true });
  });

  it("skips the remaining steps when the run is cancelled", async () => {
    let shouldCancel = false;

    const provider = createStubModelProvider({
      script: {
        plan: () =>
          scriptedPlan(["First step here.", "Second step here.", "Third step here."]),
        execute_step: () => {
          shouldCancel = true;
          return { produced: "something" };
        },
        evaluate: () => ({ summary: "A summary of the run." }),
      },
    });

    const execution = await runAgent({
      objective: OBJECTIVE,
      provider,
      isCancelled: () => shouldCancel,
    });

    expect(execution.state.status).toBe("cancelled");
    expect(execution.task.steps[0]?.status).toBe("completed");
    expect(execution.task.steps[1]?.status).toBe("skipped");
    expect(execution.task.steps[2]?.status).toBe("skipped");
    expect(execution.events.at(-1)?.type).toBe("execution.cancelled");
  });

  it("returns a failed execution instead of throwing when planning fails", async () => {
    const provider = createStubModelProvider({
      script: { plan: () => "not a plan at all" },
    });

    const execution = await runAgent({ objective: OBJECTIVE, provider });

    expect(execution.state.status).toBe("failed");
    expect(execution.result?.status).toBe("failed");
    expect(execution.result?.errors?.[0]?.code).toBe("planner_failed");
    expect(execution.events.at(-1)?.type).toBe("execution.failed");
  });

  it("returns a failed execution when the provider cannot be configured", async () => {
    vi.stubEnv("LLM_API_STYLE", "some-other-style");

    const execution = await runAgent({ objective: OBJECTIVE });

    expect(execution.state.status).toBe("failed");
    expect(execution.result?.errors?.[0]?.code).toBe("internal_error");
    expect(execution.result?.errors?.[0]?.message).toContain("LLM_API_STYLE");
  });

  it("keeps a completed run completed when only the narrative fails", async () => {
    const provider = createStubModelProvider({
      script: {
        ...HAPPY_SCRIPT,
        evaluate: () => {
          throw new Error("the narrative model is unavailable");
        },
      },
    });

    const execution = await runAgent({ objective: OBJECTIVE, provider });

    expect(execution.state.status).toBe("completed");
    expect(execution.result?.summary).toContain("completed");
  });

  it("reports one finding per step, with the raw output attached", async () => {
    const provider = createStubModelProvider({ script: HAPPY_SCRIPT });

    const execution = await runAgent({ objective: OBJECTIVE, provider });
    const findings = execution.result?.findings ?? [];

    expect(findings).toHaveLength(execution.task.steps.length);
    expect(findings[0]).toMatchObject({ status: "completed" });
  });

  // The evaluator is only ever as informative as what the runner hands it. This
  // drives a real tool through the whole engine, so it fails if the wiring drops
  // the observations anywhere between the executor recording them and the
  // narrative being asked for a summary.
  it("tells the evaluator what the run actually produced", async () => {
    const contexts: Array<Record<string, unknown>> = [];

    const provider = createStubModelProvider({
      script: {
        plan: () => ({
          steps: [
            {
              description: "Count the characters in the phrase.",
              expectedOutput: "The character count.",
              toolId: TEXT_ANALYSIS_TOOL_ID,
              toolInput: { text: "the quick brown fox." },
            },
          ],
        }),
        evaluate: (context) => {
          contexts.push(context);
          return { summary: "A summary of the run." };
        },
      },
    });

    const execution = await runAgent({ objective: OBJECTIVE, provider });
    const results = contexts[0]?.stepResults as
      | Array<Record<string, unknown>>
      | undefined;

    expect(execution.state.status).toBe("completed");
    expect(results).toHaveLength(1);
    expect(results?.[0]).toMatchObject({
      index: 0,
      description: "Count the characters in the phrase.",
      status: "completed",
      expectedOutput: "The character count.",
      // A measurement, attributed to the tool that made it.
      source: "tool",
      toolId: TEXT_ANALYSIS_TOOL_ID,
    });
    expect(results?.[0]?.output).toContain('"characters":20');
  });

  it("keeps every timestamp in the state as a round-trippable ISO string", async () => {
    const provider = createStubModelProvider({ script: HAPPY_SCRIPT });

    const execution = await runAgent({ objective: OBJECTIVE, provider });
    const { state } = execution;

    expect(new Date(state.createdAt).toISOString()).toBe(state.createdAt);
    expect(new Date(state.updatedAt).toISOString()).toBe(state.updatedAt);

    const finishedAt = state.finishedAt ?? "";

    expect(finishedAt).not.toBe("");
    expect(new Date(finishedAt).toISOString()).toBe(finishedAt);
  });

  it("serialises to JSON without loss", async () => {
    const provider = createStubModelProvider({ script: HAPPY_SCRIPT });

    const execution = await runAgent({ objective: OBJECTIVE, provider });
    const roundTripped = JSON.parse(JSON.stringify(execution)) as {
      state: { status: ExecutionStatus };
      provider: { id: string };
    };

    expect(roundTripped.state.status).toBe("completed");
    expect(roundTripped.provider.id).toBe("stub");
  });

  it("gives each execution a distinct id", async () => {
    const provider = createStubModelProvider({ script: HAPPY_SCRIPT });

    const [first, second] = await Promise.all([
      runAgent({ objective: OBJECTIVE, provider }),
      runAgent({ objective: OBJECTIVE, provider }),
    ]);

    expect(first.id).not.toBe(second.id);
    expect(first.task.id).not.toBe(second.task.id);
  });

  it("emits events to a sink as they happen", async () => {
    const provider = createStubModelProvider({ script: HAPPY_SCRIPT });
    const seen: AgentEventType[] = [];

    const execution = await runAgent({
      objective: OBJECTIVE,
      provider,
      onEvent: (event) => seen.push(event.type),
    });

    expect(seen).toStrictEqual(execution.events.map((event) => event.type));
  });

  it("never throws for an engine failure", async () => {
    const provider = createStubModelProvider({
      script: {
        plan: () => {
          throw new AgentEngineError("planner_failed", "provider exploded");
        },
      },
    });

    await expect(
      runAgent({ objective: OBJECTIVE, provider }),
    ).resolves.toBeDefined();
  });

  /**
   * Phase 4 — the engine calling a tool.
   *
   * The stub provider stands in for the planner, so these tests choose the plan
   * directly. What they exercise is everything downstream of it: the executor's
   * tool branch, the tool layer's validation and permission checks, and the
   * observation, receipt and events that come back out.
   */
  describe("tool-backed steps", () => {
    /** A script whose single step names a tool, with whatever input is given. */
    function toolScript(toolId: string, toolInput?: unknown): StubProviderScript {
      return {
        plan: () => ({
          steps: [
            {
              description: "Use the echo capability.",
              expectedOutput: "An echo.",
              toolId,
              ...(toolInput === undefined ? {} : { toolInput }),
            },
          ],
        }),
        execute_step: () => ({ produced: "something" }),
        evaluate: () => ({ summary: "A summary of the run." }),
      };
    }

    function registryWith(
      options: TestToolOptions = {},
    ): ReturnType<typeof createToolRegistry> {
      const registry = createToolRegistry();
      registry.register(createTestTool(options));

      return registry;
    }

    it("records a receipt on the step that made the call", async () => {
      const registry = registryWith({
        execute: () => Promise.resolve({ echoed: true }),
      });
      const provider = createStubModelProvider({
        script: toolScript(TEST_TOOL_ID),
      });

      const execution = await runAgent({
        objective: OBJECTIVE,
        provider,
        registry,
      });

      const step = execution.task.steps[0];
      const receipt = step?.execution;

      expect(step?.status).toBe("completed");
      expect(receipt?.status).toBe("succeeded");
      expect(receipt?.toolId).toBe(TEST_TOOL_ID);
      expect(receipt?.toolVersion).toBe("1.0.0");
      // The link between the two records. `step.execution` is the receipt the
      // tool layer returned, stored as-is, not a summary of it.
      expect(receipt?.stepId).toBe(step?.id);
      expect(receipt?.id).toMatch(/^tool_/);
      expect(receipt?.output).toStrictEqual({ echoed: true });
    });

    it("attributes the observation to the tool rather than the engine", async () => {
      const registry = registryWith({
        id: "analysis.tool",
        execute: () => Promise.resolve({ measured: 4 }),
      });
      const provider = createStubModelProvider({
        script: toolScript("analysis.tool"),
      });

      const execution = await runAgent({
        objective: OBJECTIVE,
        provider,
        registry,
      });
      const [observation] = execution.state.observations;

      expect(observation?.source).toBe("tool");
      expect(observation?.toolId).toBe("analysis.tool");
      expect(observation?.stepId).toBe(execution.task.steps[0]?.id);
      expect(observation?.output).toStrictEqual({ measured: 4 });
    });

    it("emits tool events alongside the step events", async () => {
      const registry = registryWith();
      const provider = createStubModelProvider({
        script: toolScript(TEST_TOOL_ID),
      });

      const execution = await runAgent({
        objective: OBJECTIVE,
        provider,
        registry,
      });
      const types = execution.events.map((event) => event.type);
      const completedEvent = execution.events.find(
        (event) => event.type === "tool.completed",
      );

      expect(types).toContain("tool.started");
      expect(types).toContain("tool.completed");
      // The step still reports itself, so a reader sees both layers.
      expect(types).toContain("step.started");
      expect(completedEvent?.data).toMatchObject({
        toolId: TEST_TOOL_ID,
        status: "succeeded",
      });
      expect(completedEvent?.stepId).toBe(execution.task.steps[0]?.id);
    });

    it("returns a failed execution rather than throwing when the tool fails", async () => {
      const registry = registryWith({
        execute: () => Promise.reject(new Error("the tool exploded")),
      });
      const provider = createStubModelProvider({
        script: toolScript(TEST_TOOL_ID),
      });

      const execution = await runAgent({
        objective: OBJECTIVE,
        provider,
        registry,
      });

      expect(execution.state.status).toBe("failed");
      expect(execution.task.steps[0]?.status).toBe("failed");
      expect(execution.task.steps[0]?.execution?.status).toBe("failed");
      expect(execution.result?.errors?.[0]?.code).toBe("tool_failed");
      expect(execution.result?.errors?.[0]?.stepId).toBe(
        execution.task.steps[0]?.id,
      );
      expect(execution.events.at(-1)?.type).toBe("execution.failed");
    });

    it("keeps a failed tool from taking an independent step down with it", async () => {
      const registry = registryWith({
        execute: () => Promise.reject(new Error("the tool exploded")),
      });
      const provider = createStubModelProvider({
        script: {
          plan: () => ({
            steps: [
              {
                description: "Use the echo capability.",
                expectedOutput: "An echo.",
                toolId: TEST_TOOL_ID,
              },
              {
                description: "Reason about it instead.",
                expectedOutput: "A conclusion.",
              },
            ],
          }),
          execute_step: () => ({ produced: "something" }),
          evaluate: () => ({ summary: "A summary of the run." }),
        },
      });

      const execution = await runAgent({
        objective: OBJECTIVE,
        provider,
        registry,
      });

      expect(execution.task.steps[0]?.status).toBe("failed");
      // Nothing depends on the failed call, so the run still produced this.
      expect(execution.task.steps[1]?.status).toBe("completed");
      expect(execution.events.map((event) => event.type)).toContain("tool.failed");
    });

    it("refuses a tool the run was not granted, without calling it", async () => {
      let called = false;

      const registry = registryWith({
        capabilities: ["network"],
        execute: () => {
          called = true;
          return Promise.resolve({ fetched: true });
        },
      });
      const provider = createStubModelProvider({
        script: toolScript(TEST_TOOL_ID),
      });

      const execution = await runAgent({
        objective: OBJECTIVE,
        provider,
        registry,
      });

      expect(called).toBe(false);
      expect(execution.result?.errors?.[0]?.code).toBe("tool_permission_denied");
      expect(execution.task.steps[0]?.execution?.status).toBe("failed");
    });

    it("calls a tool once its capability is granted to the run", async () => {
      const registry = registryWith({
        capabilities: ["network"],
        execute: () => Promise.resolve({ fetched: true }),
      });
      const provider = createStubModelProvider({
        script: toolScript(TEST_TOOL_ID),
      });

      const execution = await runAgent({
        objective: OBJECTIVE,
        provider,
        registry,
        tools: new ToolExecutor(registry, ToolPermission.only("network")),
      });

      expect(execution.state.status).toBe("completed");
      expect(execution.task.steps[0]?.execution?.output).toStrictEqual({
        fetched: true,
      });
    });

    it("reports input the tool's schema rejects without running the tool", async () => {
      let called = false;

      const registry = registryWith({
        inputSchema: z.object({ count: z.number() }),
        execute: () => {
          called = true;
          return Promise.resolve({});
        },
      });
      const provider = createStubModelProvider({
        // The planner proposed a string where the schema wants a number.
        script: toolScript(TEST_TOOL_ID, { count: "lots" }),
      });

      const execution = await runAgent({
        objective: OBJECTIVE,
        provider,
        registry,
      });

      expect(called).toBe(false);
      expect(execution.result?.errors?.[0]?.code).toBe("invalid_tool_input");
      expect(execution.task.steps[0]?.execution?.input).toBeUndefined();
    });

    it("runs the shipped text analysis tool through the default catalogue", async () => {
      const provider = createStubModelProvider({
        script: toolScript(TEXT_ANALYSIS_TOOL_ID, {
          text: "One two. Three.\n\nFour.",
        }),
      });

      // No tool dependencies injected: this is the catalogue a real run gets.
      const execution = await runAgent({ objective: OBJECTIVE, provider });

      expect(execution.state.status).toBe("completed");
      expect(execution.task.steps[0]?.execution?.toolVersion).toBe(
        TEXT_ANALYSIS_TOOL_VERSION,
      );
      expect(execution.task.steps[0]?.execution?.output).toStrictEqual({
        characters: 22,
        words: 4,
        sentences: 3,
        paragraphs: 2,
      });
    });

    it("reports a tool missing from the run's registry as unavailable", async () => {
      const provider = createStubModelProvider({
        // Names a tool this run's registry does not hold.
        script: toolScript("research.deep"),
      });

      const execution = await runAgent({
        objective: OBJECTIVE,
        provider,
        registry: createToolRegistry(),
      });

      expect(execution.result?.errors?.[0]?.code).toBe("capability_unavailable");
      expect(execution.task.steps[0]?.status).toBe("failed");
      // The refusal is recorded as a receipt too, so the step says which tool
      // was asked for as well as that it could not be supplied.
      expect(execution.task.steps[0]?.execution?.toolId).toBe("research.deep");
    });
  });
});
