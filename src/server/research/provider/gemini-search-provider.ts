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
 * The Gemini grounding retrieval adapter.
 *
 * Retrieval here is Google Search grounding: a `generateContent` call carrying
 * `tools: [{ google_search: {} }]`, which lets the model search and returns the
 * pages it drew on alongside the answer.
 *
 * **What this adapter reads, and what it refuses to read.** This is the whole
 * of the file's design, so it is stated before anything else.
 *
 * `groundingMetadata` carries two different kinds of thing, and they are not
 * interchangeable:
 *
 *   - `groundingChunks[].web.uri` and `.title` — the pages the search returned.
 *     These are **evidence**: a locator for something that exists outside Orion.
 *   - `groundingSupports[].segment.text` — passages of the *model's own answer*,
 *     with `groundingChunkIndices` saying which chunk supports each one.
 *
 * The second is **generated text**, and it is not read here. It is tempting,
 * because it is the only prose in the payload and it sits right next to the
 * chunk indices — but `ResearchSource.content` is treated downstream as the text
 * of the source, and `research_findings` is required to quote it *verbatim*.
 * Copying model prose into that field would produce a finding quoting a source
 * that never contained the sentence, and the quote check would pass, because the
 * check compares the quote against the `content` this adapter had just filled
 * in. That is fabricated evidence wearing a citation, which is the one outcome
 * `provider/provider.ts` and §12 of the brief exist to prevent. `openai`'s
 * adapter discards `message.content` for exactly this reason; this adapter
 * discards `segment.text` for the same one.
 *
 * **The consequence, stated plainly rather than discovered later.** Grounding
 * returns locators, not retrieved passages. Google Search grounding does not
 * hand back the pages' text, so the sources below carry a URL and a title and
 * **no `content`**. Downstream that is a real limitation and it is left visible:
 * the finding extractor has nothing to quote, so a run over Gemini-retrieved
 * sources will report findings it cannot ground, or report the gap. It will not
 * report a quotation from a page it never read. A wrong-looking result that is
 * true beats a right-looking one that is invented, and the live check in
 * `docs/RESEARCH.md` is where this gets measured rather than assumed.
 *
 * **The credential follows `openai-provider.ts` exactly** — read inside
 * `search`, written into one header, never stored on the instance, never
 * returned, never included in an error. The header is `x-goog-api-key` and never
 * a query parameter; see the model adapter for why.
 */

/** The id reported on every source this adapter produces. */
export const GEMINI_SEARCH_PROVIDER_ID = "gemini-google-search";

/**
 * What this adapter calls its far end in an error message.
 *
 * The mirror of the model adapters' noun, so an operator reading "the search
 * endpoint" knows which of a run's two remote calls failed rather than having to
 * infer it from which subsystem logged. Both Gemini adapters talk to the same
 * host, which makes the distinction more useful here, not less: the two calls
 * fail for different reasons and lead to different fixes.
 */
const NOUN = "search endpoint";

/**
 * How long a single grounded search may take.
 *
 * Longer than a plain completion would need, deliberately: a grounded call runs
 * a search behind the model, so it is doing more work than the same request
 * without `tools`. Bounded for the reason every adapter here bounds: retrieval
 * happens inside a request that is waiting on it, and a hung upstream must not
 * hold a run open indefinitely.
 */
export const DEFAULT_GEMINI_SEARCH_TIMEOUT_MS = 90_000;

/**
 * A structural ceiling on how many chunks one response can contribute.
 *
 * The caller's own limit is smaller and is what actually applies; this exists so
 * a malformed or hostile `maxResults` cannot make the loop build an unbounded
 * array before the tool's own cap sees it.
 */
const MAX_GROUNDING_CHUNKS = 50;

/**
 * What the model is asked to do, in its own terms.
 *
 * As in the OpenRouter adapter this is not a correctness mechanism: the search
 * is performed by the `google_search` tool, and the chunks are the only thing
 * read back. It exists to bias the call toward searching rather than answering
 * from weights, and nothing downstream depends on the model obeying it.
 */
const SEARCH_INSTRUCTION = [
  "You are the retrieval component of Orion, a research agent.",
  "Search the web for the query you are given.",
  "Do not answer the query from your own knowledge.",
].join(" ");

export interface GeminiSearchProviderConfig {
  /** Base URL, before `/models/<model>:generateContent` is appended. */
  endpoint: string;
  /** Model id — `gemini-2.0-flash`, optionally written `models/gemini-2.0-flash`. */
  model: string;
  timeoutMs?: number;
}

