import { getModelProviderConfig, getResearchConfig } from "@/lib/env";

import { createDevResearchProvider } from "./dev-provider";
import { createOpenRouterSearchProvider } from "./openrouter-search-provider";
import type { ResearchProvider } from "./provider";

export type {
  ResearchProvider,
  ResearchProviderDescriptor,
  ResearchProviderRequest,
  ResearchProviderResponse,
} from "./provider";
export { ResearchProviderError } from "./provider";
export {
  DEV_RESEARCH_MODEL_ID,
  DEV_RESEARCH_PROVIDER_ID,
  createDevResearchProvider,
} from "./dev-provider";
export {
  DEFAULT_SEARCH_TIMEOUT_MS,
  OPENROUTER_SEARCH_PROVIDER_ID,
  createOpenRouterSearchProvider,
} from "./openrouter-search-provider";
export type { OpenRouterSearchProviderConfig } from "./openrouter-search-provider";

/**
 * The host whose web-search plugin this build knows how to ask.
 *
 * A hostname rather than "any OpenAI-compatible endpoint", and the narrowness is
 * the point. `LLM_API_STYLE=openai` covers OpenRouter, Groq, Together, vLLM, LM
 * Studio and OpenAI itself — every one of which speaks `/chat/completions`, and
 * only one of which has a `web` plugin this adapter was written for. Sending
 * `plugins: [{ id: "web" }]` to a local vLLM would be ignored, the model would
 * answer from its weights, and the run would be configured, would be reached,
 * and would retrieve nothing: the exact state §3 of the brief rules out.
 *
 * So a non-OpenRouter endpoint resolves to the development adapter, whose
 * `isConfigured` is false, and the run stops with `search_not_configured` —
 * which is the truth, and whose message already names what to change. Adding a
 * second search-capable gateway means adding its host here, deliberately, which
 * is the review this deserves.
 */
const OPENROUTER_HOST = "openrouter.ai";

/**
 * Chooses the retrieval provider for this run.
 *
 * The single place in the research layer where a concrete provider is named, and
 * the exact mirror of `agent/provider/index.ts`. It does not fall back: if the
 * environment is misconfigured, `getModelProviderConfig` throws and the run
 * fails loudly rather than silently retrieving nothing while the operator
 * believes search is on.
 *
 * **Where retrieval comes from.** OpenRouter's web search is a chat completion
 * with a plugin attached, so it needs no endpoint of its own: an operator who
 * has pointed `LLM_API_STYLE` at OpenRouter has already configured retrieval,
 * which is why `getResearchConfig` carries no endpoint and no credential and why
 * there is no `RESEARCH_ENDPOINT` to set. `RESEARCH_SEARCH_MODEL` is the one
 * knob — retrieval and planning have different appetites, and an operator may
 * want a cheaper model fetching and a stronger one reasoning.
 *
 * Returns a fresh instance per call, for the reason the model resolver gives:
 * providers are cheap and stateless, and nothing about a credential is cached
 * across requests because the credential is not held here at all.
 */
export function resolveResearchProvider(): ResearchProvider {
  const model = getModelProviderConfig();

  if (model.style === "dev") {
    return createDevResearchProvider();
  }

  // `getModelProviderConfig` has already established that both are present for
  // this style, and that the endpoint parses as a URL. Repeating the check is
  // what lets the compiler see the same thing, and it turns any future loosening
  // of that validation into a loud failure rather than a request to
  // `undefined/chat/completions`.
  if (model.endpoint === undefined || model.model === undefined) {
    throw new Error(
      'The "openai" API style needs both LLM_ENDPOINT and LLM_MODEL.',
    );
  }

  if (!isSearchCapableEndpoint(model.endpoint)) {
    return createDevResearchProvider();
  }

  // Read here rather than threaded in, because this is the point of use
  // `lib/env.ts` documents for it: absent, and it falls back to `LLM_MODEL`.
  //
  // This reads the *whole* research config, limits included, so a malformed
  // limit throws from here as well as from the service's own read two lines
  // later. That is not a second validation path — both land in the service's
  // single `catch` and become the same `internal_error` carrying the same named
  // message — but it is a coupling worth stating rather than discovering, and
  // `index.test.ts` asserts it. Splitting a `getResearchSearchModel()` out to
  // avoid it would put research configuration behind two readers for no
  // observable difference.
  const { searchModel } = getResearchConfig();

  return createOpenRouterSearchProvider({
    endpoint: model.endpoint,
    model: searchModel ?? model.model,
  });
}

function isSearchCapableEndpoint(endpoint: string): boolean {
  let hostname: string;

  try {
    hostname = new URL(endpoint).hostname.toLowerCase();
  } catch {
    // Unreachable: `getModelProviderConfig` validated this as a URL. Returning
    // false rather than throwing keeps the failure mode "no retrieval" instead
    // of a crash if that ever stops being true.
    return false;
  }

  return (
    hostname === OPENROUTER_HOST || hostname.endsWith(`.${OPENROUTER_HOST}`)
  );
}
