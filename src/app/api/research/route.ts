import { NextResponse } from "next/server";
import { readJsonBody, toErrorResponse } from "@/server/http";
import {
  listRecentResearchSummaries,
  startResearch,
} from "@/server/services/research";

/**
 * `/api/research` — ask a research question, or list recent runs.
 *
 * A thin handler by convention, like its agent counterpart: it parses and
 * validates the request, calls the service and shapes the response. It holds no
 * research rules of its own, and in particular it does not decide how good a
 * result is — the evaluator does, from the sources the run actually retrieved,
 * and nothing in the request body can reach that judgement.
 *
 * **Why a `201` can still mean "no answer found".** The run finishes before this
 * responds, and `sufficiency` is part of the body. A question whose sources did
 * not settle it produces a successful response carrying
 * `sufficiency: "insufficient"` and the material that was gathered. Only a
 * malformed request or a provider that could not be constructed produces an
 * error status. See `services/research.ts`, which states why.
 *
 * **The run is synchronous, and the response says so.** There is no job queue and
 * no background worker in this phase, so a `201` means the research is complete
 * and the record — plan, sources, findings, evidence, conflicts, limits reached
 * and the full event log — is in the response body.
 */

/**
 * Both handlers must run at request time.
 *
 * `GET` reads the process-local research store, which is empty at build time.
 * Without this the build could capture that empty list as the route's response
 * and serve it forever — the endpoint would look correct and never return a run
 * that had actually happened. `POST` is inherently request-time, but the export
 * is per-segment, so it is stated once here for both.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readJsonBody(request);

  if (!body.ok) {
    return body.response;
  }

  try {
    const research = await startResearch(body.value);
    return NextResponse.json({ research }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export function GET() {
  return NextResponse.json({ research: listRecentResearchSummaries() });
}
