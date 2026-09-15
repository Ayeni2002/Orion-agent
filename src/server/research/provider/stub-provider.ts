import { createId, now } from "@/server/agent/ids";
import type { ResearchSource } from "@/types/research";

import type {
  ResearchProvider,
  ResearchProviderDescriptor,
  ResearchProviderRequest,
  ResearchProviderResponse,
} from "./provider";

/**
 * A scripted retrieval provider, for tests.
 *
 * The research mirror of `agent/provider/stub-provider.ts`, and it exists for
 * the same two reasons. It lets a test drive the real planner, the real
 * normaliser, the real deduplicator and the real evaluator against retrieval
 * output the test chose, so the test exercises the subsystem rather than a mock
 * of it. And it is the second implementation of `ResearchProvider`, which is
 * the practical evidence that the seam is real rather than intended.
 *
 * It is NOT wired into `resolveResearchProvider` and must not be: it is a test
 * double, and a test double reachable from production configuration is a way to
 * put fabricated sources into a real result.
 *
 * The distinction from `dev-provider.ts` matters and is not cosmetic. The
 * development adapter retrieves nothing and reports `isConfigured: false`,
 * because a deterministic answer to "what does the web say" would be invented
 * fact. This provider *does* return sources — because a test asked for exactly
 * those sources, and a test that says so is not claiming anything about the
 * world.
 */

/** What a scripted search returns: sources, or a full response to control flags. */
export type StubSearchResult = ResearchSource[] | ResearchProviderResponse;

export interface StubResearchScript {
  search?: (request: ResearchProviderRequest) => StubSearchResult;
}

export interface StubResearchProviderOptions {
  script: StubResearchScript;
  /** Defaults to a non-external identity, so a test never implies real retrieval. */
  descriptor?: Partial<ResearchProviderDescriptor>;
  /** Defaults to true: a stub that a test wired up can be searched. */
  isConfigured?: boolean;
  /** Number of times `search` was called. Passed in so a test can read it back. */
  calls?: { search: number };
}

export const STUB_RESEARCH_PROVIDER_ID = "stub";

export function createStubResearchProvider({
  script,
  descriptor,
  isConfigured = true,
  calls,
}: StubResearchProviderOptions): ResearchProvider {
  const recorded = calls ?? { search: 0 };

  const resolved: ResearchProviderDescriptor = {
    id: STUB_RESEARCH_PROVIDER_ID,
    label: "Scripted test provider",
    model: "scripted",
    isExternal: false,
    ...descriptor,
  };

  return {
    descriptor: resolved,
    isConfigured,

    async search(
      request: ResearchProviderRequest,
    ): Promise<ResearchProviderResponse> {
      recorded.search += 1;

      const result = script.search?.(request);

      if (result === undefined) {
        return {
          sources: [],
          providerId: resolved.id,
          performedRetrieval: true,
        };
      }

      if (Array.isArray(result)) {
        return {
          sources: result,
          providerId: resolved.id,
          performedRetrieval: true,
        };
      }

      return result;
    },
  };
}

/**
 * Builds a source with the fields a test does not care about filled in.
 *
 * `url` is required because it is the only field that cannot be defaulted
 * honestly — a source with a made-up-looking default URL invites a test to
 * assert against a value nobody chose.
 */
export function sourceFixture(
  url: string,
  overrides: Partial<Omit<ResearchSource, "url">> = {},
): ResearchSource {
  const { hostname } = new URL(url);

  return {
    id: createId("source"),
    url,
    // Derived here exactly as the normaliser derives it, so a fixture and a
    // real source cannot disagree about what a source's domain is.
    domain: hostname.toLowerCase().replace(/^www\./, ""),
    providerId: STUB_RESEARCH_PROVIDER_ID,
    retrievedAt: now(),
    ...overrides,
  };
}

/**
 * A response that reports no retrieval happened.
 *
 * For tests that need an unconfigured or failing provider without reaching for
 * an empty script, which would set `performedRetrieval: true` and assert the
 * opposite of what the test means.
 */
export function noRetrievalResponse(
  providerId: string = STUB_RESEARCH_PROVIDER_ID,
): ResearchProviderResponse {
  return { sources: [], providerId, performedRetrieval: false };
}
