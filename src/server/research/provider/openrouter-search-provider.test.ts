import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createOpenRouterSearchProvider,
  DEFAULT_SEARCH_TIMEOUT_MS,
  OPENROUTER_SEARCH_PROVIDER_ID,
} from "./openrouter-search-provider";
import {
  ResearchProviderError,
  type ResearchProviderRequest,
} from "./provider";

/**
 * The web-search adapter, exercised without a network.
 *
 * `fetch` is stubbed in every test here and no test reads a real credential,
 * which is the rule `docs/DEVELOPMENT_PHASES.md` sets and the only way to know
 * the suite is not quietly relying on one.
 *
 * What this file deliberately does not assert is OpenRouter's live behaviour.
 * A test that reached the real endpoint would fail on a plane, in CI, and the
 * day a key is rotated — and it would be testing OpenRouter rather than this
 * adapter. The contract asserted here is the one the adapter promises its
 * caller: a request of a particular shape goes out, and every shape of answer
 * that can come back is handled.
 *
 * Two tests below carry more weight than the rest, and they are the two that
 * pin the decisions in the module docblock: a response carrying model prose and
 * no citations yields no sources, and it reports `performedRetrieval: false`.
 * Together they are the guarantee that an endpoint which ignores the search
 * plugin cannot put generated text into a result as though it were retrieved.
 */

const ENDPOINT = "https://openrouter.ai/api/v1";
const MODEL = "openai/gpt-4o-mini";
const FAKE_KEY = "test-key-not-a-real-credential";

const REQUEST: ResearchProviderRequest = {
  query: "grid-scale battery storage cost",
  maxResults: 5,
};

function createProvider() {
  return createOpenRouterSearchProvider({
    endpoint: ENDPOINT,
    model: MODEL,
  });
}

