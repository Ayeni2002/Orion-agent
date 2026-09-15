import { afterEach, describe, expect, it, vi } from "vitest";

import { getModelProviderConfig, readModelApiKey } from "./env";

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
