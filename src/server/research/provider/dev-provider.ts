import type {
  ResearchProvider,
  ResearchProviderDescriptor,
  ResearchProviderRequest,
  ResearchProviderResponse,
} from "./provider";

/**
 * The development retrieval adapter.
 *
 * It performs no retrieval, and that is the entire point. The obvious thing to
 * put here — a small fixture of plausible-looking sources — is the one thing
 * that must not be: §12 of the Phase 5 brief forbids inventing facts not
 * supported by retrieved sources, and a development adapter that manufactured
 * URLs would put fabricated evidence into the same pipeline that real evidence
 * travels, distinguishable only by whoever remembered which mode they were in.
 *
 * So it returns nothing, and says so twice. `isConfigured` is false, which lets
 * a caller decide before starting a run; `performedRetrieval` is false, which
 * records on the result that no search happened. A research run against this
 * adapter completes with `sufficiency: "insufficient"` — which is the truth.
 *
 * What it is for is exercising everything that is not retrieval: planning,
 * task execution, normalisation, deduplication, the evidence chain and the
 * evaluator all run their real code paths against it. Tests that need sources
 * to exist use the scripted provider in `./stub-provider`, which is explicit
 * about being a test double rather than a stand-in for a working system.
 *
 * Compare `agent/provider/dev-provider.ts`, which *does* produce output. The
 * difference is not an inconsistency: a deterministic plan is a real answer to
 * "what steps would this objective decompose into", whereas a deterministic
 * source list would be a fabricated answer to "what does the web say". The
 * first is a stand-in for inference; the second would be a stand-in for fact.
 */

export const DEV_RESEARCH_PROVIDER_ID = "dev";

/**
 * The model field of the descriptor, for a provider that uses no model.
 *
 * Spelled rather than left empty so the workspace can render it without a
 * conditional, and chosen to read correctly if it ever is: an execution whose
 * provider model is "none" has plainly not been to a model.
 */
export const DEV_RESEARCH_MODEL_ID = "none";

export function createDevResearchProvider(): ResearchProvider {
  const descriptor: ResearchProviderDescriptor = {
    id: DEV_RESEARCH_PROVIDER_ID,
    label: "Deterministic development adapter (performs no retrieval)",
    model: DEV_RESEARCH_MODEL_ID,
    isExternal: false,
  };

  return {
    descriptor,
    isConfigured: false,

    async search(
      _request: ResearchProviderRequest,
    ): Promise<ResearchProviderResponse> {
      // The query is deliberately not read. Any use of it here would be a use
      // that produced sources, and there is no honest way to do that.
      return {
        sources: [],
        providerId: DEV_RESEARCH_PROVIDER_ID,
        performedRetrieval: false,
      };
    },
  };
}
