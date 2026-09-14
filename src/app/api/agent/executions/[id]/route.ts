import { NextResponse } from "next/server";
import { toErrorResponse } from "@/server/http";
import { getExecutionById } from "@/server/services/agent";

/**
 * `/api/agent/executions/[id]` — read one execution.
 *
 * Read-only by design. There is deliberately no `PATCH` or `DELETE` here: a
 * client cannot mark a task completed, alter a step's status, or inject an
 * observation, because no route accepts those things and the service exposes no
 * method that would apply them. Execution state is written by the engine alone.
 *
 * An unknown id is a `404`, not an empty result. On a serverless deployment a
 * stored execution may genuinely be gone — see the note in
 * `src/server/agent/runtime/store.ts` — and reporting "not found" is honest
 * where reconstructing something would not be.
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    return NextResponse.json({ execution: getExecutionById(id) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
