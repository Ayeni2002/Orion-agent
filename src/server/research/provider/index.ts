import { getModelProviderConfig, getResearchConfig } from "@/lib/env";

import { createDevResearchProvider } from "./dev-provider";
import { createGeminiSearchProvider } from "./gemini-search-provider";
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
export {
  DEFAULT_GEMINI_SEARCH_TIMEOUT_MS,
  GEMINI_SEARCH_PROVIDER_ID,
  createGeminiSearchProvider,
} from "./gemini-search-provider";
export type { GeminiSearchProviderConfig } from "./gemini-search-provider";

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
 * Scoped to the `openai` branch of the resolver below, and this constant is why
 * the `gemini` branch does not need one. `openai` names a protocol many vendors
 * speak, so the host has to be inspected to find out whether retrieval is
 * possible; `gemini` names a protocol one vendor speaks, whose search is part of
 * the same call rather than a plugin that may be absent. There is nothing to
 * inspect, so there is no list here to keep, and no lookalike host to defend
 * against.
 *
 * So a non-OpenRouter `openai` endpoint resolves to the development adapter,
 * whose `isConfigured` is false, and the run stops with `search_not_configured`
 * — which is the truth, and whose message already names what to change. Adding a
 * second search-capable OpenAI-compatible gateway means adding its host here,
 * deliberately, which is the review this deserves.
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
 * **Where retrieval comes from.** There are two answers, and they are answered
 * differently because the underlying facts differ.
 *
 *   - `openai`: OpenRouter's web search is a chat completion with a plugin
 *     attached, so it needs no endpoint of its own. An operator who has pointed
 *     `LLM_API_STYLE` at OpenRouter has already configured retrieval — which is
 *     why there is no `RESEARCH_ENDPOINT` to set.
 *   - `gemini`: grounding is a `tools` entry on the same `generateContent` call
 *     the model adapter already makes, at the same endpoint with the same key,
 *     for the same reason. Also nothing further to configure.
 *
 * `RESEARCH_SEARCH_MODEL` is the one knob for both, and it means the same thing
 * in each: retrieval and planning have different appetites, and an operator may
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

  // Both remaining styles need a model id, and `getModelProviderConfig` has
  // established that. Both also have an endpoint by this point — for `openai`
  // because it was required, for `gemini` because `GEMINI_API_ENDPOINT` filled
  // it in — but the check is repeated here for the reason
  // `agent/provider/index.ts` repeats its own: it lets the compiler see what the
  // config layer established, and it turns any future loosening of that
  // validation into a loud failure rather than a request to an undefined host.
  if (model.endpoint === undefined || model.model === undefined) {
    throw new Error(
      `The "${model.style}" API style needs an endpoint and a model id.`,
    );
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

  // **Derived from the style, not from the host**, and this is the one place the
  // Gemini path is simpler than the OpenRouter one rather than merely parallel
  // to it. Grounding is not a plugin a host may or may not implement; it is part
  // of the one endpoint and the one credential, so `style === "gemini"` settles
  // the question with nothing left to inspect. There is no hostile-lookalike
  // case to defend against because there is no string being matched.
  if (model.style === "gemini") {
    return createGeminiSearchProvider({
      endpoint: model.endpoint,
      model: searchModel ?? model.model,
    });
  }

  if (!isSearchCapableEndpoint(model.endpoint)) {
    return createDevResearchProvider();
  }

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
