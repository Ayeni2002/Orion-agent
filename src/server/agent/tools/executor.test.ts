import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { ToolReceipt } from "./definition";
import { ToolPermission } from "./definition";
import { ToolExecutor } from "./executor";
import { createToolRegistry } from "./registry";
import { createTestTool, TEST_TOOL_ID } from "./testing";

const EXECUTION_ID = "exec_test";
const TASK_ID = "task_test";
const STEP_ID = "step_test";

function request(overrides: { toolId?: string; input?: unknown } = {}) {
  return {
    toolId: overrides.toolId ?? TEST_TOOL_ID,
    input: overrides.input ?? {},
    executionId: EXECUTION_ID,
    taskId: TASK_ID,
    stepId: STEP_ID,
    objective: "Measure the supplied text.",
  };
}

/** A registry holding one default test tool, plus the executor that runs it. */
function harness(options: {
  permission?: ToolPermission;
  register?: (registry: ReturnType<typeof createToolRegistry>) => void;
} = {}) {
  const registry = createToolRegistry();

  if (options.register === undefined) {
    registry.register(createTestTool());
  } else {
    options.register(registry);
  }

  return {
    registry,
    executor: new ToolExecutor(registry, options.permission),
  };
}

describe("ToolExecutor", () => {
  beforeEach(() => {
    // A failing tool is logged server-side on purpose. Silenced so a passing
    // suite stays readable; the behaviour is asserted instead.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("executes a permitted tool and records its output", async () => {
    const { executor } = harness({
      register: (registry) =>
        registry.register(
          createTestTool({ execute: () => Promise.resolve({ echoed: true }) }),
        ),
    });

    const receipt = await executor.execute(request());

    expect(receipt.status).toBe("succeeded");
    expect(receipt.output).toStrictEqual({ echoed: true });
    expect(receipt.error).toBeUndefined();
  });

  it("records the run identifiers, tool id and version on the receipt", async () => {
    const { executor } = harness();

    const receipt = await executor.execute(request());

    expect(receipt).toMatchObject({
      executionId: EXECUTION_ID,
      taskId: TASK_ID,
      stepId: STEP_ID,
      toolId: TEST_TOOL_ID,
      toolVersion: "1.0.0",
      status: "succeeded",
    });
    expect(receipt.id).toMatch(/^tool_/);
  });

  it("records the validated input rather than the raw input", async () => {
    const { executor } = harness({
      register: (registry) =>
        registry.register(
          createTestTool({
            // Strips anything the schema does not name, so the receipt shows
            // what the tool was actually given.
            inputSchema: z.object({ keep: z.string() }),
          }),
        ),
    });

    const receipt = await executor.execute(
      request({ input: { keep: "yes", drop: "no" } }),
    );

    expect(receipt.input).toStrictEqual({ keep: "yes" });
  });

  it("passes the permission and context through to the tool", async () => {
    let seen: Record<string, unknown> | undefined;

    const { executor } = harness({
      register: (registry) =>
        registry.register(
          createTestTool({
            execute: (_input, context) => {
              seen = { ...context };
              return Promise.resolve({});
            },
          }),
        ),
    });

    await executor.execute(request());

    expect(seen).toMatchObject({
      executionId: EXECUTION_ID,
      taskId: TASK_ID,
      stepId: STEP_ID,
      toolId: TEST_TOOL_ID,
      objective: "Measure the supplied text.",
      grantedCapabilities: ["read_only"],
    });
  });

  it("reports an unregistered tool as an unavailable capability", async () => {
    const { executor } = harness();

    const receipt = await executor.execute(request({ toolId: "web.search" }));

    expect(receipt.status).toBe("failed");
    expect(receipt.error?.code).toBe("capability_unavailable");
    expect(receipt.error?.stepId).toBe(STEP_ID);
    // The engine's Phase 3 contract for this case, unchanged.
    expect(receipt.error?.details?.registered).toStrictEqual([TEST_TOOL_ID]);
  });

  it("refuses input that does not match the tool's schema", async () => {
    let called = false;

    const { executor } = harness({
      register: (registry) =>
        registry.register(
          createTestTool({
            inputSchema: z.object({ count: z.number() }),
            execute: () => {
              called = true;
              return Promise.resolve({});
            },
          }),
        ),
    });

    const receipt = await executor.execute(request({ input: { count: "lots" } }));

    expect(receipt.status).toBe("failed");
    expect(receipt.error?.code).toBe("invalid_tool_input");
    // Validation happens before the tool, so nothing ran on bad input.
    expect(called).toBe(false);
  });

  it("reports which fields were rejected and the shape of the input", async () => {
    const { executor } = harness({
      register: (registry) =>
        registry.register(
          createTestTool({ inputSchema: z.object({ count: z.number() }) }),
        ),
    });

    const receipt = await executor.execute(request({ input: { count: "lots" } }));
    const details = receipt.error?.details ?? {};

    expect(details.keys).toStrictEqual(["count"]);
    expect(Array.isArray(details.issues)).toBe(true);
    expect(details.issues).not.toHaveLength(0);
  });

  it("does not record the rejected payload itself", async () => {
    const { executor } = harness({
      register: (registry) =>
        registry.register(
          createTestTool({ inputSchema: z.object({ count: z.number() }) }),
        ),
    });

    const receipt = await executor.execute(
      request({ input: { count: "lots", secret: "not-recorded" } }),
    );

    // The untrusted payload is unbounded; only its shape is kept.
    expect(receipt.input).toBeUndefined();
    expect(JSON.stringify(receipt)).not.toContain("not-recorded");
  });

  it("refuses a tool the run was not granted, without running it", async () => {
    let called = false;

    const { executor } = harness({
      register: (registry) =>
        registry.register(
          createTestTool({
            capabilities: ["network"],
            execute: () => {
              called = true;
              return Promise.resolve({});
            },
          }),
        ),
    });

    const receipt = await executor.execute(request());

    expect(receipt.status).toBe("failed");
    expect(receipt.error?.code).toBe("tool_permission_denied");
    expect(receipt.error?.details?.missing).toStrictEqual(["network"]);
    // Permission is checked before validation, so the schema never even saw
    // untrusted input.
    expect(called).toBe(false);
  });

  it("runs a tool once the capability is granted", async () => {
    const { executor } = harness({
      permission: ToolPermission.only("network"),
      register: (registry) =>
        registry.register(
          createTestTool({
            capabilities: ["network"],
            execute: () => Promise.resolve({ fetched: true }),
          }),
        ),
    });

    const receipt = await executor.execute(request());

    expect(receipt.status).toBe("succeeded");
    expect(receipt.output).toStrictEqual({ fetched: true });
  });

  it("turns a throwing tool into a structured failure rather than an exception", async () => {
    const { executor } = harness({
      register: (registry) =>
        registry.register(
          createTestTool({
            execute: () => Promise.reject(new Error("the tool exploded")),
          }),
        ),
    });

    const receipt = await executor.execute(request());

    expect(receipt.status).toBe("failed");
    expect(receipt.error?.code).toBe("tool_failed");
    expect(receipt.error?.stepId).toBe(STEP_ID);
  });

  it("keeps a tool's exception out of the receipt", async () => {
    const { executor } = harness({
      register: (registry) =>
        registry.register(
          createTestTool({
            execute: () =>
              Promise.reject(new Error("failed while holding sk-secret-value")),
          }),
        ),
    });

    const receipt = await executor.execute(request());

    // A tool's message can embed whatever it was working on, and this receipt
    // is returned to a client.
    expect(JSON.stringify(receipt)).not.toContain("sk-secret-value");
  });

  it("fails a tool that returns something that is not an object", async () => {
    const { executor } = harness({
      register: (registry) =>
        registry.register(
          createTestTool({
            // Typed as returning an object; JavaScript disagrees.
            execute: (() => Promise.resolve("just a string")) as never,
          }),
        ),
    });

    const receipt = await executor.execute(request());

    expect(receipt.status).toBe("failed");
    expect(receipt.error?.code).toBe("tool_failed");
  });

  it("never throws for any failure it can report", async () => {
    const { executor } = harness({
      register: (registry) => {
        registry.register(createTestTool({ id: "throws.tool", execute: () => Promise.reject(new Error("no")) }));
        registry.register(createTestTool({ id: "strict.tool", capabilities: ["data_access"] }));
      },
    });

    const cases = [
      request({ toolId: "no.such.tool" }),
      request({ toolId: "throws.tool" }),
      request({ toolId: "strict.tool" }),
      request({ input: "not an object at all" }),
    ];

    for (const each of cases) {
      const receipt: ToolReceipt = await executor.execute(each);
      expect(receipt.status).toBe("failed");
      expect(receipt.error).toBeDefined();
    }
  });

  it("stamps every receipt with ISO timestamps that bracket the call", async () => {
    const { executor } = harness();

    const receipt = await executor.execute(request());

    const startedAt = receipt.startedAt ?? "";
    const finishedAt = receipt.finishedAt ?? "";

    expect(new Date(startedAt).toISOString()).toBe(startedAt);
    expect(new Date(finishedAt).toISOString()).toBe(finishedAt);
    expect(Date.parse(finishedAt)).toBeGreaterThanOrEqual(Date.parse(startedAt));
  });

  it("serialises to JSON without loss", async () => {
    const { executor } = harness({
      register: (registry) =>
        registry.register(
          createTestTool({ execute: () => Promise.resolve({ count: 3 }) }),
        ),
    });

    const receipt = await executor.execute(request());
    const roundTripped = JSON.parse(JSON.stringify(receipt)) as ToolReceipt;

    expect(roundTripped).toStrictEqual(receipt);
  });
});
