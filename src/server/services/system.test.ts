import { describe, expect, it } from "vitest";

import { getSystemStatus } from "./system";

describe("getSystemStatus", () => {
  it("identifies the service and reports it as ok", () => {
    const status = getSystemStatus();

    expect(status.status).toBe("ok");
    expect(status.service).toBe("orion");
  });

  it("returns a timestamp that round-trips as ISO 8601", () => {
    const { timestamp } = getSystemStatus();

    expect(Number.isNaN(Date.parse(timestamp))).toBe(false);
    expect(new Date(timestamp).toISOString()).toBe(timestamp);
  });
});
