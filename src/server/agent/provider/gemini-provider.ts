import { readModelApiKey } from "@/lib/env";
import {
  describeHttpFailure,
  describeTransportFailure,
  isRecord,
  readJsonResponse,
} from "@/server/transport";

import { describeOperation } from "./prompts";
import {
  ModelProviderError,
  type ModelProvider,
  type ModelProviderDescriptor,
  type ModelProviderRequest,
  type ModelProviderResponse,
} from "./provider";

/**
 * The native Gemini model adapter.
 *
 * Gemini *is* reachable through `openai-provider.ts` pointed at Google's
 * OpenAI-compatibility endpoint, and that is a legitimate configuration for
 * inference alone. It is not sufficient here for one reason: that surface does
 * not expose Google Search grounding, so `/research`, `/reports` and everything
 * downstream of retrieval would stay permanently unavailable. Grounding lives on
 * `generateContent`, so reaching it means speaking `generateContent`.
 *
 * The three properties `openai-provider.ts` is built to keep are kept here, and
 * they are the reason this file is shaped like that one rather than like a
 * translation of Google's examples:
 *
 *   1. **The credential is read, used, and dropped.** Fetched inside `generate`,
 *      written into one header, never stored on the instance, never returned,
 *      never included in an error. An instance can be logged safely.
 *   2. **The response is untrusted.** It is a remote service's output reaching a
 *      process that will act on it, so every field is type-checked before use
 *      and a malformed payload is an error rather than an `undefined` that
 *      surfaces three layers later.
 *   3. **Failure is a value, not a crash.** Every failure path raises
 *      `ModelProviderError` with a message safe to log and safe to return, and
 *      none of them carries a raw upstream payload.
 *
 * **What is not asserted here.** The request and response shapes below are
 * written from the documented protocol, not from an observed call — the same
 * position `openai-provider.ts` is in, and the reason its test file insists it
 * is testing *the adapter* and not the vendor. The one shape this build depends
 * on but cannot verify offline is Gemini's grounding metadata, which is read by
 * `research/provider/gemini-search-provider.ts`; that adapter is built so an
 * unrecognised shape reports "nothing retrieved" rather than inventing sources.
 * See its docblock, and `docs/RESEARCH.md` for the live check.
 */

/** The id reported on every execution this adapter produces. */
export const GEMINI_STYLE_PROVIDER_ID = "gemini";

/**
 * What this adapter calls its far end in an error message.
 *
 * Deliberately the same string `openai-provider.ts` passes, because it means the
 * same thing to an operator: this is the call that produced reasoning, not the
 * one that retrieved sources. The search adapter passes "search endpoint", so a
 * message still says which of a run's two remote calls failed.
 */
const NOUN = "model endpoint";

/**
 * How long a single model call may take.
 *
 * Declared here rather than imported from `openai-provider.ts`, matching how
 * `openrouter-search-provider.ts` declares its own rather than reaching for the
 * model adapter's. The number is the same because the constraint is the same —
 * the engine has no timeout support to hook into, so the bound is enforced at
 * the one place a network call is made, and a hung upstream must not hold a run
 * open indefinitely. What each adapter owns is its own bound, so raising one for
 * one provider does not silently change the other.
 */
export const DEFAULT_GEMINI_TIMEOUT_MS = 60_000;

export interface GeminiProviderConfig {
  /** Base URL, before `/models/<model>:generateContent` is appended. */
  endpoint: string;
  /** Model id — `gemini-2.0-flash`, optionally written `models/gemini-2.0-flash`. */
  model: string;
  timeoutMs?: number;
}

