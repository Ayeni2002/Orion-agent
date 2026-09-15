import { readModelApiKey } from "@/lib/env";
import {
  ModelProviderError,
  type ModelProvider,
  type ModelProviderDescriptor,
  type ModelProviderRequest,
  type ModelProviderResponse,
} from "./provider";

/**
 * The OpenAI-compatible model adapter.
 *
 * One adapter covers OpenRouter, Groq, Together, Fireworks, vLLM, LM Studio and
 * OpenAI itself, because they all speak the same `/chat/completions` protocol.
 * That is why this file is named for the *style* and not for a vendor: nothing
 * below knows which service it is talking to, and adding a second one is a
 * change to `LLM_ENDPOINT` rather than a change to this code.
 *
 * Three properties this adapter is built to keep:
 *
 *   1. **The credential is read, used, and dropped.** It is fetched inside
 *      `generate`, written into one header, and never stored on the instance,
 *      returned, or included in an error. An instance can be logged safely.
 *   2. **The response is untrusted.** It is a remote service's output reaching
 *      a process that will act on it, so every field is type-checked before use
 *      and a malformed payload is an error rather than a `undefined` that
 *      surfaces three layers later.
 *   3. **Failure is a value, not a crash.** Every failure path raises
 *      `ModelProviderError` with a message that is safe to log and safe to
 *      return, and none of them carries a raw upstream payload.
 */

/** The id reported on every execution this adapter produces. */
export const OPENAI_STYLE_PROVIDER_ID = "openai-compatible";

/**
 * How long a single model call may take.
 *
 * The engine has no timeout support to hook into — Phase 4 recorded the same
 * gap for tools — so the bound is enforced here, at the one place a network
 * call is made. Without it a hung upstream would hold a run open indefinitely,
 * which §22 of the brief rules out.
 */
export const DEFAULT_MODEL_TIMEOUT_MS = 60_000;

/** A ceiling on the error body read back from a failed call. */
const MAX_ERROR_BODY_CHARACTERS = 2_048;

export interface OpenAiCompatibleProviderConfig {
  /** Base URL, without the `/chat/completions` suffix. */
  endpoint: string;
  /** Model id, in the provider's own namespace — `openai/gpt-4o`, say. */
  model: string;
  timeoutMs?: number;
}

export function createOpenAiCompatibleProvider(
  config: OpenAiCompatibleProviderConfig,
): ModelProvider {
  const descriptor: ModelProviderDescriptor = {
    id: OPENAI_STYLE_PROVIDER_ID,
    label: "OpenAI-compatible endpoint",
    isExternal: true,
    model: config.model,
  };

  const timeoutMs = config.timeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS;

  return {
    descriptor,

    async generate(
      request: ModelProviderRequest,
    ): Promise<ModelProviderResponse> {
      const url = `${trimTrailingSlash(config.endpoint)}/chat/completions`;
      const apiKey = readModelApiKey();

      let response: Response;

      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Absent rather than empty when no key is configured: a local
            // endpoint such as vLLM or LM Studio rejects a bare
            // `Authorization: Bearer ` where it accepts no header at all.
            ...(apiKey === undefined
              ? {}
              : { Authorization: `Bearer ${apiKey}` }),
          },
          body: JSON.stringify(buildRequestBody(request, config.model)),
          // Aborts the request itself, not merely the wait for it, so a
          // timed-out call does not keep a socket open behind the error.
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        // Nothing from `error` is forwarded: a fetch failure can carry the
        // request that produced it, and that request has the header on it.
        throw new ModelProviderError(
          OPENAI_STYLE_PROVIDER_ID,
          describeTransportFailure(error, timeoutMs),
        );
      }

      if (!response.ok) {
        throw new ModelProviderError(
          OPENAI_STYLE_PROVIDER_ID,
          await describeHttpFailure(response),
        );
      }

      const payload = await readJsonBody(response);

      return toProviderResponse(payload, config.model);
    },
  };
}

/**
 * The request body.
 *
 * `context` is serialised into the prompt rather than dropped, because
 * `provider/provider.ts` requires it: the context is what the model is being
 * asked about, and an adapter that ignored it would answer a different question
 * than the one the planner asked.
 */
function buildRequestBody(
  request: ModelProviderRequest,
  model: string,
): Record<string, unknown> {
  const instruction = request.instruction.trim();
  const context = safeStringify(request.context);

  const content =
    context === undefined
      ? instruction
      : `${instruction}\n\nContext:\n${context}`;

  return {
    model,
    messages: [
      { role: "system", content: describeOperation(request.operation) },
      { role: "user", content },
    ],
    // Requested only when the caller asked for JSON. Sending it unconditionally
    // would constrain models that were not asked to produce any.
    ...(request.responseFormat === "json"
      ? { response_format: { type: "json_object" } }
      : {}),
    ...(request.maxOutputTokens === undefined
      ? {}
      : { max_tokens: request.maxOutputTokens }),
  };
}

