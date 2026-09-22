import { afterEach, describe, expect, it, vi } from "vitest";

import { getModelProviderConfig, getResearchConfig, readModelApiKey } from "./env";
import { GEMINI_API_ENDPOINT } from "./env";

/**
 * Environment resolution for the model provider.
 *
 * The provider itself is tested in `provider/openai-provider.test.ts`; this file
 * tests only the decision made *before* one is constructed — which style was
 * asked for, and whether the values that style needs are present. It exists
 * because Phase 5 added three failure modes that did not exist before (a remote
 * style with no endpoint, with a malformed endpoint, and with no model), and a
 * configuration error that is not caught here surfaces in the middle of a run
 * instead of at startup.
 *
 * No test reads a real credential, and the key stubbed below is a literal that
 * exists nowhere else.
 */

const FAKE_KEY = "test-key-not-a-real-credential";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Clears every variable this module reads, so a test starts from the default. */
function clearEnv() {
  vi.stubEnv("LLM_API_STYLE", "");
  vi.stubEnv("LLM_ENDPOINT", "");
  vi.stubEnv("LLM_MODEL", "");
  vi.stubEnv("LLM_API_KEY", "");
}

describe("getModelProviderConfig", () => {
  it("defaults to the development style with nothing configured", () => {
    clearEnv();

    expect(getModelProviderConfig()).toStrictEqual({
      style: "dev",
      hasApiKey: false,
    });
  });

  it("reads a configured remote style", () => {
    clearEnv();
    vi.stubEnv("LLM_API_STYLE", "openai");
    vi.stubEnv("LLM_ENDPOINT", "https://openrouter.ai/api/v1");
    vi.stubEnv("LLM_MODEL", "openai/gpt-4o");

    expect(getModelProviderConfig()).toStrictEqual({
      style: "openai",
      endpoint: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4o",
      hasApiKey: false,
    });
  });

  it("reports whether a key is present", () => {
    clearEnv();
    vi.stubEnv("LLM_API_KEY", FAKE_KEY);

    expect(getModelProviderConfig().hasApiKey).toBe(true);
  });

  // A key of spaces is not a key, and treating it as one would send a header
  // the endpoint rejects while the status panel claimed Orion was configured.
  it("treats a whitespace-only key as absent", () => {
    clearEnv();
    vi.stubEnv("LLM_API_KEY", "   ");

    expect(getModelProviderConfig().hasApiKey).toBe(false);
  });

  it("names the variable to fix when the style is unknown", () => {
    clearEnv();
    vi.stubEnv("LLM_API_STYLE", "anthropic");

    expect(() => getModelProviderConfig()).toThrow(/LLM_API_STYLE/);
  });

  it("refuses a remote style with no endpoint", () => {
    clearEnv();
    vi.stubEnv("LLM_API_STYLE", "openai");
    vi.stubEnv("LLM_MODEL", "openai/gpt-4o");

    expect(() => getModelProviderConfig()).toThrow(/LLM_ENDPOINT/);
  });

  it("refuses a remote style with no model", () => {
    clearEnv();
    vi.stubEnv("LLM_API_STYLE", "openai");
    vi.stubEnv("LLM_ENDPOINT", "https://openrouter.ai/api/v1");

    expect(() => getModelProviderConfig()).toThrow(/LLM_MODEL/);
  });

  it("refuses an endpoint that is not a URL", () => {
    clearEnv();
    vi.stubEnv("LLM_API_STYLE", "openai");
    vi.stubEnv("LLM_ENDPOINT", "openrouter.ai/api/v1");
    vi.stubEnv("LLM_MODEL", "openai/gpt-4o");

    expect(() => getModelProviderConfig()).toThrow(/LLM_ENDPOINT/);
  });

  it("does not require an endpoint for the development style", () => {
    clearEnv();
    vi.stubEnv("LLM_API_STYLE", "dev");

    expect(() => getModelProviderConfig()).not.toThrow();
  });
});

/**
 * The one style with a default endpoint.
 *
 * The asymmetry with `openai` is deliberate and is what this block exists to
 * pin down: `openai` names a protocol many vendors speak, so it must be told
 * where to go, while `gemini` names one vendor at one canonical host. The two
 * assertions that matter most are that the default is filled in when
 * `LLM_ENDPOINT` is unset, and that an explicit value still wins — because a
 * default that could not be overridden would make a proxy or a regional host
 * unreachable, and a test suite that could not point the adapter at a stub host.
 *
 * Note what is *not* relaxed: `LLM_MODEL` stays required. Google retires and
 * renames model ids, so a default written today becomes a wrong answer later,
 * and it would fail as a 404 from Google rather than as a sentence naming the
 * variable to fix.
 */
