/**
 * The research provider seam.
 *
 * A second seam beside `agent/provider`, not an extension of it. Retrieval and
 * inference are different capabilities, and §8 of the Phase 5 brief requires
 * that the model must not be the thing that fetches — so the model adapter has
 * no method that can retrieve anything, and this interface has no method that
 * can reason. A run that mixes the two cannot say which of them produced a
 * sentence, and that question is the whole basis of §12.
 *
 * Everything above this file — the planner, the execution loop, the evaluator,
 * the normaliser — knows only this interface. Nothing above it names a vendor,
 * imports a client, or knows a response shape, which is the same property
 * `agent/provider/provider.ts` provides for inference and for the same reason:
 * a retrieval service can be added or replaced without touching the research
 * pipeline.
 *
 * **The `isConfigured` flag is not decoration.** A provider that cannot
 * retrieve is a supported state — it is what a fresh checkout has — and the
 * difference between "no results" and "no way to get results" is the difference
 * between an honest `insufficient` and a lie. A caller that ignored this flag
 * would report a run that never searched as a run that searched and found
 * nothing.
 */

import type { ExecutionProvider } from "@/types/agent";
import type { ResearchSource } from "@/types/research";

export interface ResearchProviderRequest {
  /**
   * What to search for.
   *
   * Untrusted: it originates from model output. It is a query string and
   * nothing else — it is never interpolated into a URL, a header or a command
   * by anything downstream, and the adapter that receives it sends it as a
   * field in a request body.
   */
  query: string;
  /**
   * The most sources the caller wants back.
   *
   * Advisory to the adapter and enforced by the caller. An adapter that ignores
   * it cannot cause unbounded state, because the service caps what it accepts
   * regardless of what it is handed — see `ResearchLimits`.
   */
  maxResults: number;
  /** Which task asked. For provenance only; no adapter should branch on it. */
  taskId?: string;
}

export interface ResearchProviderResponse {
  /**
   * Sources in the order the provider ranked them.
   *
   * Empty is a legitimate and common answer. A provider that found nothing
   * returns an empty array and `performedRetrieval: true`; a provider that
   * could not search at all returns an empty array and
   * `performedRetrieval: false`. The two are not interchangeable.
   */
  sources: ResearchSource[];
  providerId: string;
  /**
   * Whether this call actually reached a retrieval service.
   *
   * False means no search happened, whatever the source list contains. The
   * service records that fact rather than inferring it from an empty array,
   * because inferring it would make "found nothing" and "did not look"
   * indistinguishable in the result.
   */
  performedRetrieval: boolean;
}

/**
 * What a provider reports about itself.
 *
 * The same shape as the domain's `ExecutionProvider`, aliased rather than
 * redefined so the two can never drift — the same choice `ModelProvider`
 * already makes. `isExternal` is the field that matters: when it is false, the
 * run did no real retrieval and every result it produces must be presented
 * accordingly.
 */
export type ResearchProviderDescriptor = ExecutionProvider;

export interface ResearchProvider {
  readonly descriptor: ResearchProviderDescriptor;
  /**
   * Whether this provider can actually retrieve.
   *
   * A property of the provider rather than a return value, because it is a fact
   * about the configuration that does not change between calls, and a caller
   * deciding whether to start a run at all needs it before paying for one.
   */
  readonly isConfigured: boolean;
  search(request: ResearchProviderRequest): Promise<ResearchProviderResponse>;
}

/**
 * Raised when a provider cannot carry out a search.
 *
 * Carries no provider payload: an upstream error can embed the request that
 * produced it, and that request may carry the credential in a header. The
 * message is written to be safe to log and safe to return, and the same rule
 * applies here as in `agent/provider/provider.ts` — which is also why this is a
 * separate class rather than a re-export. A caller catching a research failure
 * should be able to tell it apart from an inference failure without inspecting
 * a string.
 */
export class ResearchProviderError extends Error {
  readonly providerId: string;

  constructor(providerId: string, message: string) {
    super(message);
    this.name = "ResearchProviderError";
    this.providerId = providerId;
  }
}
