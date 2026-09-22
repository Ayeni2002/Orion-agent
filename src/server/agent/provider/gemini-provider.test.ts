import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createGeminiProvider,
  DEFAULT_GEMINI_TIMEOUT_MS,
  GEMINI_STYLE_PROVIDER_ID,
} from "./gemini-provider";
import { ModelProviderError, type ModelProviderRequest } from "./provider";

/**
 * The native Gemini adapter, exercised without a network.
 *
 * `fetch` is stubbed for every test here, and no test reads a real credential.
 * That is not tidiness: `docs/DEVELOPMENT_PHASES.md` requires the suite to run
 * with no API key present at all, which is the only way to know the tests are
 * not quietly relying on one. The key stubbed below is a literal that exists
 * nowhere else, and the assertion that it never appears in an error message is
 * one of the tests.
 *
 * What this file deliberately does not do is assert against Google's live
 * behaviour. A test that reached the real endpoint would fail on a plane, in CI,
 * and the day someone rotates a key — and it would be testing Gemini, not this
 * adapter. The contract asserted here is the one the adapter promises its
 * caller: a request of a particular shape goes out, and every shape of answer
 * that can come back is handled.
 *
 * The one thing worth reading this file for is the credential group. Gemini
 * accepts its key as a `?key=` query parameter, which is the form most examples
 * show, and a credential in a URL is written to every log that sees the request
 * line. These tests exist so that a future edit reaching for the simpler form
 * fails here rather than in production.
 */

const ENDPOINT = "https://example.invalid/v1beta";
const MODEL = "gemini-2.0-flash";
const FAKE_KEY = "test-key-not-a-real-credential";

const REQUEST: ModelProviderRequest = {
  operation: "plan",
  instruction: "Decompose the objective.",
  context: { objective: "Count the words in a sentence." },
};

