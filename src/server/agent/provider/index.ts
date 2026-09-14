import { getModelProviderConfig } from "@/lib/env";
import { createDevModelProvider } from "./dev-provider";
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

/**
 * Chooses the provider for this run.
 *
 * The single place in the engine where a concrete provider is named. It does
 * not fall back: if the environment names a provider Orion does not implement,
 * `getModelProviderConfig` throws and the run fails loudly. Silently running the
 * development adapter while the operator believes a real model is configured
 * would make every downstream result a lie, which is a far worse outcome than
 * an error at startup.
 *
 * Returns a fresh instance per call. Providers are cheap, stateless, and
 * constructing one per execution means no credential or connection is cached
 * across requests.
 */
export function resolveModelProvider(): ModelProvider {
  const config = getModelProviderConfig();

  switch (config.provider) {
    case "dev":
      return createDevModelProvider(config.model);
  }
}
