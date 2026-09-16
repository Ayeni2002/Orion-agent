import { resolveModelProvider, type ModelProvider } from "@/server/agent";
import { getResearch } from "@/server/research";
import type { ResearchStatus } from "@/types/research";
import type {
  Report,
  ReportGenerationResult,
  ReportRefusalReason,
  ReportSummary,
} from "@/types/report";

import { generateReport } from "./generator";
import { findReportByResearchId, saveReport } from "./store";

/**
 * Why a record has nothing to report on, as a sentence a reader can act on.
 *
 * The distinction that matters is whether asking again could help, and the
 * status is split three ways rather than two: a run still working will produce a
 * result, a run that failed will not produce one on its own but a retry might,
 * and a run that was cancelled or that finished empty never will.
 *
 * **A `Record` over the closed union rather than a lookup with a fallback.**
 * Every message ends in the same clause on purpose — "nothing to report on" is
 * the one thing that is true of all seven — so a caller matching on it, as
 * `api/reports/route.test.ts` does, is matching on the part that does not
 * change. The member list is exhaustive, so a status added to `ResearchStatus`
 * is a compile error here rather than a sentence that quietly lies about a run.
 */
const NO_RESULT_REASON: Record<ResearchStatus, string> = {
  created: "That research run has not started, so there is nothing to report on yet.",
  planning: "That research run is still planning, so there is nothing to report on yet.",
  running: "That research run is still running, so there is nothing to report on yet.",
  evaluating:
    "That research run has finished searching and is still being assessed, so there is nothing to report on yet.",
  completed:
    "That research run finished without recording a result, so there is nothing to report on.",
  failed:
    "That research run failed before recording a result, so there is nothing to report on.",
  cancelled:
    "That research run was cancelled before recording a result, so there is nothing to report on.",
};

/**
 * Reports, as the rest of the application reaches them.
 *
 * The mirror of `research/service.ts`, and it makes the same bargain: the engine
 * below returns data rather than throwing, so this layer decides what a caller
 * gets and which outcomes become HTTP statuses.
 *
 * **It does not re-implement anything.** Reading the research record is
 * `getResearch` from the research subsystem, the prose is `./generator`, the
 * document is `./store`. What lives here is the three decisions that belong to no
 * single one of them: whether the named research record can be reported on at
 * all, whether an existing report is reused, and what the caller is told when
 * there is nothing to report.
 *
 * **The one rule this file exists to enforce.** A report may only be generated
 * from a research record that finished and carries a result. That is §14's "fail
 * safely if the underlying research data is incomplete", and it is checked here
 * rather than in the generator because it is a statement about the *record* —
 * whether there is evidence to report on — and not about prose. Two refusals
 * follow, and they are deliberately not collapsed into one:
 *
 *   - the id names no record → `not_found`. The caller named something that does
 *     not exist, and asking again will not help.
 *   - the id names a record with no result → `not_ready`. Nothing malfunctioned;
 *     the research has not produced anything to report on, and asking again once
 *     it has will work.
 *
 * **Reuse before regeneration, per §22.** A request without `regenerate` returns
 * the report already made for that record. The check is one store lookup — not a
 * cache, and not built as one: there is no key strategy, no expiry, no
 * invalidation, because the only question asked of it is whether a report for
 * this record is already in hand.
 */

export interface GenerateReportForParams {
  researchId: string;
  /** Generate afresh even though a report for this record already exists. */
  regenerate?: boolean;
  /** Set false to demand a report built only from recorded data. */
  useModel?: boolean;
  /**
   * A provider to use instead of resolving one from the environment.
   *
   * The same injection point `runResearch` takes, and for the same reason: a test
   * substitutes a scripted provider here rather than mocking a module, so what it
   * exercises is the real generator rather than a stand-in for it.
   */
  provider?: ModelProvider;
}

/**
 * Generates a report for a research record, or returns the one already made.
 *
 * Never throws. Every outcome a caller can act on is a `ReportGenerationResult`,
 * so the route decides the status code and this function stays callable from
 * anywhere — a test, a workspace action, a script.
 */
export async function generateReportFor({
  researchId,
  regenerate,
  useModel,
  provider,
}: GenerateReportForParams): Promise<ReportGenerationResult> {
  const record = getResearch(researchId);

  if (record === undefined) {
    return refuse(
      "not_found",
      "No research record with that id was found.",
    );
  }

  if (!regenerate) {
    const existing = findReportByResearchId(researchId);

    if (existing !== undefined) {
      return { ok: true, report: existing };
    }
  }

  const result = record.result;

  if (result === undefined) {
    // Reported as `not_ready` rather than as a fault, because nothing failed:
    // the record carries no result, and which status it stopped at is the whole
    // of what a caller needs in order to decide whether to ask again.
    return refuse("not_ready", NO_RESULT_REASON[record.status]);
  }

  // A misconfigured provider is not a reason to refuse a report. §5 requires the
  // deterministic path to stay usable without a paid model, and the generator
  // already treats "no provider" as a supported state rather than a failure — so
  // the provider is simply not offered, and the report's own metadata carries the
  // reason it was built from the record alone. Failing here would turn a
  // configuration mistake into a feature being unavailable.
  let resolved: ModelProvider | undefined;

  try {
    resolved = provider ?? resolveModelProvider();
  } catch {
    resolved = undefined;
  }

  const report = await generateReport({
    record,
    result,
    ...(resolved === undefined ? {} : { provider: resolved }),
    ...(useModel === undefined ? {} : { useModel }),
  });

  // Only a completed report is stored. A failed one is not retained, because the
  // store is the list a workspace browses and a document that could not be built
  // is not a document — the same call `research/store.ts` makes in holding only
  // finished records.
  if (report.status === "completed") {
    saveReport(report);
  }

  return { ok: true, report };
}

/**
 * A list entry, without the parts that only matter once you open one.
 *
 * The same decision `toResearchSummary` makes. A report carries every section,
 * every citation and every source, which is the right size for one document and
 * entirely the wrong size for a list of twenty-five.
 */
export function toReportSummary(report: Report): ReportSummary {
  return {
    id: report.id,
    researchId: report.researchId,
    title: report.title,
    objective: report.objective,
    status: report.status,
    generationMode: report.metadata.generation.mode,
    sectionCount: report.sections.length,
    citationCount: report.citations.length,
    sourceCount: report.sources.length,
    createdAt: report.generatedAt,
  };
}

/**
 * A refusal, with the error code that best describes it.
 *
 * The `reason` is the contract and the code is what the shared error shape
 * carries; see `ReportGenerationResult` for why one cannot do the other's job.
 * Neither code is ideal, and saying so is better than adding a report-specific
 * member to `AgentErrorCode` — the engine's shared error vocabulary — for two
 * conditions that are about a record's state rather than about failed work.
 */
function refuse(
  reason: ReportRefusalReason,
  message: string,
): ReportGenerationResult {
  return {
    ok: false,
    reason,
    error: {
      code: reason === "not_found" ? "internal_error" : "evaluation_failed",
      message,
    },
  };
}