function createProvider() {
  return createGeminiProvider({ endpoint: ENDPOINT, model: MODEL });
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

/** A well-formed grounded generation, which individual tests then spoil. */
function generation(overrides: Record<string, unknown> = {}) {
  return {
    candidates: [
      {
        content: { parts: [{ text: "the model's answer" }] },
        finishReason: "STOP",
      },
    ],
    usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 22 },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("descriptor", () => {
  it("reports itself as external, with the configured model", () => {
    const provider = createProvider();

    expect(provider.descriptor).toStrictEqual({
      id: GEMINI_STYLE_PROVIDER_ID,
      label: "Google Gemini",
      model: MODEL,
      isExternal: true,
    });
  });

  // The descriptor reaches the workspace, which tells the user which engine
  // produced a result. A base URL can carry a credential in its userinfo or a
  // query parameter, so it must not appear here.
  it("carries no endpoint, so no credential can travel with it", () => {
    const provider = createProvider();

    expect(JSON.stringify(provider.descriptor)).not.toContain("example.invalid");
  });
});

describe("the request it sends", () => {
  it("posts to :generateContent beneath the model path", async () => {
    const fetchMock = captureFetch().mockResolvedValue(reply(generation()));

    await createProvider().generate(REQUEST);

    // The model is a path segment here, unlike `openai`'s body field — the
    // first visible protocol difference.
    expect(firstCall(fetchMock).url).toBe(
      `${ENDPOINT}/models/${MODEL}:generateContent`,
    );
    expect(firstCall(fetchMock).method).toBe("POST");
  });

  it("tolerates a trailing slash on the configured endpoint", async () => {
    const fetchMock = captureFetch().mockResolvedValue(reply(generation()));

    await createGeminiProvider({
      endpoint: `${ENDPOINT}/`,
      model: MODEL,
    }).generate(REQUEST);

    expect(firstCall(fetchMock).url).toBe(
      `${ENDPOINT}/models/${MODEL}:generateContent`,
    );
  });

  // Google's REST documentation writes the model as `models/gemini-2.0-flash`
  // while its SDKs take the bare id. An operator copying from the docs would
  // otherwise get `/models/models/...` and a 404 that names nothing useful.
  it("accepts a model written with the API's own models/ prefix", async () => {
    const fetchMock = captureFetch().mockResolvedValue(reply(generation()));

    await createGeminiProvider({
      endpoint: ENDPOINT,
      model: `models/${MODEL}`,
    }).generate(REQUEST);

    expect(firstCall(fetchMock).url).toBe(
      `${ENDPOINT}/models/${MODEL}:generateContent`,
    );
  });

  it("sends the instruction and the serialised context as the prompt", async () => {
    const fetchMock = captureFetch().mockResolvedValue(reply(generation()));

    await createProvider().generate(REQUEST);

    const contents = firstCall(fetchMock).body.contents as {
      role: string;
      parts: { text: string }[];
    }[];

    expect(contents).toHaveLength(1);
    expect(contents[0]?.role).toBe("user");
    const text = contents[0]?.parts[0]?.text ?? "";
    expect(text).toContain("Decompose the objective.");
    // `provider/provider.ts` requires a real adapter to serialise the context
    // rather than read it as a side channel. An adapter that dropped it would
    // answer a different question than the one the planner asked, and the
    // failure would look like a bad model rather than a bad adapter.
    expect(text).toContain("Count the words in a sentence.");
  });

  it("carries the operation's prompt as the system instruction", async () => {
    const fetchMock = captureFetch().mockResolvedValue(reply(generation()));

    await createProvider().generate(REQUEST);

    const system = firstCall(fetchMock).body.systemInstruction as {
      parts: { text: string }[];
    };

    // The shared prompt from `prompts.ts`, not a Gemini-specific copy — which is
    // the point of extracting it. Both adapters put the same words in front of
    // the model, so a difference in output is a difference in the model.
    expect(system.parts[0]?.text).toContain("planning component of Orion");
  });

  it("asks for JSON only when the caller did", async () => {
    const fetchMock = captureFetch();
    // `mockResolvedValue` would hand the same Response to both calls below, and
    // a body can only be read once — the second call would fail on a spent body
    // rather than on anything this test is about. A fresh one per call.
    fetchMock.mockImplementation(() => Promise.resolve(reply(generation())));

    await createProvider().generate(REQUEST);
    expect(firstCall(fetchMock).body).not.toHaveProperty("generationConfig");

    fetchMock.mockClear();
    await createProvider().generate({ ...REQUEST, responseFormat: "json" });
    expect(firstCall(fetchMock).body.generationConfig).toStrictEqual({
      responseMimeType: "application/json",
    });
  });

  it("passes a token ceiling through", async () => {
    const fetchMock = captureFetch().mockResolvedValue(reply(generation()));

    await createProvider().generate({ ...REQUEST, maxOutputTokens: 256 });

    expect(firstCall(fetchMock).body.generationConfig).toStrictEqual({
      maxOutputTokens: 256,
    });
  });

  it("bounds the call with an abort signal", async () => {
    const fetchMock = captureFetch().mockResolvedValue(reply(generation()));

    await createProvider().generate(REQUEST);

    expect(firstCall(fetchMock).signal).toBeInstanceOf(AbortSignal);
  });
});

describe("the credential", () => {
  it("is sent in a header when one is configured", async () => {
    vi.stubEnv("LLM_API_KEY", FAKE_KEY);
    const fetchMock = captureFetch().mockResolvedValue(reply(generation()));

    await createProvider().generate(REQUEST);

    expect(firstCall(fetchMock).header("x-goog-api-key")).toBe(FAKE_KEY);
  });

  // The reason this whole group exists. Gemini accepts `?key=`, most examples
  // show it, and a URL is copied into proxy logs, access logs and error
  // messages. This test is what stops a future edit from taking the easier form.
  it("never appears in the request URL", async () => {
    vi.stubEnv("LLM_API_KEY", FAKE_KEY);
    const fetchMock = captureFetch().mockResolvedValue(reply(generation()));

    await createProvider().generate(REQUEST);

    expect(firstCall(fetchMock).url).not.toContain(FAKE_KEY);
    expect(firstCall(fetchMock).url).not.toContain("key=");
  });

  it("is omitted entirely when none is configured", async () => {
    vi.stubEnv("LLM_API_KEY", "");
    const fetchMock = captureFetch().mockResolvedValue(reply(generation()));

    await createProvider().generate(REQUEST);

    expect(firstCall(fetchMock).header("x-goog-api-key")).toBeNull();
  });

  // The whole point of `readModelApiKey` living apart from
  // `getModelProviderConfig` is that the secret reaches exactly one destination.
  // If a future edit put it in a message, this fails.
  it("never appears in an error, even when the endpoint rejects it", async () => {
    vi.stubEnv("LLM_API_KEY", FAKE_KEY);
    captureFetch().mockResolvedValue(
      reply(
        { error: { message: "API key not valid", status: "INVALID_ARGUMENT" } },
        { status: 400 },
      ),
    );

    const error = await createProvider()
      .generate(REQUEST)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ModelProviderError);
    expect((error as Error).message).not.toContain(FAKE_KEY);
  });

  it("never appears in a transport failure", async () => {
    vi.stubEnv("LLM_API_KEY", FAKE_KEY);
    captureFetch().mockRejectedValue(new TypeError("fetch failed"));

    const error = await createProvider()
      .generate(REQUEST)
      .catch((thrown: unknown) => thrown);

    expect((error as Error).message).not.toContain(FAKE_KEY);
  });
});

describe("the response it accepts", () => {
  it("returns the candidate text and the model", async () => {
    captureFetch().mockResolvedValue(reply(generation()));

    const response = await createProvider().generate(REQUEST);

    expect(response.text).toBe("the model's answer");
    expect(response.model).toBe(MODEL);
    expect(response.providerId).toBe(GEMINI_STYLE_PROVIDER_ID);
    expect(response.finishReason).toBe("stop");
  });

  // A single answer may be split across parts, so taking only the first would
  // silently return half of one. For a JSON-mode call that is a truncated
  // document rather than a visibly short answer, which is the worse failure.
  it("joins a multi-part answer rather than taking the first part", async () => {
    captureFetch().mockResolvedValue(
      reply({
        candidates: [
          {
            content: { parts: [{ text: "{\"steps\":" }, { text: "[]}" }] },
            finishReason: "STOP",
          },
        ],
      }),
    );

    const response = await createProvider().generate(REQUEST);

    expect(response.text).toBe('{"steps":[]}');
  });

  it("skips parts that carry no text", async () => {
    captureFetch().mockResolvedValue(
      reply({
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: "x" } }, { text: "the answer" }],
            },
            finishReason: "STOP",
          },
        ],
      }),
    );

    const response = await createProvider().generate(REQUEST);

    expect(response.text).toBe("the answer");
  });

  it("reports token usage when the endpoint does", async () => {
    captureFetch().mockResolvedValue(reply(generation()));

    const response = await createProvider().generate(REQUEST);

    expect(response.usage).toStrictEqual({ inputTokens: 11, outputTokens: 22 });
  });

  it("omits usage rather than inventing zeroes", async () => {
    captureFetch().mockResolvedValue(
      reply(generation({ usageMetadata: undefined })),
    );

    const response = await createProvider().generate(REQUEST);

    // The key must be absent, not present-and-undefined: this response is
    // serialised into execution state, and `{ usage: undefined }` and `{}`
    // differ once they have been through JSON.
    expect(Object.hasOwn(response, "usage")).toBe(false);
  });

  it("maps MAX_TOKENS to length", async () => {
    captureFetch().mockResolvedValue(
      reply({
        candidates: [
          { content: { parts: [{ text: "truncated" }] }, finishReason: "MAX_TOKENS" },
        ],
      }),
    );

    const response = await createProvider().generate(REQUEST);

    expect(response.finishReason).toBe("length");
  });

  // A reason this adapter does not recognise has not been shown to mean the
  // answer is complete. Reporting a blocked or filtered response as a clean stop
  // would let it be evaluated as a whole one.
  const unrecognised: (string | undefined)[] = [
    "SAFETY",
    "RECITATION",
    "OTHER",
    "FINISH_REASON_UNSPECIFIED",
    undefined,
  ];

  it.each(unrecognised)(
    "maps the finish reason %s to error, not stop",
    async (finishReason) => {
      captureFetch().mockResolvedValue(
        reply({
          candidates: [
            {
              content: { parts: [{ text: "partial" }] },
              finishReason,
            },
          ],
        }),
      );

      const response = await createProvider().generate(REQUEST);

      expect(response.finishReason).toBe("error");
    },
  );
});