describe("getModelProviderConfig with the gemini style", () => {
  function configureGemini() {
    clearEnv();
    vi.stubEnv("LLM_API_STYLE", "gemini");
    vi.stubEnv("LLM_MODEL", "gemini-2.0-flash");
  }

  it("reads a configured gemini style", () => {
    configureGemini();
    vi.stubEnv("LLM_ENDPOINT", "https://proxy.example/v1beta");

    expect(getModelProviderConfig()).toStrictEqual({
      style: "gemini",
      endpoint: "https://proxy.example/v1beta",
      model: "gemini-2.0-flash",
      hasApiKey: false,
    });
  });

  it("defaults the endpoint when none is set", () => {
    configureGemini();

    // The whole point of the asymmetry: one vendor, one canonical base, so
    // requiring the operator to retype it would add a typo surface and buy
    // nothing.
    expect(getModelProviderConfig().endpoint).toBe(GEMINI_API_ENDPOINT);
  });

  it("lets an explicit endpoint override the default", () => {
    configureGemini();
    vi.stubEnv("LLM_ENDPOINT", "https://proxy.example/v1beta");

    // Without this, a proxy, a regional host, and every adapter test would be
    // unable to say where to send the request.
    expect(getModelProviderConfig().endpoint).toBe(
      "https://proxy.example/v1beta",
    );
  });

  it("still refuses a gemini style with no model", () => {
    clearEnv();
    vi.stubEnv("LLM_API_STYLE", "gemini");

    expect(() => getModelProviderConfig()).toThrow(/LLM_MODEL/);
  });

  // The default is validated on the same path as everything else rather than
  // trusted because it is a constant, so a malformed value still fails here —
  // and the message still names the variable an operator can actually fix.
  it("refuses a malformed endpoint even though a default exists", () => {
    configureGemini();
    vi.stubEnv("LLM_ENDPOINT", "generativelanguage.googleapis.com");

    expect(() => getModelProviderConfig()).toThrow(/LLM_ENDPOINT/);
  });
});

describe("readModelApiKey", () => {
  it("returns nothing when unset", () => {
    clearEnv();

    expect(readModelApiKey()).toBeUndefined();
  });

  it("returns nothing when blank", () => {
    clearEnv();
    vi.stubEnv("LLM_API_KEY", "   ");

    expect(readModelApiKey()).toBeUndefined();
  });

  it("returns the trimmed key when one is configured", () => {
    clearEnv();
    vi.stubEnv("LLM_API_KEY", `  ${FAKE_KEY}  `);

    expect(readModelApiKey()).toBe(FAKE_KEY);
  });

  // The reason the accessor is separate from `getModelProviderConfig` at all.
  // That object is spread into provider descriptors, returned from services and
  // rendered by the settings screen — so a credential on it would travel with
  // every copy. This asserts the split holds.
  it("keeps the secret off the configuration object", () => {
    clearEnv();
    vi.stubEnv("LLM_API_KEY", FAKE_KEY);
    vi.stubEnv("LLM_API_STYLE", "openai");
    vi.stubEnv("LLM_ENDPOINT", "https://openrouter.ai/api/v1");
    vi.stubEnv("LLM_MODEL", "openai/gpt-4o");

    const config = getModelProviderConfig();

    expect(config.hasApiKey).toBe(true);
    expect(JSON.stringify(config)).not.toContain(FAKE_KEY);
    expect(Object.values(config)).not.toContain(FAKE_KEY);
  });
});

/**
 * Research configuration — Phase 5's limits and the search model.
 *
 * Every variable this module reads is stubbed, including the ones left empty,
 * because Vitest does not load `.env.local` and an unstubbed name reads whatever
 * the shell happens to hold. A test that asserted the defaults without stubbing
 * would pass on a clean machine and fail on the operator's, which is the least
 * useful way for a test to behave.
 */
function clearResearchEnv() {
  vi.stubEnv("RESEARCH_SEARCH_MODEL", "");
  vi.stubEnv("RESEARCH_MAX_TASKS", "");
  vi.stubEnv("RESEARCH_MAX_SOURCES_PER_TASK", "");
  vi.stubEnv("RESEARCH_MAX_SOURCES", "");
  vi.stubEnv("RESEARCH_MAX_FINDINGS", "");
  vi.stubEnv("RESEARCH_MAX_DURATION_MS", "");
}

