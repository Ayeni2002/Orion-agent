import { NextResponse } from "next/server";
import { readJsonBody, toErrorResponse } from "@/server/http";
import {
  createReport,
  listRecentReportSummaries,
} from "@/server/services/reports";

/**
 * `/api/reports` — generate a report from a research result, or list reports.
 *
 * A thin handler by convention: it parses the request, calls the service and
 * shapes the response. Every rule a report obeys lives below it — which research
 * records may be reported on, what prose may be used, what is checked before it
 * is used — and nothing in the request body can reach any of those decisions.
 * The body names a research record and two preferences. There is no field through
 * which a caller could supply a section, a citation, a source or a URL, so a
 * request cannot assert that a document was written.
 *
 * **Why a `201` can still mean the model wrote nothing.** Generation falls back
 * to a report built entirely from the research record when no model is
 * configured, when the provider is unreachable, or when the model's prose does
 * not survive checking. All three are successful generations: the response
 * carries a complete, traceable document and its
 * `metadata.generation.mode`/`reason` say how it was written and why. Returning
 * an error status would discard a usable deliverable to report a condition the
 * body already describes. `services/reports.ts` states this at length.
 *
 * **The two refusals are two statuses.** A `404` means the named research record
 * does not exist and retrying will not help; a `409` means it exists without a
 * result and retrying later will. §14 requires a report to fail safely when the
 * research data is incomplete, and telling a client which of those two it is, is
 * what "safely" means here.
 *
 * **Generation is synchronous.** There is no queue and no background worker in
 * this phase, so a `201` means the report is complete and in the response body.
 * §13 permits that reading explicitly and asks for a simple loading state on the
 * client rather than an invented percentage; the in-flight state belongs to the
 * UI, not to a stored record.
 */

/**
 * Both handlers must run at request time.
 *
 * `GET` reads the process-local report store, which is empty at build time.
 * Without this the build could capture that empty list as the route's response
 * and serve it forever — the endpoint would look correct and never return a
 * report that had actually been generated. `POST` is inherently request-time, but
 * the export is per-segment, so it is stated once here for both.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readJsonBody(request);

  if (!body.ok) {
    return body.response;
  }

  try {
    const report = await createReport(body.value);
    return NextResponse.json({ report }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export function GET() {
  return NextResponse.json({ reports: listRecentReportSummaries() });
}
