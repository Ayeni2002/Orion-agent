import { afterEach, describe, expect, it, vi } from "vitest";

import type { ResearchSource } from "@/types/research";

import {
  createGeminiSearchProvider,
  DEFAULT_GEMINI_SEARCH_TIMEOUT_MS,
  GEMINI_SEARCH_PROVIDER_ID,
} from "./gemini-search-provider";
import { ResearchProviderError } from "./provider";

/**
 * The Gemini grounding adapter, exercised without a network.
 *
 * `fetch` is stubbed for every test and no test reads a real credential, for the
 * reasons the model adapter's test file gives.
 *
 * **The two groups that matter are "what it refuses to read" and "what it does
 * when nothing was grounded".** This adapter depends on one remote payload shape
 * — Gemini's grounding metadata — that was written from documentation rather
 * than from an observed call, and the design's whole safety argument is that
 * misreading it produces *no sources* instead of wrong ones. These tests are
 * where that argument is checked rather than asserted in a comment: an
 * unrecognised shape must come back as `performedRetrieval: false`, and the
 * model's own prose must never become a source's `content`, because downstream
 * the finding extractor verifies verbatim quotes against exactly that field.
 */

const ENDPOINT = "https://example.invalid/v1beta";
const MODEL = "gemini-2.0-flash";
const FAKE_KEY = "test-key-not-a-real-credential";

const REQUEST = { query: "what is grounding", maxResults: 5 };

function createProvider() {
  return createGeminiSearchProvider({ endpoint: ENDPOINT, model: MODEL });
}

