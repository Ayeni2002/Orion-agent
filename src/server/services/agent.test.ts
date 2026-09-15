import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearExecutions } from "../agent";
import { ServiceError } from "../errors";
import {
  getEngineCapabilities,
  getExecutionById,
  listRecentExecutionSummaries,
  startExecution,
  toExecutionSummary,
} from "./agent";

/** Long enough to pass the objective schema, and asking for nothing external. */
const REASONING_OBJECTIVE =
  "Compare the trade-offs between two approaches to grid-scale storage.";

/** Asks for information from outside Orion, which Phase 3 cannot supply. */
const RESEARCH_OBJECTIVE =
  "Search the web for recent battery storage prices and summarise the findings.";

function statusOf(error: unknown): number | undefined {
  return error instanceof ServiceError ? error.status : undefined;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("startExecution", () => {
  beforeEach(() => {
    clearExecutions();
    // Deterministic regardless of the machine it runs on. An empty value falls
    // back to the development provider, which needs no credentials.
    vi.stubEnv("LLM_API_STYLE", "");
  });

  it("runs an objective and returns the finished execution", async () => {
    const execution = await startExecution({ objective: REASONING_OBJECTIVE });

    expect(execution.state.status).toBe("completed");
    expect(execution.task.objective).toBe(REASONING_OBJECTIVE);
    expect(execution.task.steps.length).toBeGreaterThan(0);
  });

  it("reports the development adapter rather than implying a model ran", async () => {
    const execution = await startExecution({ objective: REASONING_OBJECTIVE });

    expect(execution.provider.isExternal).toBe(false);
    expect(execution.provider.id).toBe("dev");
  });

  it("trims the objective before running it", async () => {
    const execution = await startExecution({
      objective: `   ${REASONING_OBJECTIVE}   `,
    });

    expect(execution.task.objective).toBe(REASONING_OBJECTIVE);
  });

  it("rejects an objective that is too short", async () => {
    const error = await startExecution({ objective: "short" }).catch(
      (thrown: unknown) => thrown,
    );

    expect(statusOf(error)).toBe(400);
  });

  it("rejects a missing objective", async () => {
    const error = await startExecution({}).catch((thrown: unknown) => thrown);

    expect(statusOf(error)).toBe(400);
  });

  it("rejects a body that is not an object", async () => {
    for (const body of [null, "an objective", 42, []]) {
      const error = await startExecution(body).catch((thrown: unknown) => thrown);

      expect(statusOf(error)).toBe(400);
    }
  });

  it("rejects an objective that is too long", async () => {
    const error = await startExecution({ objective: "a".repeat(2001) }).catch(
      (thrown: unknown) => thrown,
    );

    expect(statusOf(error)).toBe(400);
  });

  it("reports a capability the engine lacks instead of inventing a result", async () => {
    const execution = await startExecution({ objective: RESEARCH_OBJECTIVE });

    expect(execution.state.status).toBe("failed");
    expect(
      execution.result?.errors?.some(
        (resultError) => resultError.code === "capability_unavailable",
      ),
    ).toBe(true);
  });

  // The security property the brief requires: there is no field a client can
  // send that decides whether work was done. Extra keys are stripped by the
  // schema, and the status is produced by the engine from what actually ran.
  it("ignores client-supplied execution state", async () => {
    const execution = await startExecution({
      objective: RESEARCH_OBJECTIVE,
      status: "completed",
      result: { status: "completed", summary: "Everything succeeded." },
      steps: [{ id: "forged", status: "completed" }],
      completedStepIds: ["forged"],
    });

    expect(execution.result?.status).toBe("failed");
    expect(execution.state.completedStepIds).not.toContain("forged");
    expect(execution.task.steps.some((step) => step.id === "forged")).toBe(false);
  });

  it("makes a stored execution readable afterwards", async () => {
    const execution = await startExecution({ objective: REASONING_OBJECTIVE });

    expect(getExecutionById(execution.id).id).toBe(execution.id);
  });
});

describe("getExecutionById", () => {
  beforeEach(() => {
    clearExecutions();
  });

  it("reports an unknown id as not found", () => {
    const error = (() => {
      try {
        getExecutionById("exec_missing");
        return undefined;
      } catch (thrown: unknown) {
        return thrown;
      }
    })();

    expect(statusOf(error)).toBe(404);
  });
});

describe("listRecentExecutionSummaries", () => {
  beforeEach(() => {
    clearExecutions();
    vi.stubEnv("LLM_API_STYLE", "");
  });

  it("returns nothing before anything has run", () => {
    expect(listRecentExecutionSummaries()).toStrictEqual([]);
  });

  it("summarises a run without its plan, events or observations", async () => {
    const execution = await startExecution({ objective: REASONING_OBJECTIVE });

    const [summary] = listRecentExecutionSummaries();

    expect(summary?.id).toBe(execution.id);
    expect(summary?.objective).toBe(REASONING_OBJECTIVE);
    expect(summary?.stepCount).toBe(execution.task.steps.length);
    expect(summary).not.toHaveProperty("events");
    expect(summary).not.toHaveProperty("task");
  });

  it("carries the provider so a list cannot misattribute a run", async () => {
    await startExecution({ objective: REASONING_OBJECTIVE });

    expect(listRecentExecutionSummaries()[0]?.provider.isExternal).toBe(false);
  });
});

describe("toExecutionSummary", () => {
  beforeEach(() => {
    clearExecutions();
    vi.stubEnv("LLM_API_STYLE", "");
  });

  it("omits a finished timestamp and summary while a run is unfinished", async () => {
    const execution = await startExecution({ objective: REASONING_OBJECTIVE });

    const summary = toExecutionSummary({
      ...execution,
      state: { ...execution.state, finishedAt: undefined },
      result: undefined,
    });

    expect("finishedAt" in summary).toBe(false);
    expect("summary" in summary).toBe(false);
  });
});

describe("getEngineCapabilities", () => {
  beforeEach(() => {
    vi.stubEnv("LLM_API_STYLE", "");
  });

  it("reports the development provider", () => {
    const capabilities = getEngineCapabilities();

    expect(capabilities.provider?.id).toBe("dev");
    expect(capabilities.provider?.isExternal).toBe(false);
    expect(capabilities.configurationError).toBeUndefined();
  });

  // Phase 4 gave the engine a catalogue, so this now names it. Reporting an
  // empty list would be a claim about the build that is no longer true — and
  // saying what is registered up front is what lets the workspace warn before a
  // run rather than only after a step is refused.
  it("reports the registered tools", () => {
    expect(getEngineCapabilities().registeredTools).toStrictEqual([
      "text.analyze",
    ]);
  });

  it("reports a configuration problem as data rather than throwing", () => {
    vi.stubEnv("LLM_API_STYLE", "a-style-that-does-not-exist");

    const capabilities = getEngineCapabilities();

    expect(capabilities.provider).toBeNull();
    expect(capabilities.configurationError).toContain("LLM_API_STYLE");
  });
});
