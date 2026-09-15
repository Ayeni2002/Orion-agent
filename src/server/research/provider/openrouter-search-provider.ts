import { readModelApiKey } from "@/lib/env";
import { createId, now } from "@/server/agent/ids";
import {
  describeHttpFailure,
  describeTransportFailure,
  isRecord,
  readJsonResponse,
} from "@/server/transport";
import type { ResearchSource } from "@/types/research";

import {
  ResearchProviderError,
  type ResearchProvider,
  type ResearchProviderDescriptor,
  type ResearchProviderRequest,
  type ResearchProviderResponse,
} from "./provider";

/**
 * The web-search retrieval adapter.
 *
 * Retrieval through OpenRouter is a chat completion with a search plugin
 * attached: the plugin runs a query, and the service returns the assistant's
 * prose plus the citations it drew on. This adapter reads **only the
 * citations**, and that single decision is what makes the rest of the file
 * safe to reason about.
 *
 *   1. **The model's prose is discarded.** `message.content` is never accessed.
 *      If the plugin is ignored — an upstream that does not know the field will
 *      drop it rather than reject the request — the model answers from its own
 *      weights, and that answer goes in the bin. There is no path by which
 *      generated text becomes a retrieved source, which is the one outcome
 *      `provider/provider.ts` and §12 of the brief exist to prevent.
 *   2. **Citations are the evidence that a search happened.** A response with
 *      no citations reports `performedRetrieval: false`, even though the HTTP
 *      call succeeded. That is the conservative direction and it is chosen
 *      deliberately: "found nothing" and "never looked" are indistinguishable
 *      from here, and only one of the two readings can put fabricated evidence
 *      in a result. Understating a search produces an honest `insufficient`;
 *      overstating one produces a lie.
 *   3. **The request shape is the minimal one.** `plugins: [{ id: "web" }]` and
 *      nothing else. Plugin options such as `max_results` would trim what is
 *      paid for, but an option the service does not recognise is a chance of a
 *      rejected request, and the per-task ceiling is enforced locally anyway
 *      (`research/tools/search.ts`). The cheapest correct request beats the
 *      cheapest possible one.
 *
 * The credential follows `openai-provider.ts` exactly: read inside `search`,
 * written into one header, never stored on the instance, never returned, and
 * never included in an error. A provider instance can be logged safely.
 */

/** The id reported on every source this adapter produces. */
export const OPENROUTER_SEARCH_PROVIDER_ID = "openrouter-web-search";

/**
 * What this adapter calls its far end in an error message.
 *
 * The mirror of `openai-provider.ts`'s noun. Both adapters share the wording
 * helpers in `@/server/transport`; only the noun differs, so a message names
 * which of a run's two remote calls failed.
 */
const NOUN = "search endpoint";

/**
 * How long a single search may take.
 *
 * Bounded here for the same reason the model call is: retrieval happens inside
 * a request that is waiting on it, and a hung upstream would hold the run open
 * until the platform's own timeout killed it with nothing recorded.
 */
export const DEFAULT_SEARCH_TIMEOUT_MS = 60_000;

/**
 * The annotation kind this adapter accepts.
 *
 * Anything else is skipped rather than guessed at. A provider that adds a new
 * annotation kind gets no sources from it and no error either, which is the
 * correct reading of "this build does not know what that is".
 */
const URL_CITATION_TYPE = "url_citation";

/** The search plugin's id, as the request body spells it. */
const WEB_PLUGIN_ID = "web";

/**
 * A structural ceiling on how many citations one response can contribute.
 *
 * The caller's own limit is smaller and is what actually applies; this exists so
 * that a malformed or hostile `maxResults` cannot make the loop build an
 * unbounded array before the tool's own cap sees it.
 */
const MAX_CITATIONS = 50;

/**
 * What the model is asked to do, in its own terms.
 *
 * Kept terse because the instruction is not what produces sources — the plugin
 * is, and the citations are the only thing read back. This exists to bias the
 * call toward searching at all; it is not a correctness mechanism, and nothing
 * downstream depends on the model obeying it.
 */
