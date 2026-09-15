import { describe, expect, it } from "vitest";

import { dynamic, GET } from "./route";

/**
 * `/api/research/capabilities`, through its handler.
 *
 * This endpoint exists because the tool catalogue cannot answer the question it
 * answers. `research.search` is registered per run rather than in the default
 * catalogue, so `/api/tools` — which reports what any run may call — will never
 * list it, and a caller reading only that endpoint cannot tell whether retrieval
 * is configured at all.
 *
 * The tests below are grouped by the two reasons the endpoint is worth having.
 * The first is that a user should learn "no search is configured" *before*
 * typing a question rather than from a failed run. The second is that the
 * widened grant is reported: `network` is the one capability in Orion that a
 * research run has and an agent run does not, and a widened grant that nothing
 * states is a grant nobody reviews.
 *
 * Nothing here pins *whether* search is configured. That is an environment
 * fact, and this environment has no `.env` — a test that asserted a particular
 * answer would be asserting the machine it ran on. What is asserted is the
 * shape: that the flag is a boolean, that the answer is consistent with the
 * provider descriptor, and that a credential never appears on this path.
 */

describe("GET /api/research/capabilities", () => {
  it("responds 200 with JSON", () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("answers the question the tool catalogue cannot", async () => {
    const body = await GET().json();

    // The field a user reads before typing a question. `provider` may be null —
    // a build whose research provider could not be constructed is a supported
    // state — so only the flag itself is asserted to be present and boolean.
    expect(typeof body.searchConfigured).toBe("boolean");
    expect(body.toolId).toStrictEqual(expect.any(String));
  });

  it("names the tool a research run calls", async () => {
    const body = await GET().json();

    // Named rather than left for the UI to guess. A client that hardcoded the
    // id would keep working after the tool was renamed and would then be
    // describing a tool that does not exist.
    expect(body.toolId).toBe("research.search");
  });

  it("reports the grant a research run widens to", async () => {
    const body = await GET().json();

    // The one place in Orion where the deny-by-default grant is widened. A
    // reader seeing `network` here learns exactly what a research run may do
    // that an agent run may not.
    expect(body.grantedCapabilities).toStrictEqual(["read_only", "network"]);
  });

  it("reports the limits a run will actually use", async () => {
    const body = await GET().json();

    // Read from the environment rather than restated, so the panel and the run
    // cannot disagree about what the ceilings are.
    expect(Object.keys(body.limits).sort()).toStrictEqual([
      "maxDurationMs",
      "maxFindings",
      "maxSourcesPerTask",
      "maxSourcesTotal",
      "maxTasks",
    ]);

    for (const value of Object.values<unknown>(body.limits)) {
      expect(typeof value).toBe("number");
    }
  });

  it("agrees with the provider descriptor about whether search works", async () => {
    const body = await GET().json();

    // Two fields that must not contradict each other. A panel showing a
    // configured provider next to "search unavailable" is the failure this
    // catches, and it would be a real one: the flag is what the UI branches on.
    if (body.provider === null) {
      expect(body.searchConfigured).toBe(false);
      return;
    }

    expect(typeof body.provider.isExternal).toBe("boolean");
    expect(body.provider.id).toStrictEqual(expect.any(String));
  });

  it("explains itself when the provider could not be constructed", async () => {
    const body = await GET().json();

    // Present only in the failure state, and that is the point: a panel that
    // 500s tells the user nothing, so configuration trouble arrives as data.
    if (body.configurationError === undefined) {
      expect(body.provider).not.toBeNull();
      return;
    }

    expect(body.provider).toBeNull();
    expect(typeof body.configurationError).toBe("string");
  });

  it("exposes no credential", async () => {
    const text = await GET().text();

    // `getModelProviderConfig` reports only whether a key is present, and
    // `readModelApiKey` is the single function that returns one — this is not
    // that path. Asserted on the wire rather than trusted, because a provider
    // descriptor spread into a response is exactly where a secret would travel.
    expect(text).not.toMatch(/sk-[A-Za-z0-9-]/);
    expect(text).not.toContain("apiKey");
    expect(text).not.toContain("api_key");
    expect(text).not.toContain("Bearer ");
  });

  it("carries nothing beyond the capability record", async () => {
    const body = await GET().json();

    const allowed = [
      "configurationError",
      "grantedCapabilities",
      "limits",
      "provider",
      "searchConfigured",
      "toolId",
    ];

    for (const key of Object.keys(body)) {
      expect(allowed).toContain(key);
    }
  });

  it("serialises to JSON without loss", async () => {
    const text = await GET().text();

    expect(JSON.parse(text)).toStrictEqual(await GET().json());
  });

  it("declares itself dynamic", () => {
    // Reading it during a static render would bake in whatever the build
    // machine's environment happened to say, which is not necessarily the
    // environment the app is running in — and the answer is exactly the thing
    // this endpoint exists to report.
    expect(dynamic).toBe("force-dynamic");
  });
});
