import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentTask, StepStatus } from "@/types/agent";
import { createStubModelProvider } from "../provider/stub-provider";
import { evaluateExecution } from "./index";

/** A task whose steps already carry the statuses the executor would have set. */
function taskWith(statuses: StepStatus[]): AgentTask {
  const timestamp = new Date().toISOString();

  return {
    id: "task_1",
    agentId: "orion",
    objective: "An objective.",
    status: "running",
    steps: statuses.map((status, index) => ({
      id: `step_${index}`,
      taskId: "task_1",
      index,
      description: `Step number ${index + 1}.`,
      status,
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe("evaluateExecution", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports a run where every step completed as completed", async () => {
    const provider = createStubModelProvider({
      script: { evaluate: () => ({ summary: "All good." }) },
    });

    const outcome = await evaluateExecution({
      task: taskWith(["completed", "completed"]),
      objective: "An objective.",
      provider,
      errors: [],
    });

    expect(outcome.status).toBe("completed");
  });

  it("reports a run with a failed step as failed", async () => {
    const provider = createStubModelProvider({
      script: { evaluate: () => ({ summary: "All good." }) },
    });

    const outcome = await evaluateExecution({
      task: taskWith(["completed", "failed"]),
      objective: "An objective.",
      provider,
      errors: [],
    });

    expect(outcome.status).toBe("failed");
  });

  it("reports a run where nothing ran as failed", async () => {
    const provider = createStubModelProvider({
      script: { evaluate: () => ({ summary: "Nothing happened." }) },
    });

    const outcome = await evaluateExecution({
      task: taskWith(["skipped", "skipped"]),
      objective: "An objective.",
      provider,
      errors: [],
    });

    expect(outcome.status).toBe("failed");
  });

  // The verdict is a fact about the run, so a model cannot talk it round. This
  // is the property that stops model output from marking work complete.
  it("ignores a narrative that contradicts the recorded outcomes", async () => {
    const provider = createStubModelProvider({
      script: {
        evaluate: () => ({
          summary: "Every step succeeded and the objective is fully met.",
          confidence: "high",
        }),
      },
    });

    const outcome = await evaluateExecution({
      task: taskWith(["failed", "skipped"]),
      objective: "An objective.",
      provider,
      errors: [],
    });

    expect(outcome.status).toBe("failed");
  });

  it("uses the provider's summary when one is produced", async () => {
    const provider = createStubModelProvider({
      script: { evaluate: () => ({ summary: "A model-written summary." }) },
    });

    const outcome = await evaluateExecution({
      task: taskWith(["completed"]),
      objective: "An objective.",
      provider,
      errors: [],
    });

    expect(outcome.summary).toBe("A model-written summary.");
    expect(outcome.narrativeGenerated).toBe(true);
  });

  it("falls back to a computed summary when the provider fails", async () => {
    const provider = createStubModelProvider({
      script: {
        evaluate: () => {
          throw new Error("the narrative model is unavailable");
        },
      },
    });

    const outcome = await evaluateExecution({
      task: taskWith(["completed", "failed", "skipped"]),
      objective: "An objective.",
      provider,
      errors: [],
    });

    expect(outcome.narrativeGenerated).toBe(false);
    expect(outcome.summary).toContain("1 of 3 step(s) completed");
    expect(outcome.summary).toContain("1 failed");
    expect(outcome.summary).toContain("1 skipped");
    // The verdict survives losing the prose.
    expect(outcome.status).toBe("failed");
  });

  it("falls back to a computed summary when the provider returns non-JSON", async () => {
    const provider = createStubModelProvider({
      script: { evaluate: () => "Here is my assessment: it went well." },
    });

    const outcome = await evaluateExecution({
      task: taskWith(["completed"]),
      objective: "An objective.",
      provider,
      errors: [],
    });

    expect(outcome.narrativeGenerated).toBe(false);
    expect(outcome.summary).toContain("1 of 1 step(s) completed");
  });

  it("keeps the errors it was given", async () => {
    const provider = createStubModelProvider({
      script: { evaluate: () => ({ summary: "A summary." }) },
    });

    const errors = [
      { code: "executor_failed" as const, message: "A step failed." },
    ];

    const outcome = await evaluateExecution({
      task: taskWith(["failed"]),
      objective: "An objective.",
      provider,
      errors,
    });

    expect(outcome.errors).toStrictEqual(errors);
  });

  it("tells the provider how many steps reached each outcome", async () => {
    const contexts: Record<string, unknown>[] = [];

    const provider = createStubModelProvider({
      script: {
        evaluate: (context) => {
          contexts.push(context);
          return { summary: "A summary." };
        },
      },
    });

    await evaluateExecution({
      task: taskWith(["completed", "completed", "failed", "skipped"]),
      objective: "An objective.",
      provider,
      errors: [],
    });

    expect(contexts[0]).toMatchObject({
      completedCount: 2,
      failedCount: 1,
      skippedCount: 1,
    });
  });
});
