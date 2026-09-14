import { NextResponse } from "next/server";
import { ServiceError } from "./errors";

/**
 * HTTP helpers for Route Handlers.
 *
 * Not a service: this module imports `next/server`, which services may not do.
 * It exists so every route maps failures to responses the same way, rather than
 * each one re-deciding what a 404 looks like and whether to include an internal
 * message.
 */

/**
 * Largest accepted request body.
 *
 * An objective is capped at 2000 characters by its schema, so 8 KiB is generous
 * for a well-formed request and small enough that a hostile one cannot make the
 * server buffer something enormous before validation rejects it.
 */
export const MAX_JSON_BODY_BYTES = 8 * 1024;

/**
 * Converts anything thrown into a JSON response.
 *
 * `ServiceError` messages are written to be shown to a caller, so they pass
 * through with their status. Anything else is a bug or an infrastructure
 * failure whose message may embed the input that caused it — that message goes
 * to the server log and a fixed one goes to the client.
 */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof ServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error("[api] unhandled route error:", error);

  return NextResponse.json(
    { error: "The request could not be completed." },
    { status: 500 },
  );
}

export type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; response: NextResponse };

/**
 * Reads and parses a JSON request body.
 *
 * Checked twice, for different reasons. `Content-Length` is checked first
 * because it is free and rejects an oversized upload before it is read at all.
 * The byte length is checked again afterwards because a client may lie about it,
 * or send a chunked body with no length at all — the declared header is a
 * courtesy, not a guarantee, and only the second check is real.
 *
 * Returns `unknown`, never `any`: a parsed body is untrusted input and callers
 * must run it through a schema before using it.
 */
export async function readJsonBody(request: Request): Promise<JsonBodyResult> {
  const declaredLength = Number(request.headers.get("content-length") ?? "");

  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "The request body is too large." },
        { status: 413 },
      ),
    };
  }

  const raw = await request.text();

  if (new TextEncoder().encode(raw).length > MAX_JSON_BODY_BYTES) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "The request body is too large." },
        { status: 413 },
      ),
    };
  }

  if (raw.trim().length === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "A JSON request body is required." },
        { status: 400 },
      ),
    };
  }

  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "The request body must be valid JSON." },
        { status: 400 },
      ),
    };
  }
}
