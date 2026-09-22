import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveResearchProvider } from "./index";
import { DEV_RESEARCH_PROVIDER_ID } from "./dev-provider";
import { GEMINI_SEARCH_PROVIDER_ID } from "./gemini-search-provider";
import { OPENROUTER_SEARCH_PROVIDER_ID } from "./openrouter-search-provider";

/**
 * Which retrieval provider a given environment resolves to.
 *
 * This is the decision `docs/RESEARCH.md` describes as "derived rather than
 * declared", and the file exists because it is the one place where a
 * configuration mistake becomes a capability claim. Resolving to the real
 * adapter when the endpoint cannot serve it would make `searchConfigured` true
 * for a build that retrieves nothing — the state §3 of the Phase 5 brief rules
 * out, and the one that looks like it works.
 *
 * Every variable read is stubbed in every test, including the ones left empty.
 * Vitest does not load `.env.local`, but the shell's own environment is
 * inherited, and a test that asserted the defaults without stubbing would pass
 * on a clean machine and fail on the operator's.
 *
 * No test makes a network call, and none reads a credential. Resolving a
 * provider constructs one; it does not use it.
 */

const FAKE_KEY = "test-key-not-a-real-credential";

function clearEnv() {
  vi.stubEnv("LLM_API_STYLE", "");
  vi.stubEnv("LLM_ENDPOINT", "");
  vi.stubEnv("LLM_MODEL", "");
  vi.stubEnv("LLM_API_KEY", "");
  vi.stubEnv("RESEARCH_SEARCH_MODEL", "");
  // Stubbed even though this file is about *which provider* resolves, because
  // the OpenRouter branch reaches `getResearchConfig()` for its search model and
  // that call reads every limit. Leaving them unstubbed would let an operator's
  // own shell environment decide whether these tests pass.
  vi.stubEnv("RESEARCH_MAX_TASKS", "");
  vi.stubEnv("RESEARCH_MAX_SOURCES_PER_TASK", "");
  vi.stubEnv("RESEARCH_MAX_SOURCES", "");
  vi.stubEnv("RESEARCH_MAX_FINDINGS", "");
  vi.stubEnv("RESEARCH_MAX_DURATION_MS", "");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("with nothing configured", () => {
  it("resolves to the development adapter", () => {
    clearEnv();

    // A fresh checkout has no retrieval, and says so rather than appearing to
    // search and finding nothing.
    expect(resolveResearchProvider().descriptor.id).toBe(
      DEV_RESEARCH_PROVIDER_ID,
    );
  });

  it("reports itself as unconfigured", () => {
    clearEnv();

    expect(resolveResearchProvider().isConfigured).toBe(false);
  });
});

describe("with an OpenRouter endpoint configured", () => {
  function configureOpenRouter() {
    clearEnv();
    vi.stubEnv("LLM_API_STYLE", "openai");
    vi.stubEnv("LLM_ENDPOINT", "https://openrouter.ai/api/v1");
    vi.stubEnv("LLM_MODEL", "openai/gpt-4o");
    vi.stubEnv("LLM_API_KEY", FAKE_KEY);
  }

  it("resolves to the web-search adapter", () => {
    configureOpenRouter();

    expect(resolveResearchProvider().descriptor.id).toBe(
      OPENROUTER_SEARCH_PROVIDER_ID,
    );
  });

  it("reports retrieval as configured", () => {
    configureOpenRouter();

    expect(resolveResearchProvider().isConfigured).toBe(true);
  });

  it("reports the provider as external, so a result is labelled honestly", () => {
    configureOpenRouter();

    expect(resolveResearchProvider().descriptor.isExternal).toBe(true);
  });

  it("uses the planning model when no search model is set", () => {
    configureOpenRouter();

    expect(resolveResearchProvider().descriptor.model).toBe("openai/gpt-4o");
  });

  it("uses the search model when one is set", () => {
    configureOpenRouter();
    vi.stubEnv("RESEARCH_SEARCH_MODEL", "openai/gpt-4o-mini");

    // The whole reason the variable exists: a cheaper model fetching, a
    // stronger one reasoning, without a second endpoint.
    expect(resolveResearchProvider().descriptor.model).toBe("openai/gpt-4o-mini");
  });

  it("accepts a subdomain of the search host", () => {
    configureOpenRouter();
    vi.stubEnv("LLM_ENDPOINT", "https://gateway.openrouter.ai/api/v1");

    expect(resolveResearchProvider().descriptor.id).toBe(
      OPENROUTER_SEARCH_PROVIDER_ID,
    );
  });

  it("never carries the credential onto the descriptor", () => {
    configureOpenRouter();

    // The descriptor is spread into execution records and rendered by the
    // workspace, so a credential on it would travel with every copy.
    expect(JSON.stringify(resolveResearchProvider().descriptor)).not.toContain(
      FAKE_KEY,
    );
  });

  it("resolves without a credential, because a key is a request-time concern", () => {
    configureOpenRouter();
    vi.stubEnv("LLM_API_KEY", "");

    // Resolution decides *where* retrieval goes, not whether it is authorised.
    // A missing key becomes a 401 from the endpoint, which the adapter reports.
    expect(resolveResearchProvider().descriptor.id).toBe(
      OPENROUTER_SEARCH_PROVIDER_ID,
    );
  });
});

describe("with a Gemini style configured", () => {
  function configureGemini() {
    clearEnv();
    vi.stubEnv("LLM_API_STYLE", "gemini");
    vi.stubEnv("LLM_MODEL", "gemini-2.0-flash");
    vi.stubEnv("LLM_API_KEY", FAKE_KEY);
  }

  it("resolves to the grounding adapter", () => {
    configureGemini();

    expect(resolveResearchProvider().descriptor.id).toBe(
      GEMINI_SEARCH_PROVIDER_ID,
    );
  });

  it("resolves to it without an endpoint being set at all", () => {
    configureGemini();

    // The difference from the OpenRouter case, asserted rather than implied.
    // Grounding is part of the endpoint `GEMINI_API_ENDPOINT` supplies, so
    // there is no host for the operator to name and none for this function to
    // inspect.
    expect(resolveResearchProvider().descriptor.id).toBe(
      GEMINI_SEARCH_PROVIDER_ID,
    );
  });

  it("reports retrieval as configured", () => {
    configureGemini();

    expect(resolveResearchProvider().isConfigured).toBe(true);
  });

  it("reports the provider as external, so a result is labelled honestly", () => {
    configureGemini();

    expect(resolveResearchProvider().descriptor.isExternal).toBe(true);
  });

  it("uses the planning model when no search model is set", () => {
    configureGemini();

    expect(resolveResearchProvider().descriptor.model).toBe("gemini-2.0-flash");
  });

  it("uses the search model when one is set", () => {
    configureGemini();
    vi.stubEnv("RESEARCH_SEARCH_MODEL", "gemini-2.0-flash-lite");

    // The same knob, meaning the same thing as it does for OpenRouter: a
    // cheaper model fetching, a stronger one reasoning.
    expect(resolveResearchProvider().descriptor.model).toBe(
      "gemini-2.0-flash-lite",
    );
  });

  it("never carries the credential onto the descriptor", () => {
    configureGemini();

    // The descriptor is spread into execution records and rendered by the
    // workspace, so a credential on it would travel with every copy.
    expect(JSON.stringify(resolveResearchProvider().descriptor)).not.toContain(
      FAKE_KEY,
    );
  });

  // The `openai` branch has to defend against lookalike hosts because it matches
  // on one. This branch matches on nothing, so there is no string to spoof — and
  // this test states that the absence is a property of the design rather than an
  // untested assumption.
  it("does not consult the endpoint when choosing this adapter", () => {
    configureGemini();
    vi.stubEnv("LLM_ENDPOINT", "https://evil.example/v1");

    expect(resolveResearchProvider().descriptor.id).toBe(
      GEMINI_SEARCH_PROVIDER_ID,
    );
  });
});

describe("with an OpenAI-compatible endpoint that is not OpenRouter", () => {
  function configureOtherEndpoint(endpoint: string) {
    clearEnv();
    vi.stubEnv("LLM_API_STYLE", "openai");
    vi.stubEnv("LLM_ENDPOINT", endpoint);
    vi.stubEnv("LLM_MODEL", "llama-3.1-70b");
  }

  // The decision that keeps `searchConfigured` meaningful. Every one of these
  // fields speaks `/chat/completions`; none of them has a `web` plugin this
  // adapter was written for, and a request carrying one would be ignored while
  // the run reported itself as searching.
  it.each([
    ["a local inference server", "http://localhost:1234/v1"],
    ["a different gateway", "https://api.groq.com/openai/v1"],
    ["a lookalike host", "https://notopenrouter.ai/api/v1"],
    ["the host as a prefix of another", "https://openrouter.ai.evil.example/v1"],
    ["the host in a query string", "https://evil.example/v1?to=openrouter.ai"],
  ])("resolves to the development adapter for %s", (_label, endpoint) => {
    configureOtherEndpoint(endpoint);

    const provider = resolveResearchProvider();

    expect(provider.descriptor.id).toBe(DEV_RESEARCH_PROVIDER_ID);
    expect(provider.isConfigured).toBe(false);
  });
});

describe("with a configuration that cannot work", () => {
  it("throws rather than falling back when the style is unknown", () => {
    clearEnv();
    vi.stubEnv("LLM_API_STYLE", "anthropic");

    // Falling back to the development adapter while the operator believes a
    // real model is configured would make every result a lie.
    expect(() => resolveResearchProvider()).toThrow(/LLM_API_STYLE/);
  });

  it("throws when a remote style has no endpoint", () => {
    clearEnv();
    vi.stubEnv("LLM_API_STYLE", "openai");
    vi.stubEnv("LLM_MODEL", "openai/gpt-4o");

    expect(() => resolveResearchProvider()).toThrow(/LLM_ENDPOINT/);
  });

  it("throws when a remote style has no model", () => {
    clearEnv();
    vi.stubEnv("LLM_API_STYLE", "openai");
    vi.stubEnv("LLM_ENDPOINT", "https://openrouter.ai/api/v1");

    expect(() => resolveResearchProvider()).toThrow(/LLM_MODEL/);
  });

  it("throws when the endpoint is not a URL", () => {
    clearEnv();
    vi.stubEnv("LLM_API_STYLE", "openai");
    vi.stubEnv("LLM_ENDPOINT", "openrouter.ai/api/v1");
    vi.stubEnv("LLM_MODEL", "openai/gpt-4o");

    expect(() => resolveResearchProvider()).toThrow(/LLM_ENDPOINT/);
  });

  // `resolveResearchProvider` reads `getResearchConfig()` to find the search
  // model, and that function validates every limit on the way through — so a
  // malformed limit is one of the failures resolving a provider can raise.
  // Named, which is the point, rather than silently defaulted to 20.
  //
  // This is not a second validation path: the service reads the limits itself
  // on the very next line and catches both into the same `internal_error`, so
  // which of the two reports it first is not observable from a run. It is
  // asserted here so that the coupling is stated rather than discovered.
  it("reports a malformed limit by name rather than defaulting it", () => {
    clearEnv();
    vi.stubEnv("LLM_API_STYLE", "openai");
    vi.stubEnv("LLM_ENDPOINT", "https://openrouter.ai/api/v1");
    vi.stubEnv("LLM_MODEL", "openai/gpt-4o");
    vi.stubEnv("RESEARCH_MAX_SOURCES", "abc");

    expect(() => resolveResearchProvider()).toThrow(/RESEARCH_MAX_SOURCES/);
  });
});