export function createGeminiProvider(
  config: GeminiProviderConfig,
): ModelProvider {
  const descriptor: ModelProviderDescriptor = {
    id: GEMINI_STYLE_PROVIDER_ID,
    label: "Google Gemini",
    isExternal: true,
    model: config.model,
  };

  const timeoutMs = config.timeoutMs ?? DEFAULT_GEMINI_TIMEOUT_MS;

  return {
    descriptor,

    async generate(
      request: ModelProviderRequest,
    ): Promise<ModelProviderResponse> {
      const url = buildGenerateContentUrl(config.endpoint, config.model);
      const apiKey = readModelApiKey();

      let response: Response;

      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // The key rides in a header, never in the query string, and that is
            // a security decision rather than a stylistic one. Gemini also
            // accepts `?key=`, and a URL is written to proxy logs, server access
            // logs, and — as this file's own tests assert — error messages. A
            // credential in a header has one destination; a credential in a URL
            // is copied into every log that sees the request line.
            //
            // Absent rather than empty when no key is configured. Gemini does
            // require one, so this is not a supported configuration, but the
            // header is built the same way it is in `openai-provider.ts` so the
            // two cannot drift — and a missing key becomes a 401 the transport
            // helpers report by name, which is a better failure than an empty
            // header this file invented.
            ...(apiKey === undefined ? {} : { "x-goog-api-key": apiKey }),
          },
          body: JSON.stringify(buildRequestBody(request)),
          // Aborts the request itself, not merely the wait for it, so a
          // timed-out call does not keep a socket open behind the error.
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        // Nothing from `error` is forwarded: a fetch failure can carry the
        // request that produced it, and that request has the header on it.
        throw new ModelProviderError(
          GEMINI_STYLE_PROVIDER_ID,
          describeTransportFailure(error, timeoutMs, NOUN),
        );
      }

      if (!response.ok) {
        throw new ModelProviderError(
          GEMINI_STYLE_PROVIDER_ID,
          await describeHttpFailure(response, NOUN),
        );
      }

      const body = await readJsonResponse(response, NOUN);

      if (!body.ok) {
        throw new ModelProviderError(GEMINI_STYLE_PROVIDER_ID, body.message);
      }

      return toProviderResponse(body.value, config.model);
    },
  };
}

/**
 * The endpoint, with the model in the path rather than in the body.
 *
 * `generateContent` addresses the model as a path segment, which is the design
 * difference from `/chat/completions` that shows up first.
 *
 * A leading `models/` is stripped before the segment is built, because Google's
 * own REST documentation writes the model as `models/gemini-2.0-flash` and its
 * SDKs take `gemini-2.0-flash`. An operator copying from the docs into
 * `LLM_MODEL` would otherwise produce `.../models/models/gemini-2.0-flash:...`
 * and get a 404 that names nothing useful. Accepting both spellings costs one
 * line and removes a trap that has nothing to do with what the operator was
 * trying to configure.
 */
function buildGenerateContentUrl(endpoint: string, model: string): string {
  const bare = model.startsWith("models/")
    ? model.slice("models/".length)
    : model;

  return `${trimTrailingSlash(endpoint)}/models/${encodeURIComponent(bare)}:generateContent`;
}

/**
 * The request body.
 *
 * `context` is serialised into the prompt rather than dropped, because
 * `provider/provider.ts` requires it: the context is what the model is being
 * asked about, and an adapter that ignored it would answer a different question
 * than the one the planner asked. The instruction and the context are joined
 * exactly as `openai-provider.ts` joins them, so the two adapters put the same
 * text in front of the model and a difference in output is a difference in the
 * model rather than in the adapter.
 */
function buildRequestBody(
  request: ModelProviderRequest,
): Record<string, unknown> {
  const instruction = request.instruction.trim();
  const context = safeStringify(request.context);

  const content =
    context === undefined ? instruction : `${instruction}\n\nContext:\n${context}`;

  const generationConfig: Record<string, unknown> = {
    ...(request.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: request.maxOutputTokens }),
    // Requested only when the caller asked for JSON. Sending it unconditionally
    // would constrain models that were not asked to produce any — and here it
    // would cost more than that, since a grounded search call needs a free-text
    // answer for citations to attach to.
    ...(request.responseFormat === "json"
      ? { responseMimeType: "application/json" }
      : {}),
  };

  return {
    contents: [{ role: "user", parts: [{ text: content }] }],
    systemInstruction: {
      parts: [{ text: describeOperation(request.operation) }],
    },
    // Omitted rather than sent empty when there is nothing to configure, so a
    // request that constrains nothing carries no `generationConfig` at all.
    ...(Object.keys(generationConfig).length === 0 ? {} : { generationConfig }),
  };
}

