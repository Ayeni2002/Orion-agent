import { describe, expect, it } from "vitest";

import { TEXT_ANALYSIS_TOOL_ID } from "@/server/agent";

import { dynamic, GET } from "./route";

/**
 * `/api/tools`, exercised through its handler rather than through the service
 * beneath it.
 *
 * `services/tools.test.ts` already covers what `getToolCatalog()` returns, and
 * this file deliberately does not repeat those assertions. What it adds is the
 * part that file cannot reach: that this endpoint is actually wired to that
 * service, that it speaks JSON, that it declares itself dynamic, and that
 * nothing beyond the catalogue leaves through the response.
 *
 * The distinction is worth the extra file. Before it existed, every property
 * below was asserted about a function's return value and nothing asserted it
 * about the endpoint's response — so a route that returned the wrong shape, or
 * served a frozen catalogue, would have passed the whole suite. Calling `GET()`
 * is exactly how Next invokes this handler for a request with no params, so a
 * direct call is the endpoint's contract, not a shortcut around it.
 *
 * No server is started and no port is bound: that would make the suite depend
 * on the environment, and the handler is a pure function of the catalogue.
 */
describe("GET /api/tools", () => {
  it("responds 200 with JSON", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("serves the registered tool catalogue", async () => {
    const body = await GET().json();

    expect(body.tools).toStrictEqual([
      {
        id: TEXT_ANALYSIS_TOOL_ID,
        name: "Text analysis",
        description: expect.any(String),
        version: "1.0.0",
        capabilities: ["read_only"],
      },
    ]);
    expect(body.grantedCapabilities).toStrictEqual(["read_only"]);
  });

  // The §15 requirement, asserted on the response body rather than on the
  // service's return value. Every property a caller can see is enumerated, so a
  // field added to `Tool` later cannot reach the wire unnoticed — and `execute`
  // and `inputSchema` in particular cannot reappear, which is the whole point
  // of `Tool` being a projection of `ToolDefinition`.
  it("exposes no executable part of a tool", async () => {
    const body = await GET().json();
    const [tool] = body.tools;

    expect(Object.keys(tool).sort()).toStrictEqual([
      "capabilities",
      "description",
      "id",
      "name",
      "version",
    ]);
    expect(tool).not.toHaveProperty("execute");
    expect(tool).not.toHaveProperty("inputSchema");
  });

  // A response is a public surface, so what it does NOT carry matters as much
  // as what it does. An error object, a stack trace or a capability list that
  // grew a field would all show up here as an unexpected top-level key.
  it("carries nothing beyond the catalogue", async () => {
    const body = await GET().json();

    expect(Object.keys(body).sort()).toStrictEqual([
      "grantedCapabilities",
      "tools",
    ]);
  });

  it("serialises to JSON without loss", async () => {
    const response = GET();
    const text = await response.text();

    expect(JSON.parse(text)).toStrictEqual(await GET().json());
  });

  // The build already proves this holds — the route table renders `/api/tools`
  // as `ƒ` — but the build is not run on every change. The export is a
  // behavioural contract, not an optimisation: a statically rendered catalogue
  // would bake in whatever the build machine happened to permit, and would keep
  // serving it after the grant changed.
  it("declares itself dynamic", () => {
    expect(dynamic).toBe("force-dynamic");
  });
});
