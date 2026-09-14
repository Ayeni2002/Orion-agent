import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentEventType, ExecutionStatus } from "@/types/agent";
import { AgentEngineError } from "../errors";
import { createToolRegistry } from "../executor/registry";
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

    registry.register({
      id: "test.echo",
      name: "Echo",
      description: "Returns a fixed payload.",
      run: () => Promise.resolve({ echoed: true }),
    });

    const provider = createStubModelProvider({
      script: {
        plan: () => ({
          steps: [
            {
              description: "Use the echo capability.",
              expectedOutput: "An echo.",
              toolId: "test.echo",
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
    vi.stubEnv("ORION_LLM_PROVIDER", "some-other-vendor");

    const execution = await runAgent({ objective: OBJECTIVE });

    expect(execution.state.status).toBe("failed");
    expect(execution.result?.errors?.[0]?.code).toBe("internal_error");
    expect(execution.result?.errors?.[0]?.message).toContain("ORION_LLM_PROVIDER");
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
});