describe("getResearchConfig", () => {
  it("defaults every limit with nothing configured", () => {
    clearResearchEnv();

    // A fresh checkout runs research with these ceilings and no configuration at
    // all, so they are behaviour rather than placeholders.
    expect(getResearchConfig()).toStrictEqual({
      limits: {
        maxTasks: 5,
        maxSourcesPerTask: 5,
        maxSourcesTotal: 20,
        maxFindings: 50,
        maxDurationMs: 120_000,
      },
    });
  });

  it("reads a limit from the environment", () => {
    clearResearchEnv();
    vi.stubEnv("RESEARCH_MAX_TASKS", "12");

    expect(getResearchConfig().limits.maxTasks).toBe(12);
  });

  it("reads each limit independently", () => {
    clearResearchEnv();
    vi.stubEnv("RESEARCH_MAX_SOURCES_PER_TASK", "3");
    vi.stubEnv("RESEARCH_MAX_SOURCES", "40");
    vi.stubEnv("RESEARCH_MAX_FINDINGS", "100");
    vi.stubEnv("RESEARCH_MAX_DURATION_MS", "5000");

    expect(getResearchConfig().limits).toStrictEqual({
      maxTasks: 5,
      maxSourcesPerTask: 3,
      maxSourcesTotal: 40,
      maxFindings: 100,
      maxDurationMs: 5_000,
    });
  });

  it("leaves the search model unset rather than defaulting it", () => {
    clearResearchEnv();

    // Absent, not defaulted to LLM_MODEL here: the fallback belongs to the
    // caller, which is the only thing that knows whether the two should differ.
    expect(getResearchConfig().searchModel).toBeUndefined();
  });

  it("carries the search model when one is set", () => {
    clearResearchEnv();
    vi.stubEnv("RESEARCH_SEARCH_MODEL", "  openai/gpt-4o-mini  ");

    // Read, reported and — since the web-search adapter landed — consumed:
    // `resolveResearchProvider` uses it as the model a retrieval call names,
    // falling back to LLM_MODEL when it is absent. This asserts the
    // configuration contract at its source; the resolver's use of it is
    // asserted in `research/provider/index.test.ts`.
    expect(getResearchConfig().searchModel).toBe("openai/gpt-4o-mini");
  });

  // A limit is a safety control, so a malformed one must not fall back to the
  // default. An operator who typed `abc` and silently got 20 would believe they
  // had set a ceiling they had not, and would find out from a larger bill rather
  // than from a configuration error.
  it("refuses a limit that is not a number", () => {
    clearResearchEnv();
    vi.stubEnv("RESEARCH_MAX_SOURCES", "abc");

    expect(() => getResearchConfig()).toThrow(/RESEARCH_MAX_SOURCES/);
  });

  it("refuses a fractional limit", () => {
    clearResearchEnv();
    vi.stubEnv("RESEARCH_MAX_TASKS", "2.5");

    expect(() => getResearchConfig()).toThrow(/RESEARCH_MAX_TASKS/);
  });

  it("refuses a limit of zero", () => {
    clearResearchEnv();
    vi.stubEnv("RESEARCH_MAX_FINDINGS", "0");

    // Zero would mean "retrieve nothing", which is a run that cannot do its job
    // rather than a tight budget.
    expect(() => getResearchConfig()).toThrow(/RESEARCH_MAX_FINDINGS/);
  });

  it("refuses a negative limit", () => {
    clearResearchEnv();
    vi.stubEnv("RESEARCH_MAX_DURATION_MS", "-1");

    expect(() => getResearchConfig()).toThrow(/RESEARCH_MAX_DURATION_MS/);
  });

  it("names the variable that is wrong", () => {
    clearResearchEnv();
    vi.stubEnv("RESEARCH_MAX_SOURCES_PER_TASK", "many");

    expect(() => getResearchConfig()).toThrow(
      /RESEARCH_MAX_SOURCES_PER_TASK must be a positive whole number/,
    );
  });

  // The deliberate absence, asserted so it stays deliberate. Retrieval uses the
  // same endpoint and the same credential as planning, so a second copy of
  // either here would be a second place to rotate one secret — and the copy that
  // was missed would be this one.
  it("carries no endpoint and no credential", () => {
    clearResearchEnv();
    vi.stubEnv("LLM_API_KEY", FAKE_KEY);

    const config = getResearchConfig();

    // `limits` and nothing else, because `searchModel` is absent rather than
    // present-and-undefined when unset — the object is spread conditionally, and
    // the assertion states which of the two shapes is the real one.
    expect(Object.keys(config).sort()).toStrictEqual(["limits"]);
    expect(JSON.stringify(config)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(config)).not.toContain("http");
  });

  it("carries nothing but its own two keys once a search model is set", () => {
    clearResearchEnv();
    vi.stubEnv("RESEARCH_SEARCH_MODEL", "openai/gpt-4o-mini");
    vi.stubEnv("LLM_API_KEY", FAKE_KEY);
    vi.stubEnv("LLM_ENDPOINT", "https://openrouter.ai/api/v1");

    const config = getResearchConfig();

    // The same property with the other branch taken. A key appearing here when
    // the search model is set is how an endpoint or a credential would arrive on
    // this object, and it is the branch a caller would exercise by setting the
    // variable the endpoint is documented next to.
    expect(Object.keys(config).sort()).toStrictEqual(["limits", "searchModel"]);
    expect(JSON.stringify(config)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(config)).not.toContain("http");
  });
});
