import type { AgentExecutionError } from "@/types/agent";
import type {
  ResearchConflict,
  ResearchEvidence,
  ResearchFinding,
  ResearchLimitKind,
  ResearchSource,
  ResearchSufficiency,
  ResearchTask,
} from "@/types/research";

import { describeLimit } from "./describe-limit";

/**
 * The research evaluator: what the run actually established.
 *
 * §15 asks for one of four verdicts, and this module is the whole of how they
 * are decided.
 *
 * **It is deterministic, and that is a design position rather than a
 * simplification.** The obvious alternative is to ask the model whether its own
 * findings are sufficient. That would be asking a party to the work to mark it,
 * and the answer would be a claim about the evidence rather than a fact about
 * it. Everything this verdict depends on is already recorded and countable —
 * whether retrieval happened, how many sources came back, how many claims passed
 * quote verification, whether sources disagreed, which ceilings were hit — so the
 * verdict can be computed from the record instead of requested from a model.
 * The benefit is not only honesty: it means a run's sufficiency is reproducible,
 * testable without any provider, and unchanged by which model happened to serve
 * the extraction step.
 *
 * **Precedence, and why it is this order.** `failed` first, because a run that
 * could not carry out research has no evidence to judge. Then `conflicting`,
 * because a disagreement between source-backed findings is the most specific
 * and most actionable thing that can be said about a result — and it cannot be
 * reached unless retrieval happened and claims passed verification, so it never
 * masks a weaker outcome. Then `sufficient`, which requires every condition to
 * hold. `insufficient` is the remainder, and it is not a failure: it is the
 * honest report of a completed run that did not establish enough.
 *
 * **What rules out `sufficient`.** Every one of these is a fact about the run:
 *
 *   - retrieval did not happen, or returned nothing;
 *   - no claim could be traced to retrieved text, so everything in the result is
 *     the model's own inference;
 *   - a task in the plan failed, so something the plan identified as necessary
 *     was never established;
 *   - a limit was reached, so the run stopped before it had finished the work it
 *     set out to do.
 *
 * That last one is deliberately strict. A run cut short at fifty findings may
 * well have answered the question, but it did not finish looking, and calling
 * that `sufficient` would tell a reader the search was complete when it was
 * stopped. The limit is named in the summary, so nothing is hidden behind the
 * verdict.
 */

export interface ResearchEvaluationInput {
  question: string;
  tasks: readonly ResearchTask[];
  sources: readonly ResearchSource[];
  findings: readonly ResearchFinding[];
  evidence: readonly ResearchEvidence[];
  conflicts: readonly ResearchConflict[];
  errors: readonly AgentExecutionError[];
  /** Whether any search call actually reached a retrieval service. */
  performedRetrieval: boolean;
  /** The ceilings this run hit. Empty when it stayed inside all of them. */
  limitsReached: readonly ResearchLimitKind[];
  /** Whether the run was stopped before it finished. */
  cancelled: boolean;
}

export interface ResearchEvaluation {
  sufficiency: ResearchSufficiency;
  /** One or two sentences. Every clause here is a count or a recorded fact. */
  summary: string;
  /** The run's errors, carried through so a caller gets them with the verdict. */
  errors: AgentExecutionError[];
}

/** `"3 findings"` / `"1 finding"`. Keeps the summary readable without a plural library. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function evaluateResearch({
  question,
  tasks,
  sources,
  findings,
  evidence,
  conflicts,
  errors,
  performedRetrieval,
  limitsReached,
  cancelled,
}: ResearchEvaluationInput): ResearchEvaluation {
  const sourceBacked = findings.filter((finding) => finding.basis === "source");
  const failedTasks = tasks.filter((task) => task.status === "failed");
  const completedTasks = tasks.filter((task) => task.status === "completed");

  const failed = (summary: string): ResearchEvaluation => ({
    sufficiency: "failed",
    summary,
    errors: [...errors],
  });

  if (cancelled) {
    return failed(
      "The research was cancelled before it finished, so the question was not answered.",
    );
  }

  if (tasks.length === 0) {
    return failed(
      "The research produced no tasks, so nothing was looked up and the question was not answered.",
    );
  }

  // Every task failing is a malfunction, not a thin result. One task failing is
  // a gap, and is reported below as a reason the run is insufficient.
  if (completedTasks.length === 0) {
    return failed(
      `All ${plural(tasks.length, "task")} in the plan failed, so no research was carried out.`,
    );
  }

  const shortfalls: string[] = [];

  if (!performedRetrieval) {
    shortfalls.push("no retrieval was performed");
  }

  if (sources.length === 0) {
    shortfalls.push("no sources were retrieved");
  }

  if (sourceBacked.length === 0) {
    shortfalls.push(
      findings.length === 0
        ? "no findings were extracted"
        : "no finding could be traced to retrieved text",
    );
  }

  if (failedTasks.length > 0) {
    shortfalls.push(
      `${plural(failedTasks.length, "task")} of ${tasks.length} failed`,
    );
  }

  if (limitsReached.length > 0) {
    shortfalls.push(
      `the run reached ${limitsReached.map(describeLimit).join(", ")} and stopped before finishing`,
    );
  }

  // Order matters: a conflict is only ever recorded between two source-backed
  // findings, so reaching this branch means retrieval happened and verification
  // passed. It is the most informative verdict available, and it is reported
  // even when the run also fell short — the shortfalls appear in the summary so
  // neither fact hides the other.
  if (conflicts.length > 0) {
    const qualifier =
      shortfalls.length === 0
        ? ""
        : ` The run also fell short: ${shortfalls.join("; ")}.`;

    return {
      sufficiency: "conflicting",
      summary:
        `The retrieved sources disagree on the question: ${plural(conflicts.length, "unresolved conflict")} ` +
        `across ${plural(sources.length, "source")}. The disagreement is recorded rather than resolved.${qualifier}`,
      errors: [...errors],
    };
  }

  if (shortfalls.length === 0) {
    return {
      sufficiency: "sufficient",
      summary:
        `The question was answered from ${plural(sources.length, "retrieved source")}. ` +
        `${sourceBacked.length} of ${plural(findings.length, "finding")} are supported by text found in a source, ` +
        `with ${plural(evidence.length, "evidence record")} linking them.`,
      errors: [...errors],
    };
  }

  return {
    sufficiency: "insufficient",
    summary:
      `The question was not answered from the sources retrieved: ${shortfalls.join("; ")}. ` +
      `The run did retrieve ${plural(sources.length, "source")} and record ${plural(findings.length, "finding")}, ` +
      "which are reported below as partial results.",
    errors: [...errors],
  };
}