const SEARCH_INSTRUCTION = [
  "You are the retrieval component of Orion, a research agent.",
  "Search the web for the query you are given.",
  "Do not answer the query from your own knowledge.",
].join(" ");

export interface OpenRouterSearchProviderConfig {
  /** Base URL, without the `/chat/completions` suffix. */
  endpoint: string;
  /** Model id in the endpoint's own namespace — `openai/gpt-4o-mini`, say. */
  model: string;
  timeoutMs?: number;
}

export function createOpenRouterSearchProvider(
  config: OpenRouterSearchProviderConfig,
): ResearchProvider {
  const descriptor: ResearchProviderDescriptor = {
    id: OPENROUTER_SEARCH_PROVIDER_ID,
    label: "Web search",
    model: config.model,
    isExternal: true,
  };

  const timeoutMs = config.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;

  return {
    descriptor,
    // Configured in the sense the interface means: there is somewhere to send
    // the request and a credential to send with it. Whether the endpoint
    // honours the plugin is a fact this cannot know without calling, which is
    // why a call that retrieves nothing reports that rather than assuming it.
    isConfigured: true,

    async search(
      request: ResearchProviderRequest,
    ): Promise<ResearchProviderResponse> {
      const url = `${trimTrailingSlash(config.endpoint)}/chat/completions`;
      const apiKey = readModelApiKey();

      let response: Response;

      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Absent rather than empty when no key is configured. The research
            // provider is only chosen for an endpoint that needs one, but the
            // header is built the same way here as in the model adapter so the
            // two cannot drift.
            ...(apiKey === undefined
              ? {}
              : { Authorization: `Bearer ${apiKey}` }),
          },
          body: JSON.stringify(
            buildSearchRequestBody(request.query, config.model),
          ),
          // Aborts the request itself, not merely the wait for it, so a
          // timed-out call does not keep a socket open behind the error.
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        // Nothing from `error` is forwarded: a fetch failure can carry the
        // request that produced it, and that request has the header on it.
        throw new ResearchProviderError(
          OPENROUTER_SEARCH_PROVIDER_ID,
          describeTransportFailure(error, timeoutMs, NOUN),
        );
      }

      if (!response.ok) {
        throw new ResearchProviderError(
          OPENROUTER_SEARCH_PROVIDER_ID,
          await describeHttpFailure(response, NOUN),
        );
      }

      const body = await readJsonResponse(response, NOUN);

      if (!body.ok) {
        throw new ResearchProviderError(
          OPENROUTER_SEARCH_PROVIDER_ID,
          body.message,
        );
      }

      return toSearchResponse(body.value, request.maxResults);
    },
  };
}

/**
 * The request body.
 *
 * The query goes in as message content and nowhere else. It originates from
 * model output and is untrusted, and a field in a JSON body is the one place it
 * cannot do harm — it is never interpolated into the URL, a header, or a
 * command.
 */
function buildSearchRequestBody(
  query: string,
  model: string,
): Record<string, unknown> {
  return {
    model,
    messages: [
      { role: "system", content: SEARCH_INSTRUCTION },
      { role: "user", content: query },
    ],
    plugins: [{ id: WEB_PLUGIN_ID }],
  };
}

/**
 * Turns an untrusted payload into a `ResearchProviderResponse`.
 *
 * Throws on a body that is not a completion at all, because that means the
 * endpoint is not speaking the protocol this adapter was written for, and
 * reporting it as "no sources" would hide a misconfiguration behind an
 * ordinary-looking empty result. A completion that simply carries no citations
 * is the opposite case and is not an error — see `performedRetrieval` below.
 */
