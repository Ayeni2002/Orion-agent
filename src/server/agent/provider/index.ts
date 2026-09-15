import { getModelProviderConfig } from "@/lib/env";
import { createDevModelProvider } from "./dev-provider";
import { createOpenAiCompatibleProvider } from "./openai-provider";
import type { ModelProvider } from "./provider";

export type {
  ModelOperation,
  ModelProvider,
  ModelProviderDescriptor,
  ModelProviderRequest,
  ModelProviderResponse,
} from "./provider";
export {
  ModelProviderError,
  parseModelJson,
} from "./provider";
export {
  DEV_MODEL_ID,
  DEV_PROVIDER_ID,
  EXTERNAL_RESEARCH_CAPABILITY,
} from "./dev-provider";
export {
  createOpenAiCompatibleProvider,
  DEFAULT_MODEL_TIMEOUT_MS,
  OPENAI_STYLE_PROVIDER_ID,
} from "./openai-provider";
export type { OpenAiCompatibleProviderConfig } from "./openai-provider";

/**
 * Chooses the provider for this run.
 *
 * The single place in the engine where a concrete provider is named. It does
 * not fall back: if the environment is misconfigured — an unknown style, a
 * remote style with no endpoint, an endpoint that is not a URL —
 * `getModelProviderConfig` throws and the run fails loudly. Silently running
 * the development adapter while the operator believes a real model is
 * configured would make every downstream result a lie, which is a far worse
 * outcome than an error at startup.
 *
 * Two styles exist as of Phase 5. `dev` is the deterministic local adapter;
 * `openai` is any endpoint speaking the OpenAI-compatible chat completions
 * protocol, which is how OpenRouter, Groq, Together, vLLM and OpenAI itself are
 * all reached. The switch is exhaustive over `SUPPORTED_API_STYLES`, so adding
 * a style without adding its adapter is a compile error rather than a runtime
 * surprise.
 *
 * Returns a fresh instance per call. Providers are cheap and stateless, and
 * constructing one per execution means no credential or connection is cached
 * across requests — the credential itself is not held here at all, and is read
 * inside the adapter at the moment it is written into a header.
 */
export function resolveModelProvider(): ModelProvider {
  const config = getModelProviderConfig();

  switch (config.style) {
    case "dev":
      return createDevModelProvider(config.model);

    case "openai": {
      // `getModelProviderConfig` has already established that both are present
      // for this style, and that the endpoint parses as a URL. Repeating the
      // check is what lets the compiler see the same thing, and it turns any
      // future loosening of that validation into a loud failure at startup
      // rather than a request to `undefined/chat/completions`.
      if (config.endpoint === undefined || config.model === undefined) {
        throw new Error(
          'The "openai" API style needs both LLM_ENDPOINT and LLM_MODEL.',
        );
      }

      return createOpenAiCompatibleProvider({
        endpoint: config.endpoint,
        model: config.model,
      });
    }
  }
}