function captureFetch() {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function firstCall(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls[0] as unknown[] | undefined;

  if (call === undefined) {
    throw new Error("The adapter made no request.");
  }

  const init = (call[1] ?? {}) as RequestInit;

  return {
    url: String(call[0]),
    method: init.method ?? "",
    header: (name: string) => new Headers(init.headers).get(name),
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
    signal: init.signal,
  };
}

function reply(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

/** One grounding chunk, as Gemini emits it. */
function chunk(uri: string, title?: string) {
  return { web: { uri, ...(title === undefined ? {} : { title }) } };
}

/** A grounded response, which individual tests then spoil. */
function grounded(chunks: unknown[], extra: Record<string, unknown> = {}) {
  return {
    candidates: [
      {
        content: { parts: [{ text: "an answer drawn from the pages" }] },
        finishReason: "STOP",
        groundingMetadata: { groundingChunks: chunks, ...extra },
      },
    ],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("descriptor", () => {
  it("reports itself as external and configured", () => {
    const provider = createProvider();

    expect(provider.descriptor).toStrictEqual({
      id: GEMINI_SEARCH_PROVIDER_ID,
      label: "Google Search grounding",
      model: MODEL,
      isExternal: true,
    });
    expect(provider.isConfigured).toBe(true);
  });

  it("carries no endpoint, so no credential can travel with it", () => {
    expect(JSON.stringify(createProvider().descriptor)).not.toContain(
      "example.invalid",
    );
  });
});

describe("the request it sends", () => {
  it("posts to :generateContent with the search tool attached", async () => {
    const fetchMock = captureFetch().mockResolvedValue(reply(grounded([])));

    await createProvider().search(REQUEST);

    expect(firstCall(fetchMock).url).toBe(
      `${ENDPOINT}/models/${MODEL}:generateContent`,
    );
    expect(firstCall(fetchMock).method).toBe("POST");
    // The entire mechanism. An empty object rather than options: an option the
    // service does not recognise is a chance of a rejected request, and the
    // per-task ceiling is enforced locally anyway.
    expect(firstCall(fetchMock).body.tools).toStrictEqual([{ google_search: {} }]);
  });

  // A grounded call needs a free-text answer for the search to attach chunks to.
  // Constraining the model to JSON would be asking it to search and then not
  // write anything, which is the shape of a request that silently grounds
  // nothing.
  it("never constrains the response to JSON", async () => {
    const fetchMock = captureFetch().mockResolvedValue(reply(grounded([])));

    await createProvider().search(REQUEST);

    expect(firstCall(fetchMock).body).not.toHaveProperty("generationConfig");
    expect(firstCall(fetchMock).body).not.toHaveProperty("responseMimeType");
  });

  it("sends the query as the prompt and nowhere else", async () => {
    const fetchMock = captureFetch().mockResolvedValue(reply(grounded([])));

    await createProvider().search({ query: "a query with spaces", maxResults: 3 });

    const contents = firstCall(fetchMock).body.contents as {
      parts: { text: string }[];
    }[];

    expect(contents[0]?.parts[0]?.text).toBe("a query with spaces");
    // Untrusted model output must not reach the URL, a header, or a command.
    expect(firstCall(fetchMock).url).not.toContain("a query with spaces");
  });

  it("bounds the call with an abort signal", async () => {
    const fetchMock = captureFetch().mockResolvedValue(reply(grounded([])));

    await createProvider().search(REQUEST);

    expect(firstCall(fetchMock).signal).toBeInstanceOf(AbortSignal);
  });
});

describe("the credential", () => {
  it("is sent in a header when one is configured", async () => {
    vi.stubEnv("LLM_API_KEY", FAKE_KEY);
    const fetchMock = captureFetch().mockResolvedValue(reply(grounded([])));

    await createProvider().search(REQUEST);

    expect(firstCall(fetchMock).header("x-goog-api-key")).toBe(FAKE_KEY);
  });

  it("never appears in the request URL", async () => {
    vi.stubEnv("LLM_API_KEY", FAKE_KEY);
    const fetchMock = captureFetch().mockResolvedValue(reply(grounded([])));

    await createProvider().search(REQUEST);

    expect(firstCall(fetchMock).url).not.toContain(FAKE_KEY);
    expect(firstCall(fetchMock).url).not.toContain("key=");
  });

  it("is omitted entirely when none is configured", async () => {
    vi.stubEnv("LLM_API_KEY", "");
    const fetchMock = captureFetch().mockResolvedValue(reply(grounded([])));

    await createProvider().search(REQUEST);

    expect(firstCall(fetchMock).header("x-goog-api-key")).toBeNull();
  });

  it("never appears in an error, even when the endpoint rejects it", async () => {
    vi.stubEnv("LLM_API_KEY", FAKE_KEY);
    captureFetch().mockResolvedValue(
      reply(
        { error: { message: "API key not valid", status: "INVALID_ARGUMENT" } },
        { status: 400 },
      ),
    );

    const error = await createProvider()
      .search(REQUEST)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ResearchProviderError);
    expect((error as Error).message).not.toContain(FAKE_KEY);
  });

  it("never appears in a transport failure", async () => {
    vi.stubEnv("LLM_API_KEY", FAKE_KEY);
    captureFetch().mockRejectedValue(new TypeError("fetch failed"));

    const error = await createProvider()
      .search(REQUEST)
      .catch((thrown: unknown) => thrown);

    expect((error as Error).message).not.toContain(FAKE_KEY);
  });
});

describe("what it returns when grounding happened", () => {
  it("turns each grounding chunk into a source", async () => {
    captureFetch().mockResolvedValue(
      reply(
        grounded([
          chunk("https://example.com/a", "Page A"),
          chunk("https://example.org/b", "Page B"),
        ]),
      ),
    );

    const response = await createProvider().search(REQUEST);

    expect(response.sources.map((source) => source.url)).toStrictEqual([
      "https://example.com/a",
      "https://example.org/b",
    ]);
    expect(response.sources.map((source) => source.title)).toStrictEqual([
      "Page A",
      "Page B",
    ]);
    expect(response.providerId).toBe(GEMINI_SEARCH_PROVIDER_ID);
    expect(response.performedRetrieval).toBe(true);
  });

  it("derives the domain and numbers the results in order", async () => {
    captureFetch().mockResolvedValue(
      reply(grounded([chunk("https://www.example.com/a")])),
    );

    const response = await createProvider().search(REQUEST);
    const source = response.sources[0] as ResearchSource;

    // Re-derived from the vetted URL by the search tool downstream; derived here
    // because the interface requires it and from the same string, so the two
    // cannot disagree about what this source is.
    expect(source.domain).toBe("example.com");
    expect(source.rank).toBe(1);
    expect(source.retrievedAt).toBeTruthy();
    expect(source.providerId).toBe(GEMINI_SEARCH_PROVIDER_ID);
  });

  it("accepts a chunk with no title", async () => {
    captureFetch().mockResolvedValue(
      reply(grounded([chunk("https://example.com/a")])),
    );

    const response = await createProvider().search(REQUEST);

    expect(response.sources[0]).not.toHaveProperty("title");
  });

  // Grounding emits one chunk per *supported claim*, so a page cited for several
  // claims arrives several times. Without deduplication a ceiling of five could
  // be spent on one page listed five times, and the run would report five
  // sources where it had one — a quantity claim a reader would believe.
  it("deduplicates a page cited for several claims", async () => {
    captureFetch().mockResolvedValue(
      reply(
        grounded([
          chunk("https://example.com/a", "Page A"),
          chunk("https://example.com/a", "Page A"),
          chunk("https://example.org/b"),
        ]),
      ),
    );

    const response = await createProvider().search(REQUEST);

    expect(response.sources.map((source) => source.url)).toStrictEqual([
      "https://example.com/a",
      "https://example.org/b",
    ]);
  });

  it("trims to the requested ceiling but still reports that it searched", async () => {
    captureFetch().mockResolvedValue(
      reply(
        grounded([
          chunk("https://example.com/1"),
          chunk("https://example.com/2"),
          chunk("https://example.com/3"),
          chunk("https://example.com/4"),
        ]),
      ),
    );

    const response = await createProvider().search({ ...REQUEST, maxResults: 2 });

    expect(response.sources).toHaveLength(2);
    // Counted before the ceiling: a response grounding four pages and keeping
    // two still means a search ran, and that is the question this answers.
    expect(response.performedRetrieval).toBe(true);
  });

  it("passes a hostile URL through rather than dropping it here", async () => {
    captureFetch().mockResolvedValue(
      reply(grounded([chunk("javascript:alert(1)")])),
    );

    const response = await createProvider().search(REQUEST);

    // Vetting is the search tool's job and happens in exactly one place.
    // Dropping it here would hide it from that tool's `rejectedSourceCount`,
    // which is the number that tells an operator something hostile came back.
    expect(response.sources.map((source) => source.url)).toStrictEqual([
      "javascript:alert(1)",
    ]);
  });
});

describe("what it refuses to read", () => {
  // The load-bearing test of the whole design. `groundingSupports[].segment.text`
  // is the model's own prose and it sits right next to the chunk indices; taking
  // it as source content would make the finding extractor's verbatim-quote check
  // pass against a sentence no page ever contained.
  it("never copies the model's prose into a source's content", async () => {
    captureFetch().mockResolvedValue(
      reply(
        grounded([chunk("https://example.com/a", "Page A")], {
          groundingSupports: [
            {
              segment: { text: "The model's own sentence about the subject." },
              groundingChunkIndices: [0],
            },
          ],
        }),
      ),
    );

    const response = await createProvider().search(REQUEST);
    const source = response.sources[0] as ResearchSource;

    expect(source).not.toHaveProperty("content");
    expect(JSON.stringify(response.sources)).not.toContain(
      "The model's own sentence",
    );
  });

  it("discards the candidate's answer entirely", async () => {
    captureFetch().mockResolvedValue(
      reply({
        candidates: [
          {
            content: {
              parts: [{ text: "According to example.com, the claim is true." }],
            },
            finishReason: "STOP",
          },
        ],
      }),
    );

    const response = await createProvider().search(REQUEST);

    // The prose is what a model produces when grounding did not happen. There is
    // no path by which generated text becomes a retrieved source.
    expect(response.sources).toStrictEqual([]);
    expect(response.performedRetrieval).toBe(false);
  });

  // Every one of these is a shape this adapter might meet if the grounding
  // payload has been misread. Each must come back as "nothing was retrieved"
  // rather than as an error or as invented sources — that is what makes a wrong
  // guess cost a failed search instead of a fabricated citation.
  it.each([
    ["no grounding metadata at all", { candidates: [{ finishReason: "STOP" }] }],
    [
      "an empty grounding chunks array",
      { candidates: [{ groundingMetadata: { groundingChunks: [] } }] },
    ],
    [
      "grounding metadata that is not an object",
      { candidates: [{ groundingMetadata: "nope" }] },
    ],
    [
      "grounding chunks that are not an array",
      { candidates: [{ groundingMetadata: { groundingChunks: "nope" } }] },
    ],
    ["a chunk that is not an object", grounded(["nope"])],
    ["a chunk with no web field", grounded([{ retrievedContext: {} }])],
    ["a chunk whose web is not an object", grounded([{ web: "nope" }])],
    ["a chunk with no uri", grounded([{ web: { title: "Page A" } }])],
    ["a chunk with an empty uri", grounded([{ web: { uri: "   " } }])],
    ["a chunk with a non-string uri", grounded([{ web: { uri: 42 } }])],
    ["a different spelling of the field", grounded([{ web: { url: "https://example.com/a" } }])],
  ])("reports no retrieval for %s", async (_label, payload) => {
    captureFetch().mockResolvedValue(reply(payload));

    const response = await createProvider().search(REQUEST);

    expect(response.sources).toStrictEqual([]);
    expect(response.performedRetrieval).toBe(false);
  });
});

describe("the response it refuses", () => {
  // A body that is not a generateContent response at all means the endpoint is
  // not speaking the protocol this adapter was written for. Reporting that as
  // "no sources" would hide a misconfiguration behind an ordinary-looking empty
  // result — the opposite case from the group above, and the reason the two are
  // separated here.
  const malformed: [string, unknown][] = [
    ["a body that is not JSON at all", "<html>gateway error</html>"],
    ["a JSON value that is not an object", [1, 2, 3]],
    ["an object with no candidates", { id: "x" }],
    ["an empty candidates array", { candidates: [] }],
    ["a candidate that is not an object", { candidates: ["nope"] }],
  ];

  it.each(malformed)("rejects %s", async (_label, payload) => {
    const fetchMock = captureFetch();

    if (typeof payload === "string") {
      fetchMock.mockResolvedValue(
        new Response(payload, {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
      );
    } else {
      fetchMock.mockResolvedValue(reply(payload));
    }

    await expect(createProvider().search(REQUEST)).rejects.toBeInstanceOf(
      ResearchProviderError,
    );
  });

  it("surfaces the upstream message on an HTTP failure", async () => {
    captureFetch().mockResolvedValue(
      reply(
        { error: { code: 429, message: "Quota exceeded" } },
        { status: 429 },
      ),
    );

    const error = (await createProvider()
      .search(REQUEST)
      .catch((thrown: unknown) => thrown)) as Error;

    expect(error.message).toContain("429");
    expect(error.message).toContain("Quota exceeded");
  });

  it("reports a timeout as a timeout", async () => {
    const timeout = new Error("aborted");
    timeout.name = "TimeoutError";
    captureFetch().mockRejectedValue(timeout);

    const error = (await createProvider()
      .search(REQUEST)
      .catch((thrown: unknown) => thrown)) as Error;

    expect(error).toBeInstanceOf(ResearchProviderError);
    expect(error.message).toContain(String(DEFAULT_GEMINI_SEARCH_TIMEOUT_MS));
  });

  it("names its provider on every failure", async () => {
    captureFetch().mockRejectedValue(new TypeError("fetch failed"));

    const error = (await createProvider()
      .search(REQUEST)
      .catch((thrown: unknown) => thrown)) as ResearchProviderError;

    expect(error.providerId).toBe(GEMINI_SEARCH_PROVIDER_ID);
  });
});
