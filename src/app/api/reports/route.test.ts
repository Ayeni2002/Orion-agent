import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearResearch, saveResearch } from "@/server/research";
import { RESEARCH_ID, researchRecordFixture } from "@/server/report/fixtures";
import { clearReports } from "@/server/report";

import { dynamic, GET, POST } from "./route";

/**
 * `/api/reports`, exercised through its handlers rather than through the service
 * beneath it.
 *
 * `src/server/report/service.test.ts` covers what `generateReportFor` returns, and
 * this file does not repeat those assertions. What it adds is what that file
 * cannot reach: that the endpoint is wired to that service, what status each
 * outcome becomes, that it speaks JSON, that it declares itself dynamic, that a
 * caller can read the list, and — the group that matters most — that no report
 * content can arrive with a request.
 *
 * The handler is called directly, which is how Next invokes it for a request with
 * no dynamic segments. No server is started and no port is bound: a bound port
 * would make this suite depend on the environment, and every property below is a
 * function of the request alone.
 *
 * **Every successful `POST` here returns `201`, including the ones whose report
 * was built without a model.** That is the endpoint's deliberate contract, stated
 * in `services/reports.ts`: a report assembled from the research record has been
 * produced correctly, and the body says how. Only a research record that does not
 * exist (`404`) or has no result to report on (`409`) is a refusal, and those are
 * separate statuses because only one of them is worth retrying.
 *
 * **Both stores are process-local module state**, so both are cleared before every
 * case: a report or a research record left behind by an earlier case is exactly
 * the coupling that makes the reuse rule look like it works.
 */

async function post(body: unknown, init: RequestInit = {}): Promise<Response> {
  return POST(
    new Request("http://localhost/api/reports", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      ...init,
    }),
  );
}

/** Puts a finished research record in the research store, as a run would. */
function givenResearch(): void {
  saveResearch(researchRecordFixture());
}

beforeEach(() => {
  clearReports();
  clearResearch();
});

afterEach(() => {
  clearReports();
  clearResearch();
});

describe("the route's configuration", () => {
  it("runs at request time", () => {
    // The list is read from a process-local store that is empty at build time.
    // Captured once, the endpoint would look correct and never return a report
    // that had actually been generated.
    expect(dynamic).toBe("force-dynamic");
  });
});

