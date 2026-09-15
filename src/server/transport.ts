/**
 * Shared helpers for talking to a remote endpoint.
 *
 * Extracted from `agent/provider/openai-provider.ts` when the research adapter
 * became the second thing in this codebase to make an outbound HTTP call. The
 * reason is not tidiness. Three of these functions exist to enforce a single
 * rule — nothing derived from a failed request may be repeated back, because a
 * failed POST can carry itself and the request it carries has the
 * `Authorization` header on it — and a rule with two implementations is a rule
 * with one implementation and one place for a fix to be forgotten.
 *
 * Nothing here constructs an error, and that is deliberate. Each caller raises
 * its own class, so a caller catching a failure can still tell an inference
 * failure apart from a retrieval one; only the wording is shared, because the
 * wording is the part that must not diverge.
 */

/** A ceiling on the error body read back from a failed call. */
export const MAX_ERROR_BODY_CHARACTERS = 2_048;

export type JsonResponseResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string };

/**
 * Parses a response body, treating the whole thing as untrusted input.
 *
 * Returns a result rather than throwing so the caller can raise its own error
 * class. `noun` names the thing that failed — "model endpoint", "search
 * endpoint" — and is interpolated into the message so an operator reading it
 * knows which of a run's two remote calls went wrong.
 */
export async function readJsonResponse(
  response: Response,
  noun: string,
): Promise<JsonResponseResult> {
  const text = await response.text();

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      message: `The ${noun} returned a response that was not JSON.`,
    };
  }
}

/**
 * A transport failure, described without repeating it.
 *
 * A `fetch` rejection on a POST can carry the request, and the request has the
 * `Authorization` header on it. The message therefore names the *kind* of
 * failure and never interpolates the underlying error.
 */
export function describeTransportFailure(
  error: unknown,
  timeoutMs: number,
  noun: string,
): string {
  if (error instanceof Error && error.name === "TimeoutError") {
    return `The ${noun} did not respond within ${timeoutMs}ms.`;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return `The request to the ${noun} was aborted.`;
  }

  return `The ${noun} could not be reached.`;
}

/**
 * An HTTP failure, described using only what is safe to repeat.
 *
 * The provider's own `error.message` is the useful part — "insufficient
 * credits" is actionable where "402" is not — so it is read when present. The
 * status line and headers are not included, because a proxy or gateway can echo
 * the request in either. The snippet is capped so an HTML error page cannot
 * become the error message.
 */
export async function describeHttpFailure(
  response: Response,
  noun: string,
): Promise<string> {
  const status = `${response.status} ${response.statusText}`.trim();
  const detail = await readUpstreamErrorMessage(response);

  return detail === undefined
    ? `The ${noun} returned ${status}.`
    : `The ${noun} returned ${status}: ${detail}`;
}

async function readUpstreamErrorMessage(
  response: Response,
): Promise<string | undefined> {
  let body: string;

  try {
    body = await response.text();
  } catch {
    return undefined;
  }

  if (body.length === 0) {
    return undefined;
  }

  const message = extractErrorMessage(body);

  if (message === undefined) {
    return undefined;
  }

  const collapsed = message.replace(/\s+/g, " ").trim();

  if (collapsed.length === 0) {
    return undefined;
  }

  return collapsed.length > MAX_ERROR_BODY_CHARACTERS
    ? `${collapsed.slice(0, MAX_ERROR_BODY_CHARACTERS)}…`
    : collapsed;
}

/** Reads `error.message` from a JSON error body, when there is one. */
function extractErrorMessage(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);

    if (isRecord(parsed) && isRecord(parsed.error)) {
      const message = parsed.error.message;
      return typeof message === "string" ? message : undefined;
    }
  } catch {
    // Not JSON. An upstream that returns HTML on failure has nothing worth
    // repeating and possibly plenty worth withholding, so nothing is returned.
  }

  return undefined;
}

/**
 * Narrows an untrusted value to a plain object.
 *
 * Both adapters reach this constantly — every field of a remote payload is
 * checked before use — and it lives here so the two cannot disagree about
 * whether an array counts as an object. It does not.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