function toSearchResponse(
  payload: unknown,
  maxResults: number,
): ResearchProviderResponse {
  if (!isRecord(payload)) {
    throw new ResearchProviderError(
      OPENROUTER_SEARCH_PROVIDER_ID,
      "The search endpoint returned a JSON value that was not an object.",
    );
  }

  const choices = payload.choices;

  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ResearchProviderError(
      OPENROUTER_SEARCH_PROVIDER_ID,
      "The search endpoint returned no completion.",
    );
  }

  const first: unknown = choices[0];

  if (!isRecord(first)) {
    throw new ResearchProviderError(
      OPENROUTER_SEARCH_PROVIDER_ID,
      "The search endpoint returned a malformed choice.",
    );
  }

  const message = first.message;

  if (!isRecord(message)) {
    throw new ResearchProviderError(
      OPENROUTER_SEARCH_PROVIDER_ID,
      "The search endpoint returned a completion with no message.",
    );
  }

  // `message.content` is deliberately not read here, or anywhere. See the
  // module docblock: the prose is what a model produces when the plugin was
  // ignored, and it must not be able to enter the pipeline as evidence.
  const annotations = Array.isArray(message.annotations)
    ? message.annotations
    : [];

  const ceiling = Math.max(1, Math.min(maxResults, MAX_CITATIONS));
  const sources: ResearchSource[] = [];
  let citationCount = 0;

  for (const annotation of annotations) {
    const citation = readCitation(annotation);

    if (citation === undefined) {
      continue;
    }

    // Counted before the ceiling and before deduplication, because this is the
    // question "did the service cite anything at all" — not "how many did we
    // keep". A page of citations trimmed to two still means a search ran.
    citationCount += 1;

    if (sources.length >= ceiling) {
      continue;
    }

    sources.push({
      id: createId("source"),
      url: citation.url,
      // Derived here because `ResearchSource` requires it, and derived from the
      // same string the tool will re-derive it from so the two cannot disagree
      // about what this source is. The tool is the authority: it re-derives the
      // domain from the URL it has vetted, and overwrites this value.
      domain: deriveDomain(citation.url),
      ...(citation.title === undefined ? {} : { title: citation.title }),
      ...(citation.content === undefined ? {} : { content: citation.content }),
      providerId: OPENROUTER_SEARCH_PROVIDER_ID,
      rank: citationCount,
      retrievedAt: now(),
    });
  }

  return {
    sources,
    providerId: OPENROUTER_SEARCH_PROVIDER_ID,
    // The load-bearing line. A successful HTTP call is not evidence that a
    // search happened; a citation is. If the plugin was dropped by an endpoint
    // that did not recognise it, the model answered from its weights, the
    // annotations are absent, and this reports that nothing was retrieved —
    // which is true, and which the evaluator then states as `insufficient`
    // rather than as an answer.
    performedRetrieval: citationCount > 0,
  };
}

interface Citation {
  url: string;
  title?: string;
  content?: string;
}

/**
 * Reads one annotation, or nothing.
 *
 * Every field is checked because this is a remote service's output reaching a
 * process that will render it. A URL that is not a non-empty string yields no
 * citation at all rather than a source with an empty one, and a `javascript:`
 * URL is passed through: vetting is the search tool's job and happens in one
 * place, and dropping it here instead would hide it from the tool's
 * `rejectedSourceCount`, which is the number that tells an operator something
 * hostile came back.
 */
function readCitation(annotation: unknown): Citation | undefined {
  if (!isRecord(annotation) || annotation.type !== URL_CITATION_TYPE) {
    return undefined;
  }

  const payload = annotation.url_citation;

  if (!isRecord(payload)) {
    return undefined;
  }

  const url = readNonEmptyString(payload.url);

  if (url === undefined) {
    return undefined;
  }

  const title = readNonEmptyString(payload.title);
  const content = readNonEmptyString(payload.content);

  return {
    url,
    ...(title === undefined ? {} : { title }),
    ...(content === undefined ? {} : { content }),
  };
}

/**
 * The registrable host, lowercased, or the empty string.
 *
 * Never throws and never guesses: a URL that cannot be parsed has no domain,
 * and saying so is better than inventing one. The search tool replaces this
 * value with one derived from the URL it has vetted, so nothing downstream
 * depends on it — it is filled in because the interface requires it, not
 * because anything reads it.
 */
function deriveDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length === 0 ? undefined : trimmed;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
