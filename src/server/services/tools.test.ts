import { describe, expect, it } from "vitest";

import { TEXT_ANALYSIS_TOOL_ID } from "../agent";
import { getToolCatalog } from "./tools";

/**
 * The catalogue as `/api/tools` serves it.
 *
 * There are no route-handler tests in this repository — the handlers are thin
 * wrappers over services, and the services are where the behaviour lives — so
 * this is the layer that has to assert the properties the endpoint promises.
 * The important one is negative: what a caller receives must not be enough to
 * run anything.
 */
describe("getToolCatalog", () => {
  it("lists the registered tools", () => {
    const catalog = getToolCatalog();

    expect(catalog.tools.map((tool) => tool.id)).toStrictEqual([
      TEXT_ANALYSIS_TOOL_ID,
    ]);
  });

  it("describes each tool well enough to display it", () => {
    const [tool] = getToolCatalog().tools;

    expect(tool?.name).toBe("Text analysis");
    expect(tool?.version).toBe("1.0.0");
    expect(tool?.description ?? "").not.toHaveLength(0);
    expect(tool?.capabilities).toStrictEqual(["read_only"]);
  });

  // The security property §12 and §16 require. A schema is a description of an
  // input surface; a function is the surface itself. Neither leaves the engine.
  it("exposes no executable part of a tool", () => {
    const [tool] = getToolCatalog().tools;

    expect(tool).not.toHaveProperty("execute");
    expect(tool).not.toHaveProperty("inputSchema");
  });

  it("reports the capabilities a run is granted", () => {
    // Read-only, and nothing else. A tool needing more is refused until someone
    // widens this on purpose.
    expect(getToolCatalog().grantedCapabilities).toStrictEqual(["read_only"]);
  });

  it("serialises to JSON without loss", () => {
    const catalog = getToolCatalog();

    expect(JSON.parse(JSON.stringify(catalog))).toStrictEqual(catalog);
  });

  it("returns a fresh catalogue rather than shared mutable state", () => {
    const first = getToolCatalog();
    const second = getToolCatalog();

    expect(first).not.toBe(second);
    expect(first.tools).not.toBe(second.tools);
    expect(first).toStrictEqual(second);
  });
});
