import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearReports } from "@/server/report";
import { RESEARCH_ID, researchRecordFixture } from "@/server/report/fixtures";
import { clearResearch, saveResearch } from "@/server/research";

import { GET, POST } from "../route";
import * as reportDetailRoute from "./route";

/**
 * `/api/reports/[id]`, exercised through its handler.
 *
 * The handler takes `params` as a promise — Next's shape for a dynamic segment —
 * so every case here unwraps one, which is also the only thing that distinguishes
 * this file from its sibling. The report is generated through the real `POST`
 * rather than being placed in the store by hand, so what is read back is a
 * document the application actually produced.
 *
 * **Read-only is the property under test.** There is no `PATCH` and no `DELETE`
 * exported, and the group at the bottom asserts that: a report is the artefact a
 * person reads and trusts, so a client cannot rewrite a section, add a citation,
 * attach a source or change a status. The absence is the contract, and a contract
 * nothing checks is a contract that can be deleted by accident.
 */

/** The path params Next passes to a dynamic segment handler. */
function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

const getOne = reportDetailRoute.GET;

async function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/reports", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

/** Generates a report through the real endpoint and returns its id. */
async function givenReport(): Promise<string> {
  saveResearch(researchRecordFixture());

  const body = (await (await post({ researchId: RESEARCH_ID })).json()) as {
    report: { id: string };
  };

  return body.report.id;
}

beforeEach(() => {
  clearReports();
  clearResearch();
});

afterEach(() => {
  clearReports();
  clearResearch();
});

describe("GET /api/reports/[id]", () => {
  it("responds 200 with JSON for a report that exists", async () => {
    const id = await givenReport();

    const response = await getOne(new Request(`http://localhost/api/reports/${id}`), params(id));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("carries the report and nothing else", async () => {
    const id = await givenReport();

    const body = await (
      await getOne(new Request("http://localhost/x"), params(id))
    ).json();

    expect(Object.keys(body)).toStrictEqual(["report"]);
  });

  it("returns the whole document, not the list projection", async () => {
    const id = await givenReport();

    const body = await (
      await getOne(new Request("http://localhost/x"), params(id))
    ).json();

    // The detail view needs everything the list deliberately drops.
    expect(body.report.id).toBe(id);
    expect(body.report.sections.length).toBeGreaterThan(0);
    expect(body.report.citations.length).toBeGreaterThan(0);
    expect(body.report.sources.length).toBeGreaterThan(0);
    expect(body.report.metadata).toBeDefined();
  });

  it("carries the chain a reader needs to answer where a claim came from", async () => {
    const id = await givenReport();

    const body = await (
      await getOne(new Request("http://localhost/x"), params(id))
    ).json();

    const [citation] = body.report.citations;

    // §4: statement → finding → passage → source → URL, denormalised onto the
    // citation so the walk needs no join.
    expect(citation.findingId).toBeTruthy();
    expect(citation.statement).toBeTruthy();
    expect(citation.url).toBeTruthy();
    expect(citation.domain).toBeTruthy();
  });

  it("serialises to JSON without loss", async () => {
    const id = await givenReport();

    const response = await getOne(new Request("http://localhost/x"), params(id));

    // Read once: a Response body can only be consumed once.
    const text = await response.text();

    expect(JSON.parse(text).report.id).toBe(id);
  });

  it("responds 404 for an id that names no report", async () => {
    const response = await getOne(new Request("http://localhost/x"), params("report_nothing"));

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("No report with that id was found.");
  });

  it("responds 404 rather than an empty document when the store has been cleared", async () => {
    const id = await givenReport();

    // The store is bounded and process-local, so a stored report may genuinely be
    // gone. Reporting "not found" is honest; reconstructing one would mean
    // re-running generation that nobody asked for.
    clearReports();

    expect((await getOne(new Request("http://localhost/x"), params(id))).status).toBe(404);
  });

  it("does not report on a research record that was never used to make a report", async () => {
    saveResearch(researchRecordFixture());

    // The id space is reports, not research: a research id is not a report id.
    expect(
      (await getOne(new Request("http://localhost/x"), params(RESEARCH_ID))).status,
    ).toBe(404);
  });
});

describe("what the route does not accept", () => {
  it("exports no way to write, change or remove a report", () => {
    // The absence is the contract. A report is written once by the generator,
    // from a research result, and never afterwards.
    expect(Object.keys(reportDetailRoute).sort()).toStrictEqual(["GET"]);
  });
});
