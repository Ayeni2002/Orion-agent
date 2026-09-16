import { NextResponse } from "next/server";
import { toErrorResponse } from "@/server/http";
import { getReportById } from "@/server/services/reports";

/**
 * `/api/reports/[id]` — read one report.
 *
 * Read-only by design, like its execution counterpart and for a stronger reason.
 * A report is the artefact a person reads and trusts, so there is deliberately no
 * `PATCH` and no `DELETE`: a client cannot rewrite a section, add a citation,
 * attach a source or change a status, because no route accepts those things and
 * the service exposes no method that would apply them. A report is written once
 * by the generator, from a research result, and never afterwards.
 *
 * An unknown id is a `404`, not an empty document. A stored report may genuinely
 * be gone — the store is bounded and process-local, so an eviction or a restart
 * loses it — and reporting "not found" is honest where reconstructing one would
 * mean re-running generation that nobody asked for.
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    return NextResponse.json({ report: getReportById(id) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
