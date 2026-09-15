import { beforeEach, describe, expect, it } from "vitest";

import { clearResearch } from "@/server/research";

import { dynamic, GET, POST } from "./route";

/**
 * `/api/research`, exercised through its handlers rather than through the
 * service beneath it.
 *
 * `services/research.test.ts` covers what `startResearch` returns, and this file
 * does not repeat those assertions. What it adds is what that file cannot reach:
 * that the endpoint is wired to that service, what status each outcome becomes,
 * that it speaks JSON, that it declares itself dynamic, and — the group that
 * matters most — that nothing beyond the record leaves through the response and
 * nothing a caller sends can reach the run.
 *
 * The handler is called directly, which is how Next invokes it for a request
 * with no params and no dynamic segments. No server is started and no port is
 * bound: a bound port would make this suite depend on the environment, and every
 * property below is a function of the request alone.
 *
 * **Every `POST` here returns `201`, including the ones whose run failed.** That
 * is the endpoint's deliberate contract, stated in `services/research.ts`: a
 * question that was planned and searched and not settled has been answered
 * honestly, and the answer belongs in the body with its sources attached. The
 * status assertions below are therefore not "did the research succeed" — they
 * are "was this a request the endpoint could process at all".
 */

async function post(body: unknown, init: RequestInit = {}): Promise<Response> {
  return POST(
    new Request("http://localhost/api/research", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      ...init,
    }),
  );
}

/** A question the schema accepts, so a test can vary one thing at a time. */
const QUESTION = "What did grid-scale battery storage cost between 2019 and 2024?";

beforeEach(() => {
  // The research store is process-local and module-level, so a case's run would
  // otherwise be visible to the next and the list assertions would depend on
  // execution order.
  clearResearch();
});