/**
 * What the model is being asked to do, in its own terms.
 *
 * Kept here rather than composed by the planner so that swapping the transport
 * does not mean rewriting prompts, and swapping the prompt does not mean
 * touching the transport — the split `docs/DEVELOPMENT_PHASES.md` Phase 6 asks
 * for.
 */
function describeOperation(operation: ModelProviderRequest["operation"]): string {
  switch (operation) {
    case "plan":
      return (
        "You are the planning component of Orion, a research agent. " +
        "Decompose the objective you are given into an ordered list of concrete " +
        "steps. Reply with JSON only, and invent no facts about the subject."
      );

    case "execute_step":
      return (
        "You are the execution component of Orion, a research agent. " +
        "Carry out the single step you are given using only the context " +
        "provided. Do not claim to have retrieved anything you were not given."
      );

    case "evaluate":
      return (
        "You are the evaluation component of Orion, a research agent. " +
        "Assess what the run actually produced and state plainly what could not " +
        "be established. Reply with JSON only."
      );
  }
}

/** Parses the response body, treating the whole thing as untrusted input. */
async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new ModelProviderError(
      OPENAI_STYLE_PROVIDER_ID,
      "The model endpoint returned a response that was not JSON.",
    );
  }
}

/**
 * Narrows an untrusted payload to a `ModelProviderResponse`.
 *
 * Every access is checked because this is a remote service's output. A missing
 * `choices` array or a non-string `content` is a provider fault, and saying so
 * here keeps a `undefined` from travelling into the planner as though it were
 * an answer.
 */
function toProviderResponse(
  payload: unknown,
  model: string,
): ModelProviderResponse {
  if (!isRecord(payload)) {
    throw new ModelProviderError(
      OPENAI_STYLE_PROVIDER_ID,
      "The model endpoint returned a JSON value that was not an object.",
    );
  }

  const choices = payload.choices;

  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ModelProviderError(
      OPENAI_STYLE_PROVIDER_ID,
      "The model endpoint returned no choices.",
    );
  }

  const first: unknown = choices[0];

  if (!isRecord(first)) {
    throw new ModelProviderError(
      OPENAI_STYLE_PROVIDER_ID,
      "The model endpoint returned a malformed choice.",
    );
  }

  const message = first.message;

  if (!isRecord(message) || typeof message.content !== "string") {
    throw new ModelProviderError(
      OPENAI_STYLE_PROVIDER_ID,
      "The model endpoint returned a choice with no text content.",
    );
  }

  return {
    text: message.content,
    providerId: OPENAI_STYLE_PROVIDER_ID,
    model,
    finishReason: readFinishReason(first.finish_reason),
    ...readUsage(payload.usage),
  };
}

/**
 * Maps the upstream finish reason onto the engine's three.
 *
 * Anything unrecognised becomes `"error"` rather than `"stop"`. A provider that
 * reports a reason this adapter does not know is a provider whose output has
 * not been shown to be complete, and reporting that as a clean stop would let a
 * truncated answer be evaluated as a whole one.
 */
function readFinishReason(value: unknown): ModelProviderResponse["finishReason"] {
  if (value === "stop") return "stop";
  if (value === "length") return "length";
  return "error";
}

function readUsage(usage: unknown): Pick<ModelProviderResponse, "usage"> {
  if (!isRecord(usage)) {
    return {};
  }

  const inputTokens = readTokenCount(usage.prompt_tokens);
  const outputTokens = readTokenCount(usage.completion_tokens);

  if (inputTokens === undefined && outputTokens === undefined) {
    return {};
  }

  return {
    usage: {
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
    },
  };
}

function readTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/**
 * A transport failure, described without repeating it.
 *
 * A `fetch` rejection on a POST can carry the request, and the request has the
 * `Authorization` header on it. The message therefore names the *kind* of
 * failure and never interpolates the underlying error.
 */
function describeTransportFailure(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && error.name === "TimeoutError") {
    return `The model endpoint did not respond within ${timeoutMs}ms.`;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return "The request to the model endpoint was aborted.";
  }

  return "The model endpoint could not be reached.";
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
async function describeHttpFailure(response: Response): Promise<string> {
  const status = `${response.status} ${response.statusText}`.trim();
  const detail = await readUpstreamErrorMessage(response);

  return detail === undefined
    ? `The model endpoint returned ${status}.`
    : `The model endpoint returned ${status}: ${detail}`;
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

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/** Never throws: a context that cannot be serialised is simply omitted. */
function safeStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
