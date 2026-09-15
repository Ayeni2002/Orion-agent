import { describe, expect, it } from "vitest";

import { DEFAULT_TOOL_PERMISSION, type ToolExecutionContext } from "./definition";
import { createToolRegistry } from "./registry";
import { createTestTool, TEST_TOOL_ID } from "./testing";

function context(
  grantedCapabilities: ToolExecutionContext["grantedCapabilities"] = DEFAULT_TOOL_PERMISSION.list(),
): ToolExecutionContext {
  return {
    executionId: "exec_test",
    taskId: "task_test",
    stepId: "step_test",
    toolId: TEST_TOOL_ID,
    objective: "An objective.",
    startedAt: new Date().toISOString(),
    grantedCapabilities,
  };
}

describe("ToolRegistry", () => {
  it("registers a tool and retrieves it by id", () => {
    const registry = createToolRegistry();
    const tool = createTestTool();

    registry.register(tool);

    expect(registry.get(TEST_TOOL_ID)).toBe(tool);
    expect(registry.size).toBe(1);
  });

  it("reports whether a tool is registered", () => {
    const registry = createToolRegistry();
    registry.register(createTestTool());

    expect(registry.has(TEST_TOOL_ID)).toBe(true);
    expect(registry.has("no.such.tool")).toBe(false);
  });

  it("returns undefined for an unknown tool rather than throwing", () => {
    const registry = createToolRegistry();

    expect(registry.get("no.such.tool")).toBeUndefined();
  });

  it("lists registered ids in registration order", () => {
    const registry = createToolRegistry();
    registry.register(createTestTool({ id: "first.tool" }));
    registry.register(createTestTool({ id: "second.tool" }));

    expect(registry.ids()).toStrictEqual(["first.tool", "second.tool"]);
  });

  it("lists metadata with the executable parts removed", () => {
    const registry = createToolRegistry();
    registry.register(
      createTestTool({ id: "meta.tool", name: "Meta", description: "Described." }),
    );

    const [listed] = registry.list();

    expect(listed).toStrictEqual({
      id: "meta.tool",
      name: "Meta",
      description: "Described.",
      version: "1.0.0",
      capabilities: ["read_only"],
    });
    // The two fields that must never leave the engine.
    expect(listed).not.toHaveProperty("execute");
    expect(listed).not.toHaveProperty("inputSchema");
  });

  it("refuses a duplicate id instead of overwriting", () => {
    const registry = createToolRegistry();
    registry.register(createTestTool({ id: "dupe.tool" }));

    expect(() => registry.register(createTestTool({ id: "dupe.tool" }))).toThrow(
      /already registered/,
    );
  });

  it("refuses a tool that declares no capabilities", () => {
    const registry = createToolRegistry();

    // Deny-by-default would read "declares nothing" as "needs nothing", which
    // is the assumption worth refusing to make.
    expect(() =>
      registry.register(createTestTool({ id: "silent.tool", capabilities: [] })),
    ).toThrow(/declares no capabilities/);
  });

  describe("canExecute", () => {
    it("permits a tool whose capabilities are all granted", () => {
      const registry = createToolRegistry();
      const tool = createTestTool({ capabilities: ["read_only"] });
      registry.register(tool);

      expect(registry.canExecute(tool, context(["read_only"]))).toBe(true);
    });

    it("refuses a tool when one of its capabilities is not granted", () => {
      const registry = createToolRegistry();
      const tool = createTestTool({ capabilities: ["read_only", "network"] });
      registry.register(tool);

      expect(registry.canExecute(tool, context(["read_only"]))).toBe(false);
    });

    it("refuses everything when nothing is granted", () => {
      const registry = createToolRegistry();
      const tool = createTestTool({ capabilities: ["read_only"] });
      registry.register(tool);

      expect(registry.canExecute(tool, context([]))).toBe(false);
    });

    it("refuses a definition this registry does not hold", () => {
      const registry = createToolRegistry();

      // Same id, but never registered. Executing it because it claims a
      // registered id would make registration advisory rather than a control.
      const impostor = createTestTool({ id: TEST_TOOL_ID });

      expect(registry.canExecute(impostor, context(["read_only"]))).toBe(false);
    });
  });
});
