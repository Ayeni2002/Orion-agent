import type { Report, ReportSummary } from "@/types/report";
import { reportRequestSchema } from "@/lib/validation/report";
import {
  generateReportFor,
  getReport,
  listReports,
  toReportSummary,
} from "../report";
import { ServiceError } from "../errors";

/**
 * Reports, as the rest of the application sees them.
 *
 * The counterpart of `services/research.ts`, doing the same three jobs in the
 * same order: validate at the boundary, generate, record. The engine below it
 * returns data and never throws, so this layer is where a refusal becomes an HTTP
 * status.
 *
 * **A report that fell back is a `201`, not an error.** This is the deliberate
 * part, and it is the same call `services/research.ts` makes about a run that
 * found too little. A report built from the research record because no model was
 * configured, or because the model's prose did not survive checking, has been
 * produced correctly — it is a readable, traceable document, and it carries
 * `metadata.generation.mode` saying how it was written. Returning an error status
 * would throw away a usable deliverable and tell the caller only that something
 * went wrong, which is both less useful and less true.
 *
 * **The two refusals are two statuses.** §14 requires a report to fail safely
 * when the research data is incomplete, and "safely" means a caller can tell what
 * to do next:
 *
 *   - `404` — no research record with that id. Retrying will not help.
 *   - `409` — the record exists and has no result. Retrying later will help, and
 *     the message says which state it is in.
 *
 * Collapsing those into one status would make a client either retry a typo
 * forever or give up on a run that was still going.
 *
 * **Nothing here accepts report content from a caller.** There is no parameter
 * through which a client could supply a section, a citation or a source, and
 * therefore no way for a request to assert that a document was written. That is
 * the same structural property `services/agent.ts` and `services/research.ts`
 * describe, and it matters most here: a report is the artefact a person reads and
 * trusts, so a client able to inject one could manufacture a document that looks
 * like Orion's work and is not.
 */

/**
 * Generates a report for a research record, or returns the one already made.
 *
 * `input` is `unknown` on purpose — it arrives from a request body and is
 * untrusted until the schema has passed it. Generation finishes inside this call:
 * there is no queue and no background worker, so when this resolves the report is
 * terminal. §13 permits that reading in as many words, and it is why the UI owns
 * an in-flight state rather than the record carrying one.
 */
export async function createReport(input: unknown): Promise<Report> {
  const parsed = reportRequestSchema.safeParse(input);

  if (!parsed.success) {
    throw new ServiceError(
      parsed.error.issues.map((issue) => issue.message).join(" ") ||
        "The report request is not valid.",
      400,
    );
  }

  const outcome = await generateReportFor({
    researchId: parsed.data.researchId,
    ...(parsed.data.regenerate === undefined
      ? {}
      : { regenerate: parsed.data.regenerate }),
    ...(parsed.data.useModel === undefined
      ? {}
      : { useModel: parsed.data.useModel }),
  });

  if (outcome.ok) {
    return outcome.report;
  }

  throw new ServiceError(
    outcome.error.message,
    outcome.reason === "not_found" ? 404 : 409,
  );
}

export function getReportById(id: string): Report {
  const report = getReport(id);

  if (report === undefined) {
    throw new ServiceError("No report with that id was found.", 404);
  }

  return report;
}

export function listRecentReports(): Report[] {
  return listReports();
}

/**
 * List entries, newest first.
 *
 * Summarised at this layer rather than in the route so the projection has one
 * home and the page and the API cannot describe the same report differently.
 */
export function listRecentReportSummaries(): ReportSummary[] {
  return listReports().map(toReportSummary);
}