function captureFetch() {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The single call the adapter made, as a shape the assertions can read. */
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

/** One `url_citation` annotation, shaped as the service documents it. */
function citation(url: string, overrides: Record<string, unknown> = {}) {
  return {
    type: "url_citation",
    url_citation: {
      url,
      title: `Source at ${url}`,
      content: "Grid-scale pack prices fell by about 40%.",
      start_index: 0,
      end_index: 40,
      ...overrides,
    },
  };
}

/** A completion carrying the given annotations, and prose nobody should read. */
function searchReply(annotations: unknown[]) {
  return reply({
    choices: [
      {
        message: {
          role: "assistant",
          content: "See https://invented.example/not-a-real-source for details.",
          annotations,
        },
        finish_reason: "stop",
      },
    ],
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("descriptor", () => {
  it("reports itself as external, with the configured model", () => {
    const provider = createProvider();

    expect(provider.descriptor).toStrictEqual({
      id: OPENROUTER_SEARCH_PROVIDER_ID,
      label: "Web search",
      model: MODEL,
      isExternal: true,
    });
  });

  it("reports itself as configured, because there is somewhere to send", () => {
    expect(createProvider().isConfigured).toBe(true);
  });

  // The descriptor reaches the workspace, which tells the user which engine
  // produced a result. A base URL can carry a credential in its userinfo or a
  // query parameter, so it must not appear here.
  it("carries no endpoint, so no credential can travel with it", () => {
    const provider = createProvider();

    expect(JSON.stringify(provider.descriptor)).not.toContain("openrouter.ai");
  });
});

describe("the request it sends", () => {
  it("posts to /chat/completions beneath the base URL", async () => {
    const fetchMock = captureFetch().mockResolvedValue(searchReply([]));

    await createProvider().search(REQUEST);

    expect(firstCall(fetchMock).url).toBe(`${ENDPOINT}/chat/completions`);
    expect(firstCall(fetchMock).method).toBe("POST");
  });

  it("tolerates a trailing slash on the configured endpoint", async () => {
    const fetchMock = captureFetch().mockResolvedValue(searchReply([]));

    await createOpenRouterSearchProvider({
      endpoint: `${ENDPOINT}/`,
      model: MODEL,
    }).search(REQUEST);

    expect(firstCall(fetchMock).url).toBe(`${ENDPOINT}/chat/completions`);
  });

  it("asks for the web plugin", async () => {
    const fetchMock = captureFetch().mockResolvedValue(searchReply([]));

    await createProvider().search(REQUEST);

    // The field that makes this a retrieval call rather than an inference call.
    // Nothing else about the request produces sources.
    expect(firstCall(fetchMock).body.plugins).toStrictEqual([{ id: "web" }]);
  });

  it("sends the model and the query", async () => {
    const fetchMock = captureFetch().mockResolvedValue(searchReply([]));

    await createProvider().search(REQUEST);

    const body = firstCall(fetchMock).body;
    expect(body.model).toBe(MODEL);

    const messages = body.messages as { role: string; content: string }[];
    expect(messages.at(-1)?.content).toBe(REQUEST.query);
  });

  it("sends the credential when one is configured", async () => {
    const fetchMock = captureFetch().mockResolvedValue(searchReply([]));
    vi.stubEnv("LLM_API_KEY", FAKE_KEY);

    await createProvider().search(REQUEST);

    expect(firstCall(fetchMock).header("authorization")).toBe(`Bearer ${FAKE_KEY}`);
  });

  it("omits the header entirely when no key is configured", async () => {
    const fetchMock = captureFetch().mockResolvedValue(searchReply([]));
    vi.stubEnv("LLM_API_KEY", "");

    await createProvider().search(REQUEST);

    // Absent rather than empty: a bare `Authorization: Bearer ` is rejected by
    // endpoints that accept no header at all.
    expect(firstCall(fetchMock).header("authorization")).toBeNull();
  });

  // Retrieval happens inside a request that is waiting on it, so an unbounded
  // call is a run held open with nothing recorded.
  it("bounds the call with a timeout signal", async () => {
    const fetchMock = captureFetch().mockResolvedValue(searchReply([]));

    await createProvider().search(REQUEST);

    expect(firstCall(fetchMock).signal).toBeInstanceOf(AbortSignal);
  });
});

describe("the sources it returns", () => {
  it("turns a citation into a source", async () => {
    captureFetch().mockResolvedValue(
      searchReply([citation("https://example.org/grid-storage")]),
    );

    const response = await createProvider().search(REQUEST);

    expect(response.sources).toHaveLength(1);
    expect(response.sources[0]).toMatchObject({
      url: "https://example.org/grid-storage",
      domain: "example.org",
      providerId: OPENROUTER_SEARCH_PROVIDER_ID,
    });
  });

  it("carries the title and the cited passage", async () => {
    captureFetch().mockResolvedValue(
      searchReply([citation("https://example.org/a")]),
    );

    const response = await createProvider().search(REQUEST);

    // `content` is what the extractor later quotes. A citation whose passage is
    // dropped here is a citation no finding can rest on.
    expect(response.sources[0]?.title).toBe("Source at https://example.org/a");
    expect(response.sources[0]?.content).toBe(
      "Grid-scale pack prices fell by about 40%.",
    );
  });

  it("keeps the provider's ranking order", async () => {
    captureFetch().mockResolvedValue(
      searchReply([
        citation("https://first.example/a"),
        citation("https://second.example/b"),
        citation("https://third.example/c"),
      ]),
    );

    const response = await createProvider().search(REQUEST);

    expect(response.sources.map((source) => source.url)).toStrictEqual([
      "https://first.example/a",
      "https://second.example/b",
      "https://third.example/c",
    ]);
  });

  it("derives the domain without the www prefix", async () => {
    captureFetch().mockResolvedValue(
      searchReply([citation("https://www.example.org/a")]),
    );

    const response = await createProvider().search(REQUEST);

    expect(response.sources[0]?.domain).toBe("example.org");
  });

  it("omits title and content rather than inventing them", async () => {
    captureFetch().mockResolvedValue(
      searchReply([
        citation("https://example.org/a", { title: undefined, content: undefined }),
      ]),
    );

    const response = await createProvider().search(REQUEST);

    // Absent, not present-and-empty: a source with no body text cannot support
    // a quote, and `ResearchFinding.basis` exists to express exactly that.
    expect(Object.hasOwn(response.sources[0] ?? {}, "title")).toBe(false);
    expect(Object.hasOwn(response.sources[0] ?? {}, "content")).toBe(false);
  });

  it("treats a whitespace-only title as absent", async () => {
    captureFetch().mockResolvedValue(
      searchReply([citation("https://example.org/a", { title: "   " })]),
    );

    const response = await createProvider().search(REQUEST);

    expect(Object.hasOwn(response.sources[0] ?? {}, "title")).toBe(false);
  });

  it("reports that retrieval happened when citations came back", async () => {
    captureFetch().mockResolvedValue(
      searchReply([citation("https://example.org/a")]),
    );

    const response = await createProvider().search(REQUEST);

    expect(response.performedRetrieval).toBe(true);
  });

  it("reports no retrieval when no citations came back", async () => {
    // The plugin-ignored case, and the reason this is not "did the HTTP call
    // succeed". The endpoint answered normally; it did not search.
    captureFetch().mockResolvedValue(searchReply([]));

    const response = await createProvider().search(REQUEST);

    expect(response.performedRetrieval).toBe(false);
    expect(response.sources).toStrictEqual([]);
  });

  it("reports no retrieval when the annotations field is absent", async () => {
    captureFetch().mockResolvedValue(
      reply({
        choices: [
          { message: { role: "assistant", content: "Paris." }, finish_reason: "stop" },
        ],
      }),
    );

    const response = await createProvider().search(REQUEST);

    expect(response.performedRetrieval).toBe(false);
  });

  // The single most important assertion in this file. An endpoint that drops
  // the plugin returns the model's own answer, and the model's own answer
  // routinely contains URLs. None of it may become a source.
  it("discards the model's prose, including any URL in it", async () => {
    captureFetch().mockResolvedValue(searchReply([]));

    const response = await createProvider().search(REQUEST);

    expect(response.sources).toStrictEqual([]);
    expect(JSON.stringify(response)).not.toContain("invented.example");
  });

  it("ignores an annotation of a kind it does not know", async () => {
    captureFetch().mockResolvedValue(
      searchReply([
        { type: "file_citation", file_citation: { file_id: "file-1" } },
        citation("https://example.org/a"),
      ]),
    );

    const response = await createProvider().search(REQUEST);

    expect(response.sources).toHaveLength(1);
    expect(response.sources[0]?.url).toBe("https://example.org/a");
  });

  it("ignores an annotation that is not an object", async () => {
    captureFetch().mockResolvedValue(
      searchReply(["nope", citation("https://example.org/a")]),
    );

    const response = await createProvider().search(REQUEST);

    expect(response.sources).toHaveLength(1);
  });

  it("ignores a citation with no URL", async () => {
    captureFetch().mockResolvedValue(
      searchReply([
        { type: "url_citation", url_citation: { title: "No URL here" } },
      ]),
    );

    const response = await createProvider().search(REQUEST);

    expect(response.sources).toStrictEqual([]);
    expect(response.performedRetrieval).toBe(false);
  });

  it("ignores a citation whose url_citation payload is missing", async () => {
    captureFetch().mockResolvedValue(
      searchReply([{ type: "url_citation" }]),
    );

    const response = await createProvider().search(REQUEST);

    expect(response.sources).toStrictEqual([]);
  });

  // URL vetting belongs to the search tool and happens in exactly one place.
  // Dropping a hostile URL here instead would hide it from the tool's
  // `rejectedSourceCount`, which is the number that tells an operator something
  // hostile came back at all.
  it("passes a hostile URL through for the tool to reject", async () => {
    captureFetch().mockResolvedValue(
      searchReply([citation("javascript:alert(1)")]),
    );

    const response = await createProvider().search(REQUEST);

    expect(response.sources).toHaveLength(1);
    expect(response.sources[0]?.url).toBe("javascript:alert(1)");
    // Not guessed: an unparseable URL has no domain, and says so.
    expect(response.sources[0]?.domain).toBe("");
    expect(response.performedRetrieval).toBe(true);
  });

  it("keeps only as many sources as the caller asked for", async () => {
    captureFetch().mockResolvedValue(
      searchReply([
        citation("https://first.example/a"),
        citation("https://second.example/b"),
        citation("https://third.example/c"),
      ]),
    );

    const response = await createProvider().search({ ...REQUEST, maxResults: 2 });

    // The highest-ranked ones, because the service ranked them.
    expect(response.sources.map((source) => source.url)).toStrictEqual([
      "https://first.example/a",
      "https://second.example/b",
    ]);
  });

  it("still reports retrieval when the ceiling trimmed everything it found", async () => {
    captureFetch().mockResolvedValue(
      searchReply([
        citation("https://first.example/a"),
        citation("https://second.example/b"),
      ]),
    );

    const response = await createProvider().search({ ...REQUEST, maxResults: 1 });

    // The ceiling decides what is kept, not whether a search happened. Reading
    // it the other way would report a page of citations as no retrieval at all.
    expect(response.sources).toHaveLength(1);
    expect(response.performedRetrieval).toBe(true);
  });

  it("caps a nonsensical maxResults at the structural maximum", async () => {
    captureFetch().mockResolvedValue(
      searchReply(
        Array.from({ length: 60 }, (_unused, index) =>
          citation(`https://example.org/${index}`),
        ),
      ),
    );

    const response = await createProvider().search({
      ...REQUEST,
      maxResults: 10_000,
    });

    expect(response.sources).toHaveLength(50);
  });
});

describe("the response it refuses", () => {
  const malformed: [string, unknown][] = [
    ["a body that is not JSON at all", "<html>gateway error</html>"],
    ["a JSON value that is not an object", [1, 2, 3]],
    ["an object with no choices", { id: "x" }],
    ["an empty choices array", { choices: [] }],
    ["a choice that is not an object", { choices: ["nope"] }],
    ["a choice with no message", { choices: [{ finish_reason: "stop" }] }],
    ["a message that is not an object", { choices: [{ message: "text" }] }],
  ];

  it.each(malformed)("rejects %s", async (_label, payload) => {
    const fetchMock = captureFetch();

    if (typeof payload === "string") {
      fetchMock.mockResolvedValue(
        new Response(payload, { status: 200, headers: { "Content-Type": "text/html" } }),
      );
    } else {
      fetchMock.mockResolvedValue(reply(payload));
    }

    await expect(createProvider().search(REQUEST)).rejects.toBeInstanceOf(
      ResearchProviderError,
    );
  });

  // A body with no completion is an endpoint that is not speaking this
  // protocol. Reporting it as "no sources" would hide a misconfiguration behind
  // an ordinary-looking empty result.
  it("rejects a response with no completion rather than reporting no sources", async () => {
    captureFetch().mockResolvedValue(reply({ error: { message: "nope" } }));

    await expect(createProvider().search(REQUEST)).rejects.toThrow(
      /returned no completion/,
    );
  });

  it("surfaces the upstream message on an HTTP failure", async () => {
    captureFetch().mockResolvedValue(
      reply(
        { error: { message: "Insufficient credits", code: 402 } },
        { status: 402, statusText: "Payment Required" },
      ),
    );

    const error = (await createProvider()
      .search(REQUEST)
      .catch((thrown: unknown) => thrown)) as Error;

    expect(error.message).toContain("402");
    expect(error.message).toContain("Insufficient credits");
  });

  // An HTML error page from a proxy can be arbitrarily large and can echo the
  // request. Neither belongs in a message that reaches a log or a response.
  it("does not repeat a non-JSON error body", async () => {
    captureFetch().mockResolvedValue(
      new Response("<html>Bad gateway</html>", { status: 502 }),
    );

    const error = (await createProvider()
      .search(REQUEST)
      .catch((thrown: unknown) => thrown)) as Error;

    expect(error.message).toContain("502");
    expect(error.message).not.toContain("Bad gateway");
  });

  it("names the search endpoint rather than the model one", async () => {
    captureFetch().mockResolvedValue(new Response("", { status: 500 }));

    const error = (await createProvider()
      .search(REQUEST)
      .catch((thrown: unknown) => thrown)) as Error;

    // An operator reading this has two remote calls in a run; the message has
    // to say which of them failed.
    expect(error.message).toContain("search endpoint");
  });

  it("reports a timeout as a timeout", async () => {
    const timeout = new Error("aborted");
    timeout.name = "TimeoutError";
    captureFetch().mockRejectedValue(timeout);

    const error = (await createProvider()
      .search(REQUEST)
      .catch((thrown: unknown) => thrown)) as Error;

    expect(error).toBeInstanceOf(ResearchProviderError);
    expect(error.message).toContain(String(DEFAULT_SEARCH_TIMEOUT_MS));
  });

  it("names its provider on every failure", async () => {
    captureFetch().mockRejectedValue(new TypeError("fetch failed"));

    const error = (await createProvider()
      .search(REQUEST)
      .catch((thrown: unknown) => thrown)) as ResearchProviderError;

    expect(error.providerId).toBe(OPENROUTER_SEARCH_PROVIDER_ID);
  });

  // The credential is read inside `search`, written into one header, and
  // dropped. Nothing about a failure may carry it out.
  it("never lets the credential reach an error message", async () => {
    vi.stubEnv("LLM_API_KEY", FAKE_KEY);

    captureFetch().mockRejectedValue(
      new TypeError(`request failed with Bearer ${FAKE_KEY}`),
    );

    const error = (await createProvider()
      .search(REQUEST)
      .catch((thrown: unknown) => thrown)) as Error;

    expect(error.message).not.toContain(FAKE_KEY);
  });

  it("does not carry the credential on the instance", () => {
    vi.stubEnv("LLM_API_KEY", FAKE_KEY);

    const provider = createProvider();

    expect(JSON.stringify(provider.descriptor)).not.toContain(FAKE_KEY);
    expect({ ...provider }).not.toHaveProperty("apiKey");
  });
});
