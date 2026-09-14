import type { AgentExecutionError, AgentTask } from "@/types/agent";
import { parseModelJson, type ModelProvider } from "../provider";

/**
 * The evaluator: decides whether the run met the objective, and says why.
 *
 * A deliberate split runs through this module. The **status** is computed here,
 * deterministically, from what the steps actually did — no model is consulted
 * and no model can influence it. The **narrative** is requested from the
 * provider, because explaining a result in prose is exactly what a model is for.
 *
 * The split matters because a run's verdict is a fact about the run. Letting a
 * model decide it would make the same execution capable of being reported as
 * both a success and a failure, and would give model output the authority to
 * mark work complete — which the brief rules out.
 *
 * A narrative failure is non-fatal. The status is already known, the
 * observations are already recorded, and losing the prose explains nothing and
 * destroys an otherwise sound result. The caller is told it happened via
 * `narrativeGenerated` so it can be surfaced rather than hidden.
 */

const EVALUATOR_INSTRUCTION = [
  "Summarise the outcome of the execution described below, for a person reading the result.",
  "Respond with JSON only: {\"summary\":\"...\",\"confidence\":\"high\"|\"medium\"|\"low\"}",
  "Describe only what the recorded step outcomes support. Do not claim work was done that the outcomes do not show.",
].join("\n");

export interface EvaluateParams {
  task: AgentTask;
  objective: string;
  provider: ModelProvider;
  /** Failures already recorded by the executor. Never re-derived here. */
  errors: AgentExecutionError[];
}

export interface EvaluationOutcome {
  status: "completed" | "failed";
  summary: string;
  /** False when the provider could not supply a narrative and the computed one stands. */
  narrativeGenerated: boolean;
  errors: AgentExecutionError[];
}

/** Reads a string field from parsed model output, or returns undefined. */
function readString(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.trim().length > 0
    ? field.trim()
    : undefined;
}

function countByStatus(task: AgentTask, status: string): number {
  return task.steps.filter((step) => step.status === status).length;
}

export async function evaluateExecution({
  task,
  objective,
  provider,
  errors,
}: EvaluateParams): Promise<EvaluationOutcome> {
  const completed = countByStatus(task, "completed");
  const failed = countByStatus(task, "failed");
  const skipped = countByStatus(task, "skipped");
  const total = task.steps.length;

  // Completed means every step that ran succeeded, and at least one did. A run
  // in which nothing succeeded — every step failed, or everything was skipped
  // after cancellation — did not meet its objective, whatever the reason.
  const status: "completed" | "failed" =
    failed === 0 && completed > 0 ? "completed" : "failed";

  let summary: string;

  if (completed === 0 && failed === 0) {
    summary = `No steps ran; ${skipped} of ${total} step(s) were skipped.`;
  } else {
    const parts = [`${completed} of ${total} step(s) completed`];
    if (failed > 0) parts.push(`${failed} failed`);
    if (skipped > 0) parts.push(`${skipped} skipped`);
    summary = `${parts.join(", ")}.`;
  }

  let narrativeGenerated = false;

  try {
    const response = await provider.generate({
      operation: "evaluate",
      instruction: EVALUATOR_INSTRUCTION,
      context: {
        objective,
        stepOutcomes: task.steps.map((step) => step.status),
        completedCount: completed,
        failedCount: failed,
        skippedCount: skipped,
        failures: errors.map((error) => error.code),
      },
      responseFormat: "json",
    });

    const parsed = parseModelJson(response);

    if (parsed.ok) {
      const generated = readString(parsed.value, "summary");

      if (generated !== undefined) {
        summary = generated;
        narrativeGenerated = true;
      }
    }
  } catch (error) {
    // Swallowed on purpose — see the module comment. The failure is reported
    // through `narrativeGenerated`, and the computed summary already stands.
    console.error("[agent] evaluator narrative failed:", error);
  }

  return { status, summary, narrativeGenerated, errors };
}
