import { beforeEach, describe, expect, it } from "vitest";

import type { AgentExecution } from "@/types/agent";
import {
  MAX_RETAINED_EXECUTIONS,
  clearExecutions,
  getExecution,
  listExecutions,
  saveExecution,
} from "./store";

function executionWith(id: string): AgentExecution {
  const timestamp = new Date().toISOString();

  return {
    id,
    task: {
      id: `task_${id}`,
      agentId: "orion",
      objective: "An objective.",
      status: "completed",
      steps: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    state: {
      executionId: id,
      objective: "An objective.",
      status: "completed",
      completedStepIds: [],
      observations: [],
      errors: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    events: [],
    provider: {
      id: "dev",
      label: "Deterministic development adapter (no external model)",
      model: "orion-dev-deterministic",
      isExternal: false,
    },
  };
}

describe("execution store", () => {
  beforeEach(() => {
    clearExecutions();
  });

  it("returns what was saved", () => {
    saveExecution(executionWith("exec_one"));

    expect(getExecution("exec_one")?.id).toBe("exec_one");
  });

  it("returns undefined for an unknown id", () => {
    expect(getExecution("exec_missing")).toBeUndefined();
  });

  it("replaces an execution saved under the same id", () => {
    const execution = executionWith("exec_one");

    saveExecution(execution);
    saveExecution({ ...execution, state: { ...execution.state, status: "failed" } });

    expect(getExecution("exec_one")?.state.status).toBe("failed");
    expect(listExecutions()).toHaveLength(1);
  });

  it("lists the most recently written execution first", () => {
    saveExecution(executionWith("exec_first"));
    saveExecution(executionWith("exec_second"));

    expect(listExecutions().map((execution) => execution.id)).toStrictEqual([
      "exec_second",
      "exec_first",
    ]);
  });

  it("returns a copy of the list, not the live collection", () => {
    saveExecution(executionWith("exec_one"));

    listExecutions().push(executionWith("exec_two"));

    expect(listExecutions()).toHaveLength(1);
  });

  it("evicts the oldest executions once the cap is reached", () => {
    const total = MAX_RETAINED_EXECUTIONS + 5;

    for (let index = 0; index < total; index += 1) {
      saveExecution(executionWith(`exec_${index}`));
    }

    expect(listExecutions()).toHaveLength(MAX_RETAINED_EXECUTIONS);
    // The first five are gone; the rest survive.
    expect(getExecution("exec_0")).toBeUndefined();
    expect(getExecution("exec_4")).toBeUndefined();
    expect(getExecution("exec_5")).toBeDefined();
    expect(getExecution(`exec_${total - 1}`)).toBeDefined();
  });

  it("empties the store on clear", () => {
    saveExecution(executionWith("exec_one"));
    clearExecutions();

    expect(listExecutions()).toStrictEqual([]);
  });
});