describe("GET /api/reports", () => {
  it("responds 200 with JSON", () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("is an empty list before anything has been generated", async () => {
    expect(await GET().json()).toStrictEqual({ reports: [] });
  });

  it("carries nothing beyond the list", async () => {
    const body = await GET().json();

    // A response is a public surface, so what it does not carry matters as much
    // as what it does: no document, no citations, no sources.
    expect(Object.keys(body)).toStrictEqual(["reports"]);
  });

  it("lists what has been generated, as a summary rather than a document", async () => {
    givenResearch();
    await post({ researchId: RESEARCH_ID });

    const body = (await GET().json()) as { reports: Record<string, unknown>[] };

    expect(body.reports).toHaveLength(1);
    expect(body.reports[0]?.researchId).toBe(RESEARCH_ID);
    expect(body.reports[0]?.status).toBe("completed");
    expect(body.reports[0]?.title).toBeTruthy();
    expect(body.reports[0]?.createdAt).toBeTruthy();
    // §8's list needs a title, a date, a status and the research it came from.
    expect("sections" in (body.reports[0] ?? {})).toBe(false);
    expect("citations" in (body.reports[0] ?? {})).toBe(false);
  });

  it("serialises to JSON without loss", async () => {
    const text = await GET().text();

    expect(JSON.parse(text)).toStrictEqual(await GET().json());
  });
});

describe("POST /api/reports", () => {
  describe("a request it accepts", () => {
    it("responds 201 with JSON", async () => {
      givenResearch();

      const response = await post({ researchId: RESEARCH_ID });

      expect(response.status).toBe(201);
      expect(response.headers.get("content-type")).toContain("application/json");
    });

    it("carries the report and nothing else", async () => {
      givenResearch();
      const body = await (await post({ researchId: RESEARCH_ID })).json();

      expect(Object.keys(body)).toStrictEqual(["report"]);
      expect(body.report.id).toBeTruthy();
      expect(body.report.researchId).toBe(RESEARCH_ID);
    });

    it("returns a complete document, not a placeholder", async () => {
      givenResearch();
      const body = await (await post({ researchId: RESEARCH_ID })).json();

      expect(body.report.status).toBe("completed");
      expect(body.report.sections.length).toBeGreaterThan(0);
      expect(body.report.citations.length).toBeGreaterThan(0);
      expect(body.report.sources.length).toBeGreaterThan(0);
      expect(body.report.objective).toBeTruthy();
      expect(body.report.generatedAt).toBeTruthy();
    });

    it("tells the caller how the report was written", async () => {
      // §15: with no model provider configured in the test environment, the
      // report is assembled from the record — and it says so, with the reason,
      // rather than looking like a model wrote it.
      givenResearch();
      const body = await (await post({ researchId: RESEARCH_ID })).json();

      expect(body.report.metadata.generation.mode).toBe("deterministic");
      expect(body.report.metadata.generation.reason).toBeTruthy();
      expect(body.report.metadata.modelProvider).toBeUndefined();
    });

    it("accepts the two preferences a caller may actually set", async () => {
      givenResearch();

      const response = await post({
        researchId: RESEARCH_ID,
        useModel: false,
        regenerate: true,
      });

      expect(response.status).toBe(201);
    });

    it("reuses the report already made for a record rather than making a second", async () => {
      givenResearch();

      const first = await (await post({ researchId: RESEARCH_ID })).json();
      const second = await (await post({ researchId: RESEARCH_ID })).json();

      expect(second.report.id).toBe(first.report.id);
      expect(((await (await GET()).json()) as { reports: unknown[] }).reports).toHaveLength(
        1,
      );
    });

    it("makes a second one when the caller asks for one", async () => {
      givenResearch();

      const first = await (await post({ researchId: RESEARCH_ID })).json();
      const second = await (
        await post({ researchId: RESEARCH_ID, regenerate: true })
      ).json();

      expect(second.report.id).not.toBe(first.report.id);
    });
  });

  describe("a request it refuses", () => {
    it("responds 400 for a body with no research id", async () => {
      const response = await post({});

      expect(response.status).toBe(400);
      expect((await response.json()).error).toBeTruthy();
    });

    it("responds 400 for a research id that is not a string", async () => {
      expect((await post({ researchId: 42 })).status).toBe(400);
    });

    it("responds 400 for an empty research id", async () => {
      expect((await post({ researchId: "   " })).status).toBe(400);
    });

    it("responds 400 for a body that is not JSON", async () => {
      const response = await post("{not json");

      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe(
        "The request body must be valid JSON.",
      );
    });

    it("responds 400 for an empty body", async () => {
      const response = await post("");

      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe(
        "A JSON request body is required.",
      );
    });

    it("responds 413 for a body past the limit, before reading it", async () => {
      // 9,000 characters of id is over the 8 KiB body cap, so this is refused
      // before the schema ever sees it.
      const response = await post({ researchId: "a".repeat(9_000) });

      expect(response.status).toBe(413);
      expect((await response.json()).error).toBe("The request body is too large.");
    });

    it("responds 404 when the research record does not exist", async () => {
      const response = await post({ researchId: "res_nothing" });

      expect(response.status).toBe(404);
      expect((await response.json()).error).toBe(
        "No research record with that id was found.",
      );
    });

    it("responds 409 when the record exists but has no result", async () => {
      // The default for a fixture with no result is a run that failed, and a
      // failed run is the one a caller might reasonably re-run the research for.
      saveResearch(researchRecordFixture({ result: undefined }));

      const response = await post({ researchId: RESEARCH_ID });

      // §14: a report fails safely when the research data is incomplete. The
      // status differs from the 404 above because this one is worth retrying.
      expect(response.status).toBe(409);
      expect((await response.json()).error).toBe(
        "That research run failed before recording a result, so there is nothing to report on.",
      );
    });
  });

  describe("what a caller cannot do", () => {
    it("cannot supply a report's contents", async () => {
      givenResearch();

      const response = await post({
        researchId: RESEARCH_ID,
        title: "The 2024 Storage Collapse",
        sections: [{ heading: "Injected", body: "A claim nobody researched." }],
        citations: [
          { findingId: "fnd_invented", statement: "Invented.", url: "https://invented.example/x" },
        ],
        sources: [{ id: "src_invented", url: "https://invented.example/x" }],
      });

      const body = await response.json();

      // Accepted as a request, because the extra fields are simply not part of
      // the contract — and then absent from the document, because nothing was
      // built from them. A report is meant to be evidence, so a client able to
      // hand in the evidence could manufacture a document that looks like
      // Orion's work and is not.
      expect(response.status).toBe(201);
      expect(body.report.title).not.toBe("The 2024 Storage Collapse");
      expect(
        body.report.sections.some(
          (section: { heading?: string }) => section.heading === "Injected",
        ),
      ).toBe(false);
      expect(JSON.stringify(body.report)).not.toContain("invented.example");
      expect(JSON.stringify(body.report)).not.toContain("fnd_invented");
    });

    it("cannot name a research record through any field but the id", async () => {
      // A record the caller did not name cannot be reported on, whichever field
      // it is smuggled through.
      saveResearch(researchRecordFixture({ id: "res_other" }));
      givenResearch();

      const body = await (
        await post({
          researchId: RESEARCH_ID,
          result: researchRecordFixture({ id: "res_other" }).result,
          findings: [],
        })
      ).json();

      expect(body.report.researchId).toBe(RESEARCH_ID);
    });
  });
});