export function createGeminiSearchProvider(
  config: GeminiSearchProviderConfig,
): ResearchProvider {
  const descriptor: ResearchProviderDescriptor = {
    id: GEMINI_SEARCH_PROVIDER_ID,
    label: "Google Search grounding",
    model: config.model,
    isExternal: true,
  };

  const timeoutMs = config.timeoutMs ?? DEFAULT_GEMINI_SEARCH_TIMEOUT_MS;

  return {
    descriptor,
    // Configured in the sense the interface means: there is somewhere to send
    // the request and a credential to send with it. Whether the endpoint honours
    // `google_search` is a fact this cannot know without calling, which is why a
    // call that grounds nothing reports that rather than assuming it.
    //
    // This is a literal here and derived from the style in `resolveResearchProvider`,
    // and the two say different things on purpose: that function decides *whether
    // this adapter is the right one to construct*, this field reports *that it was
    // constructed with somewhere to send to*. Neither claims a search succeeded.
    isConfigured: true,

    async search(
      request: ResearchProviderRequest,
    ): Promise<ResearchProviderResponse> {
      const url = buildGenerateContentUrl(config.endpoint, config.model);
      const apiKey = readModelApiKey();

      let response: Response;

      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Header, never `?key=`. See `gemini-provider.ts` for the reasoning;
            // it applies here unchanged, and the test asserting the key does not
            // appear in the request URL covers both adapters.
            ...(apiKey === undefined ? {} : { "x-goog-api-key": apiKey }),
          },
          body: JSON.stringify(buildSearchRequestBody(request.query)),
          // Aborts the request itself, not merely the wait for it, so a
          // timed-out call does not keep a socket open behind the error.
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        // Nothing from `error` is forwarded: a fetch failure can carry the
        // request that produced it, and that request has the header on it.
        throw new ResearchProviderError(
          GEMINI_SEARCH_PROVIDER_ID,
          describeTransportFailure(error, timeoutMs, NOUN),
        );
      }

      if (!response.ok) {
        throw new ResearchProviderError(
          GEMINI_SEARCH_PROVIDER_ID,
          await describeHttpFailure(response, NOUN),
        );
      }

      const body = await readJsonResponse(response, NOUN);

      if (!body.ok) {
        throw new ResearchProviderError(GEMINI_SEARCH_PROVIDER_ID, body.message);
      }

      return toSearchResponse(body.value, request.maxResults);
    },
  };
}

/**
 * The endpoint, with the model in the path.
 *
 * Duplicated from `gemini-provider.ts` rather than shared, and the duplication
 * is deliberate: the alternative is the research layer importing a helper out of
 * the agent layer, which inverts the dependency that keeps the agent engine
 * unaware of the subsystem built on top of it. The two are asserted equal by the
 * one thing that matters — both build a URL their own tests read — so a drift
 * would show up as a failing test rather than as a request to the wrong path.
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
 * The query goes in as `parts[0].text` and nowhere else. It originates from
 * model output and is untrusted, and a field in a JSON body is the one place it
 * cannot do harm — it is never interpolated into the URL, a header, or a
 * command.
 *
 * `tools: [{ google_search: {} }]` is the entire mechanism, and the empty object
 * is not an oversight: the search tool takes no configuration here. As in the
 * OpenRouter adapter, no optional field is sent — an option the service does not
 * recognise is a chance of a rejected request, and the per-task ceiling is
 * enforced locally anyway. The cheapest *correct* request beats the cheapest
 * possible one.
 *
 * Note what is absent: no `responseMimeType`. A grounded call needs a free-text
 * answer for the search to attach chunks to, and constraining the model to JSON
 * would be asking it to search and then not write anything.
 */
function buildSearchRequestBody(query: string): Record<string, unknown> {
  return {
    contents: [{ role: "user", parts: [{ text: query }] }],
    systemInstruction: { parts: [{ text: SEARCH_INSTRUCTION }] },
    tools: [{ google_search: {} }],
  };
}

/**
 * Turns an untrusted payload into a `ResearchProviderResponse`.
 *
 * Throws on a body that is not a `generateContent` response at all, because that
 * means the endpoint is not speaking the protocol this adapter was written for,
 * and reporting it as "no sources" would hide a misconfiguration behind an
 * ordinary-looking empty result. A response that simply carries no grounding
 * metadata is the opposite case and is not an error — see `performedRetrieval`.
 */
