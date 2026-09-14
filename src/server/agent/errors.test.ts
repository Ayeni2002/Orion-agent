import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentEngineError, describeError, toAgentExecutionError } from "./errors";
import { ModelProviderError } from "./provider/provider";

describe("toAgentExecutionError", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves the code and message of an engine error", () => {
    const converted = toAgentExecutionError(
      new AgentEngineError("capability_unavailable", "No such capability.", {
        stepId: "step_1",
        details: { toolId: "web.search" },
      }),
    );

    expect(converted).toStrictEqual({
      code: "capability_unavailable",
      message: "No such capability.",
      stepId: "step_1",
      details: { toolId: "web.search" },
    });
  });

  it("omits optional fields that were not supplied", () => {
    const converted = toAgentExecutionError(
      new AgentEngineError("planner_failed", "The planner failed."),
    );

    expect("stepId" in converted).toBe(false);
    expect("details" in converted).toBe(false);
  });

  it("maps a provider error to executor_failed", () => {
    const converted = toAgentExecutionError(
      new ModelProviderError("dev", "The provider is unavailable."),
    );

    expect(converted.code).toBe("executor_failed");
    expect(converted.message).toBe("The provider is unavailable.");
  });

  // The message of an unexpected error can embed the input that caused it, and
  // that value is returned to a client. Only the class name is safe to forward.
  it("replaces the message of an unexpected error", () => {
    const converted = toAgentExecutionError(
      new TypeError("Cannot read properties of undefined (reading 'apiKey')"),
    );

    expect(converted.code).toBe("internal_error");
    expect(converted.message).not.toContain("apiKey");
    expect(converted.details).toStrictEqual({ errorName: "TypeError" });
  });

  it("does not leak a credential-shaped value from an unexpected error", () => {
    const converted = toAgentExecutionError(
      new Error("request failed: Authorization: Bearer sk-live-abcdef123456"),
    );

    expect(JSON.stringify(converted)).not.toContain("sk-live-abcdef123456");
  });

  it("handles a thrown value that is not an Error", () => {
    const converted = toAgentExecutionError("just a string");

    expect(converted.code).toBe("internal_error");
    expect(converted.details).toStrictEqual({ errorName: "string" });
  });

  it("logs the original error server-side", () => {
    toAgentExecutionError(new Error("the real cause"));

    expect(console.error).toHaveBeenCalled();
  });
});

describe("describeError", () => {
  it("joins the code and the message", () => {
    expect(
      describeError({ code: "invalid_plan", message: "The plan was malformed." }),
    ).toBe("invalid_plan: The plan was malformed.");
  });
});

describe("AgentEngineError", () => {
  it("reports its own name", () => {
    expect(new AgentEngineError("internal_error", "x").name).toBe(
      "AgentEngineError",
    );
  });

  it("preserves codes that callers switch on", () => {
    const codes = [
      "invalid_objective",
      "planner_failed",
      "invalid_plan",
      "executor_failed",
      "capability_unavailable",
      "evaluation_failed",
      "iteration_limit_reached",
      "internal_error",
      "cancelled",
    ] as const;

    for (const code of codes) {
      expect(new AgentEngineError(code, "x").code).toBe(code);
    }
  });
});