describe("GET /api/research", () => {
  it("responds 200 with JSON", () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("is an empty list before anything has been researched", async () => {
    expect(await GET().json()).toStrictEqual({ research: [] });
  });

  it("carries nothing beyond the list", async () => {
    const body = await GET().json();

    // A response is a public surface, so what it does not carry matters as much
    // as what it does.
    expect(Object.keys(body)).toStrictEqual(["research"]);
  });

  it("serialises to JSON without loss", async () => {
    const text = await GET().text();

    expect(JSON.parse(text)).toStrictEqual(await GET().json());
  });
});

describe("POST /api/research", () => {
  describe("a question it accepts", () => {
    it("responds 201 with JSON", async () => {
      const response = await post({ question: QUESTION });

      expect(response.status).toBe(201);
      expect(response.headers.get("content-type")).toContain("application/json");
    });

    it("carries the record and nothing else", async () => {
      const body = await (await post({ question: QUESTION })).json();

      // `error` in particular cannot coexist with `research`: a caller that saw
      // both could not tell which one the status referred to.
      expect(Object.keys(body)).toStrictEqual(["research"]);
    });

    it("returns the question the caller asked", async () => {
      const body = await (await post({ question: QUESTION })).json();

      expect(body.research.request.question).toBe(QUESTION);
      expect(body.research.id).toStrictEqual(expect.any(String));
    });

    it("returns a record that has already finished", async () => {
      const body = await (await post({ question: QUESTION })).json();

      // No queue and no background worker in this phase, so the response can
      // promise the run is over — and it must, because there is no second
      // endpoint a client could poll for the rest.
      expect(body.research.finishedAt).toStrictEqual(expect.any(String));
      expect(body.research.result).toBeDefined();
      expect(body.research.status).not.toBe("running");
    });

    it("answers 201 even when the run could not retrieve anything", async () => {
      // The honest-failure contract. This environment has no search configured,
      // so the run fails — and a 500 here would throw away the explanation the
      // record is carrying and tell the caller only that something broke.
      const response = await post({ question: QUESTION });

      expect(response.status).toBe(201);
    });

    it("names the retrieval provider and whether it is external", async () => {
      const body = await (await post({ question: QUESTION })).json();

      // The provenance a reader needs in order to know whether these sources
      // came from the web or from the deterministic development adapter.
      expect(body.research.provider.id).toStrictEqual(expect.any(String));
      expect(typeof body.research.provider.isExternal).toBe("boolean");
    });

    it("exposes no credential anywhere in the response", async () => {
      const text = await (await post({ question: QUESTION })).text();

      // The key is read in one function, on one path, and this is not that
      // path — but a body this large is exactly where one would go unnoticed.
      expect(text).not.toMatch(/sk-[A-Za-z0-9-]/);
      expect(text).not.toContain("apiKey");
      expect(text).not.toContain("api_key");
      expect(text).not.toContain("authorization");
      expect(text).not.toContain("Bearer ");
    });
  });

  describe("a question it refuses", () => {
    it("responds 400 when there is no question", async () => {
      const response = await post({});

      expect(response.status).toBe(400);
    });

    it("responds 400 when the question is too short to plan", async () => {
      expect((await post({ question: "Why?" })).status).toBe(400);
    });

    it("responds 400 for a body that is not JSON", async () => {
      expect((await post("not json at all")).status).toBe(400);
    });

    it("responds 400 for an empty body", async () => {
      expect((await post("")).status).toBe(400);
    });

    it("responds 413 for a body over the limit", async () => {
      // 9,000 characters of question is over the 8 KiB body cap, so this is
      // refused before the schema ever sees it.
      const response = await post({ question: "a".repeat(9_000) });

      expect(response.status).toBe(413);
    });

    it("explains the refusal in the body", async () => {
      const body = await (await post({ question: "Why?" })).json();

      // The service's messages are written to be shown to a caller, so they
      // pass through — which is the opposite of the 500 path below.
      expect(body.error).toContain("at least 10 characters");
    });

    it("carries the error and nothing else", async () => {
      const body = await (await post({ question: "" })).json();

      expect(Object.keys(body)).toStrictEqual(["error"]);
    });

    it("does not leak internals when the failure is not a service error", async () => {
      const body = await (await post({ question: "Why?" })).json();

      expect(body).not.toHaveProperty("stack");
      expect(body).not.toHaveProperty("issues");
      expect(body).not.toHaveProperty("cause");
    });

    it("records nothing when the request was refused", async () => {
      await post({ question: "Why?" });

      // A refused request must not leave a record behind — an empty list is the
      // observable form of that, and it is what a caller reads next.
      expect(await GET().json()).toStrictEqual({ research: [] });
    });
  });

  describe("what a caller cannot put into a run", () => {
    it("ignores a status, findings and result supplied in the body", async () => {
      const body = await (
        await post({
          question: QUESTION,
          status: "completed",
          findings: [{ statement: "Costs fell.", basis: "source" }],
          sources: [{ url: "https://example.org/a" }],
          result: { sufficiency: "sufficient" },
        })
      ).json();

      // The property that matters most on this endpoint. A finding is a claim
      // about the world with a URL behind it, so a client able to inject one
      // could manufacture evidence — and it would arrive with the run's
      // provenance attached, indistinguishable from something retrieved.
      expect(body.research.result.sufficiency).not.toBe("sufficient");
      expect(body.research.findings).toStrictEqual([]);
      expect(body.research.sources).toStrictEqual([]);
      expect(body.research.evidence).toStrictEqual([]);
    });

    it("ignores limits supplied in the body", async () => {
      // §10's limits are the operator's budget, read from the environment. A
      // caller that could raise them would be spending someone else's money.
      const body = await (
        await post({
          question: QUESTION,
          limits: { maxTasks: 1_000, maxSourcesTotal: 100_000 },
          maxDurationMs: 3_600_000,
        })
      ).json();

      expect(body.research.request.question).toBe(QUESTION);
      expect(Object.keys(body.research.request).sort()).toStrictEqual([
        "createdAt",
        "id",
        "question",
      ]);
    });
  });

  describe("what the endpoint is wired to", () => {
    it("lists a run once it has been made", async () => {
      const created = await (await post({ question: QUESTION })).json();
      const listed = await GET().json();

      expect(listed.research.map((item: { id: string }) => item.id)).toStrictEqual([
        created.research.id,
      ]);
    });

    it("lists a summary rather than the record", async () => {
      await post({ question: QUESTION });
      const [summary] = (await GET().json()).research;

      // A full record carries every retrieved passage and the whole event log.
      // That is the right size for one record and the wrong size for a list.
      expect(summary.question).toBe(QUESTION);
      expect(typeof summary.sourceCount).toBe("number");
      expect(typeof summary.findingCount).toBe("number");
      expect(typeof summary.conflictCount).toBe("number");
      expect(summary).not.toHaveProperty("sources");
      expect(summary).not.toHaveProperty("findings");
      expect(summary).not.toHaveProperty("events");
      expect(summary).not.toHaveProperty("observations");
      expect(summary).not.toHaveProperty("request");
    });

    it("lists the most recent run first", async () => {
      const first = await (await post({ question: QUESTION })).json();
      const second = await (
        await post({ question: "How much grid-scale storage was installed?" })
      ).json();

      const listed = await GET().json();

      expect(listed.research.map((item: { id: string }) => item.id)).toStrictEqual([
        second.research.id,
        first.research.id,
      ]);
    });
  });
});

describe("the segment's rendering mode", () => {
  it("declares itself dynamic", () => {
    // The build already proves this holds — the route table renders
    // `/api/research` as `ƒ` — but the build is not run on every change. The
    // export is a behavioural contract: `GET` reads a store that is empty at
    // build time, so a statically rendered route would serve that empty list
    // forever and look correct while never returning a run that happened.
    expect(dynamic).toBe("force-dynamic");
  });
});
