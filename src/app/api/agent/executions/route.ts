import { NextResponse } from "next/server";
import { readJsonBody, toErrorResponse } from "@/server/http";
import {
  listRecentExecutionSummaries,
  startExecution,
} from "@/server/services/agent";

/**
 * `/api/agent/executions` — start an execution, or list recent ones.
 *
 * A thin handler by convention: it parses and validates the request, calls the
 * service and shapes the response. It holds no execution rules of its own, and
 * in particular it does not decide what a run's status is — the engine does,
 * and the client's input cannot reach that decision.
 *
 * The run finishes before `POST` responds. There is no job queue and no
 * background worker in this phase, so a `201` means the execution is complete
 * and its full state, event log and result are in the response body.
 */

/**
 * Both handlers must run at request time.
 *
 * `GET` reads the process-local execution store, which is empty at build time.
 * Without this, the build could capture that empty list as the route's response
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
    const execution = await startExecution(body.value);
    return NextResponse.json({ execution }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export function GET() {
  return NextResponse.json({ executions: listRecentExecutionSummaries() });
}