describe("the response it refuses", () => {
  const malformed: [string, unknown][] = [
    ["a body that is not JSON at all", "<html>gateway error</html>"],
    ["a JSON value that is not an object", [1, 2, 3]],
    ["an object with no candidates", { id: "x" }],
    ["an empty candidates array", { candidates: [] }],
    ["a candidate that is not an object", { candidates: ["nope"] }],
    ["a candidate with no content", { candidates: [{ finishReason: "STOP" }] }],
    ["a content with no parts", { candidates: [{ content: {} }] }],
    ["a content with an empty parts array", { candidates: [{ content: { parts: [] } }] }],
    [
      "a part whose text is not a string",
      { candidates: [{ content: { parts: [{ text: { nested: true } }] } }] },
    ],
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

    await expect(createProvider().generate(REQUEST)).rejects.toBeInstanceOf(
      ModelProviderError,
    );
  });

  it("surfaces the upstream message on an HTTP failure", async () => {
    captureFetch().mockResolvedValue(
      reply(
        {
          error: {
            code: 429,
            message: "Quota exceeded",
            status: "RESOURCE_EXHAUSTED",
          },
        },
        { status: 429, statusText: "Too Many Requests" },
      ),
    );

    const error = (await createProvider()
      .generate(REQUEST)
      .catch((thrown: unknown) => thrown)) as Error;

    expect(error.message).toContain("429");
    expect(error.message).toContain("Quota exceeded");
  });

  // An HTML error page from a proxy can be arbitrarily large and can echo the
  // request. Neither belongs in a message that reaches a log or a response.
  it("does not repeat a non-JSON error body", async () => {
    captureFetch().mockResolvedValue(
      new Response("<html>Bad gateway</html>", { status: 502 }),
    );

    const error = (await createProvider()
      .generate(REQUEST)
      .catch((thrown: unknown) => thrown)) as Error;

    expect(error.message).toContain("502");
    expect(error.message).not.toContain("Bad gateway");
  });

  it("reports a timeout as a timeout", async () => {
    const timeout = new Error("aborted");
    timeout.name = "TimeoutError";
    captureFetch().mockRejectedValue(timeout);

    const error = (await createProvider()
      .generate(REQUEST)
      .catch((thrown: unknown) => thrown)) as Error;

    expect(error).toBeInstanceOf(ModelProviderError);
    expect(error.message).toContain(String(DEFAULT_GEMINI_TIMEOUT_MS));
  });

  it("names its provider on every failure", async () => {
    captureFetch().mockRejectedValue(new TypeError("fetch failed"));

    const error = (await createProvider()
      .generate(REQUEST)
      .catch((thrown: unknown) => thrown)) as ModelProviderError;

    expect(error.providerId).toBe(GEMINI_STYLE_PROVIDER_ID);
  });
});