/**
 * Narrows an untrusted payload to a `ModelProviderResponse`.
 *
 * Every access is checked because this is a remote service's output. A missing
 * `candidates` array or a candidate with no readable text is a provider fault,
 * and saying so here keeps an `undefined` from travelling into the planner as
 * though it were an answer.
 *
 * One case is worth naming. When Gemini blocks a prompt it returns a candidate
 * with a `finishReason` of `SAFETY` and **no** content, so this throws on the
 * missing text before the finish reason is ever read. That is the intended
 * ordering: the run fails loudly and says the response had no content, rather
 * than handing the planner an empty string to parse as JSON — which is the
 * failure mode a reader would find least explicable.
 */
function toProviderResponse(
  payload: unknown,
  model: string,
): ModelProviderResponse {
  if (!isRecord(payload)) {
    throw new ModelProviderError(
      GEMINI_STYLE_PROVIDER_ID,
      "The model endpoint returned a JSON value that was not an object.",
    );
  }

  const candidates = payload.candidates;

  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new ModelProviderError(
      GEMINI_STYLE_PROVIDER_ID,
      "The model endpoint returned no candidates.",
    );
  }

  const first: unknown = candidates[0];

  if (!isRecord(first)) {
    throw new ModelProviderError(
      GEMINI_STYLE_PROVIDER_ID,
      "The model endpoint returned a malformed candidate.",
    );
  }

  const text = readCandidateText(first.content);

  if (text === undefined) {
    throw new ModelProviderError(
      GEMINI_STYLE_PROVIDER_ID,
      "The model endpoint returned a candidate with no text content.",
    );
  }

  return {
    text,
    providerId: GEMINI_STYLE_PROVIDER_ID,
    model,
    finishReason: readFinishReason(first.finishReason),
    ...readUsage(payload.usageMetadata),
  };
}

/**
 * The candidate's text, or nothing.
 *
 * A candidate's `parts` array is joined rather than truncated to its first
 * entry, because Gemini may split one logical answer across several parts and
 * taking only the first would silently return half an answer — which, for a
 * `responseFormat: "json"` call, is a truncated JSON document rather than a
 * visibly short one.
 *
 * Parts carrying no `text` are skipped: a part may hold a function call or
 * inline data instead, and neither is text this adapter was asked for.
 */
function readCandidateText(content: unknown): string | undefined {
  if (!isRecord(content)) {
    return undefined;
  }

  const parts = content.parts;

  if (!Array.isArray(parts)) {
    return undefined;
  }

  const texts = parts
    .filter(isRecord)
    .map((part) => part.text)
    .filter((text): text is string => typeof text === "string");

  return texts.length === 0 ? undefined : texts.join("");
}

/**
 * Maps the upstream finish reason onto the engine's three.
 *
 * Gemini reports these in upper case, which is the other visible protocol
 * difference: `STOP` and `MAX_TOKENS` are the two that mean something here.
 *
 * Everything else — `SAFETY`, `RECITATION`, `OTHER`,
 * `FINISH_REASON_UNSPECIFIED`, or a field that is simply absent — becomes
 * `"error"` rather than `"stop"`, for the reason `openai-provider.ts` gives: a
 * provider reporting a reason this adapter does not know is a provider whose
 * output has not been shown to be complete, and calling that a clean stop would
 * let a truncated or filtered answer be evaluated as a whole one.
 */
function readFinishReason(
  value: unknown,
): ModelProviderResponse["finishReason"] {
  if (value === "STOP") return "stop";
  if (value === "MAX_TOKENS") return "length";
  return "error";
}

function readUsage(
  usage: unknown,
): Pick<ModelProviderResponse, "usage"> {
  if (!isRecord(usage)) {
    return {};
  }

  const inputTokens = readTokenCount(usage.promptTokenCount);
  const outputTokens = readTokenCount(usage.candidatesTokenCount);

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