function toSearchResponse(
  payload: unknown,
  maxResults: number,
): ResearchProviderResponse {
  if (!isRecord(payload)) {
    throw new ResearchProviderError(
      GEMINI_SEARCH_PROVIDER_ID,
      "The search endpoint returned a JSON value that was not an object.",
    );
  }

  const candidates = payload.candidates;

  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new ResearchProviderError(
      GEMINI_SEARCH_PROVIDER_ID,
      "The search endpoint returned no candidates.",
    );
  }

  const first: unknown = candidates[0];

  if (!isRecord(first)) {
    throw new ResearchProviderError(
      GEMINI_SEARCH_PROVIDER_ID,
      "The search endpoint returned a malformed candidate.",
    );
  }

  // `first.content` is deliberately not read here, or anywhere in this file. See
  // the module docblock: the answer is what a model produces when grounding did
  // not happen, and it must not be able to enter the pipeline as evidence. The
  // same applies to `groundingSupports[].segment.text`, which is why
  // `readGroundingChunks` below looks only at the chunks.
  const metadata = first.groundingMetadata;
  const chunks = isRecord(metadata) && Array.isArray(metadata.groundingChunks)
    ? metadata.groundingChunks
    : [];

  const ceiling = Math.max(1, Math.min(maxResults, MAX_GROUNDING_CHUNKS));
  const seen = new Set<string>();
  const sources: ResearchSource[] = [];
  let groundedChunkCount = 0;

  for (const chunk of chunks) {
    const candidate = readChunk(chunk);

    if (candidate === undefined) {
      continue;
    }

    // Counted before deduplication and before the ceiling, because this is the
    // question "did a search happen at all" — not "how many did we keep". A
    // response grounding twenty claims in four pages still means a search ran.
    groundedChunkCount += 1;

    // Deduplicated by URL, which the OpenRouter adapter has no need to do and
    // this one does. Grounding emits one chunk per *supported claim*, so a page
    // cited for several claims arrives several times — and without this, a
    // `maxSourcesPerTask` of five could be spent on one page listed five times.
    // The run would then report five sources where it had one, which is a
    // quantity claim a reader would take at face value.
    if (seen.has(candidate.url)) {
      continue;
    }

    seen.add(candidate.url);

    if (sources.length >= ceiling) {
      continue;
    }

    sources.push({
      id: createId("source"),
      url: candidate.url,
      // Derived here because `ResearchSource` requires it, and derived from the
      // same string the tool will re-derive it from so the two cannot disagree
      // about what this source is. The tool is the authority: it re-derives the
      // domain from the URL it has vetted, and overwrites this value.
      domain: deriveDomain(candidate.url),
      ...(candidate.title === undefined ? {} : { title: candidate.title }),
      providerId: GEMINI_SEARCH_PROVIDER_ID,
      rank: sources.length + 1,
      retrievedAt: now(),
      // No `content`, and that absence is load-bearing rather than an omission.
      // See the module docblock: the only prose in a grounding response is the
      // model's own, and a source carrying it would make the finding extractor's
      // verbatim-quote check pass against a sentence no page ever contained.
    });
  }

  return {
    sources,
    providerId: GEMINI_SEARCH_PROVIDER_ID,
    // A successful HTTP call is not evidence that a search happened; a grounding
    // chunk is. If `google_search` was ignored, the model answered from its
    // weights, the metadata is absent, and this reports that nothing was
    // retrieved — which is true, and which the evaluator then states as
    // `insufficient` rather than as an answer.
    //
    // This is also the behaviour that makes an unrecognised shape safe. The one
    // thing this adapter cannot verify offline is the exact spelling of Gemini's
    // grounding payload; if it has been misread, no chunks are found here, and
    // the run reports that it retrieved nothing. A wrong guess therefore costs a
    // failed search, never a fabricated source.
    performedRetrieval: groundedChunkCount > 0,
  };
}

interface GroundingChunk {
  url: string;
  title?: string;
}

/**
 * Reads one grounding chunk, or nothing.
 *
 * Only `web.uri` and `web.title` are read — the locator, never any text. Every
 * field is checked because this is a remote service's output reaching a process
 * that will render it, and a chunk whose URI is not a non-empty string yields no
 * source rather than a source with an empty URL.
 *
 * A `javascript:` or otherwise hostile URL is passed through deliberately.
 * Vetting is the search tool's job and happens in exactly one place
 * (`research/tools/search.ts`), and dropping a bad URL here instead would hide it
 * from that tool's `rejectedSourceCount` — the number that tells an operator
 * something hostile came back.
 */
function readChunk(chunk: unknown): GroundingChunk | undefined {
  if (!isRecord(chunk)) {
    return undefined;
  }

  const web = chunk.web;

  if (!isRecord(web)) {
    return undefined;
  }

  const url = readNonEmptyString(web.uri);

  if (url === undefined) {
    return undefined;
  }

  const title = readNonEmptyString(web.title);

  return { url, ...(title === undefined ? {} : { title }) };
}

/**
 * The registrable host, lowercased, or the empty string.
 *
 * Never throws and never guesses: a URL that cannot be parsed has no domain, and
 * saying so is better than inventing one. The search tool replaces this value
 * with one derived from the URL it has vetted, so nothing downstream depends on
 * it — it is filled in because the interface requires it, not because anything
 * reads it.
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
