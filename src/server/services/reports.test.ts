import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { REPORT_RESEARCH_ID_MAX_LENGTH } from "@/lib/validation/report";
import { ServiceError } from "@/server/errors";
import { clearReports as clearReportStore } from "@/server/report";
import { RESEARCH_ID, researchRecordFixture } from "@/server/report/fixtures";
import { clearResearch, saveResearch } from "@/server/research";

import {
  createReport,
  getReportById,
  listRecentReportSummaries,
  listRecentReports,
} from "./reports";

/**
 * The report service boundary.
 *
 * This is the layer where a request becomes a status: it validates what arrived,
 * calls the engine, and turns a refusal into a `ServiceError`. The route tests
 * cover the HTTP shape of that mapping; what is left here is what the service
 * decides on its own — which message a caller sees for a malformed request, that
 * an unknown id is a `404` rather than an empty document, and that the list
 * projection has one home.
 *
 * **What it is not testing** is the report. `src/server/report/service.test.ts`
 * and `src/server/report/generator.test.ts` cover generation, and repeating those
 * assertions here would make this file a slower copy of them.
 */

beforeEach(() => {
  clearReportStore();
  clearResearch();
});

afterEach(() => {
  clearReportStore();
  clearResearch();
});

/** Asserts the call throws a `ServiceError` with the given status, and returns it. */
async function expectServiceError(
  work: () => Promise<unknown>,
  status: number,
): Promise<ServiceError> {
  try {
    await work();
  } catch (error) {
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).status).toBe(status);
    return error as ServiceError;
  }

  throw new Error(`expected a ServiceError with status ${status}`);
}

describe("createReport", () => {
  it("returns the report for a request that names a finished research record", async () => {
    saveResearch(researchRecordFixture());

    const report = await createReport({ researchId: RESEARCH_ID });

    expect(report.researchId).toBe(RESEARCH_ID);
    expect(report.status).toBe("completed");
  });

  it("refuses a body that is not an object, with a 400", async () => {
    const error = await expectServiceError(() => createReport("a string"), 400);

    expect(error.message.length).toBeGreaterThan(0);
  });

  it("refuses a missing research id, and says which field is missing", async () => {
    const error = await expectServiceError(() => createReport({}), 400);

    // The service joins the schema's issues rather than inventing its own
    // wording, so the message a caller sees is the one the schema was written
    // to give.
    expect(error.message).toContain("A research id is required.");
  });

  it("refuses an over-long research id", async () => {
    const error = await expectServiceError(
      () =>
        createReport({
          researchId: "a".repeat(REPORT_RESEARCH_ID_MAX_LENGTH + 1),
        }),
      400,
    );

    expect(error.message).toContain(
      `at most ${REPORT_RESEARCH_ID_MAX_LENGTH} characters`,
    );
  });

  it("refuses a preference that is not a boolean", async () => {
    const error = await expectServiceError(
      () => createReport({ researchId: RESEARCH_ID, useModel: "yes" }),
      400,
    );

    expect(error.message.length).toBeGreaterThan(0);
  });

  it("accepts a research id with surrounding whitespace, which the schema trims", async () => {
    saveResearch(researchRecordFixture());

    const report = await createReport({ researchId: `  ${RESEARCH_ID}  ` });

    expect(report.researchId).toBe(RESEARCH_ID);
  });

  it("is a 404, not a 400, when the request is well formed and the record is not there", async () => {
    // The distinction a client acts on: a typo will not fix itself by retrying,
    // and a run that has not finished will.
    await expectServiceError(
      () => createReport({ researchId: "res_nothing" }),
      404,
    );
  });

  it("is a 409 when the record exists without a result", async () => {
    saveResearch(researchRecordFixture({ result: undefined }));

    await expectServiceError(() => createReport({ researchId: RESEARCH_ID }), 409);
  });

  it("names the ServiceError, so the route maps it rather than logging it", async () => {
    const error = await expectServiceError(() => createReport({}), 400);

    expect(error.name).toBe("ServiceError");
  });
});

describe("getReportById", () => {
  it("returns a report that exists", async () => {
    saveResearch(researchRecordFixture());
    const created = await createReport({ researchId: RESEARCH_ID });

    expect(getReportById(created.id)).toStrictEqual(created);
  });

  it("throws a 404 for an id that names nothing", () => {
    try {
      getReportById("report_nothing");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceError);
      expect((error as ServiceError).status).toBe(404);
      expect((error as ServiceError).message).toBe(
        "No report with that id was found.",
      );
      return;
    }

    throw new Error("expected a ServiceError");
  });
});

describe("the list", () => {
  it("is empty before anything has been generated", () => {
    expect(listRecentReports()).toStrictEqual([]);
    expect(listRecentReportSummaries()).toStrictEqual([]);
  });

  it("summarises at this layer, so the page and the API cannot describe one report differently", async () => {
    saveResearch(researchRecordFixture());
    const created = await createReport({ researchId: RESEARCH_ID });

    const [summary] = listRecentReportSummaries();

    expect(summary?.id).toBe(created.id);
    expect(summary?.sectionCount).toBe(created.sections.length);
    expect(summary?.citationCount).toBe(created.citations.length);
    expect(summary?.generationMode).toBe("deterministic");
  });

  it("lists the most recently generated first", async () => {
    saveResearch(researchRecordFixture());
    const first = await createReport({ researchId: RESEARCH_ID });
    const second = await createReport({
      researchId: RESEARCH_ID,
      regenerate: true,
    });

    expect(listRecentReportSummaries().map((summary) => summary.id)).toStrictEqual([
      second.id,
      first.id,
    ]);
  });
});
