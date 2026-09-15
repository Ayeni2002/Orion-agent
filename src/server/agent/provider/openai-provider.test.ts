import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createOpenAiCompatibleProvider,
  DEFAULT_MODEL_TIMEOUT_MS,
  OPENAI_STYLE_PROVIDER_ID,
} from "./openai-provider";
import { ModelProviderError, type ModelProviderRequest } from "./provider";

/**
 * The OpenAI-compatible adapter, exercised without a network.
 *
 * `fetch` is stubbed for every test here, and no test reads a real credential.
 * That is not tidiness: `docs/DEVELOPMENT_PHASES.md` requires the suite to run
 * with no API key present at all, which is the only way to know the tests are
 * not quietly relying on one. The key stubbed below is a literal that exists
 * nowhere else, and the assertion that it never appears in an error message is
 * one of the tests.
 *
 * What this file deliberately does not do is assert against OpenRouter's live
 * behaviour. A test that reached the real endpoint would fail on a plane, in
 * CI, and the day someone rotates a key — and it would be testing OpenRouter,
 * not this adapter. The contract asserted here is the one the adapter promises
 * its caller: a request of a particular shape goes out, and every shape of
 * answer that can come back is handled.
 */

const ENDPOINT = "https://example.invalid/api/v1";
const MODEL = "some-vendor/some-model";
const FAKE_KEY = "test-key-not-a-real-credential";

const REQUEST: ModelProviderRequest = {
  operation: "plan",
  instruction: "Decompose the objective.",
  context: { objective: "Count the words in a sentence." },
};

function createProvider() {
  return createOpenAiCompatibleProvider({ endpoint: ENDPOINT, model: MODEL });
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

/** A well-formed completion, which individual tests then spoil. */
function completion(overrides: Record<string, unknown> = {}) {
  return {
    choices: [{ message: { content: "the model's answer" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 11, completion_tokens: 22 },
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
      id: OPENAI_STYLE_PROVIDER_ID,
      label: "OpenAI-compatible endpoint",
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
  it("posts to /chat/completions beneath the base URL", async () => {
    const fetchMock = captureFetch().mockResolvedValue(reply(completion()));

    await createProvider().generate(REQUEST);

    expect(firstCall(fetchMock).url).toBe(`${ENDPOINT}/chat/completions`);
    expect(firstCall(fetchMock).method).toBe("POST");
  });

  it("tolerates a trailing slash on the configured endpoint", async () => {
    const fetchMock = captureFetch().mockResolvedValue(reply(completion()));

    await createOpenAiCompatibleProvider({
      endpoint: `${ENDPOINT}/`,
      model: MODEL,
    }).generate(REQUEST);

    expect(firstCall(fetchMock).url).toBe(`${ENDPOINT}/chat/completions`);
  });

  it("sends the model and the instruction", async () => {
    const fetchMock = captureFetch().mockResolvedValue(reply(completion()));

    await createProvider().generate(REQUEST);

    const body = firstCall(fetchMock).body;
    expect(body.model).toBe(MODEL);

    const messages = body.messages as { role: string; content: string }[];
    expect(messages.at(-1)?.content).toContain("Decompose the objective.");
  });

  // `provider/provider.ts` requires a real adapter to serialise the context
  // rather than read it as a side channel. An adapter that dropped it would
  // answer a different question than the one the planner asked, and the failure
  // would look like a bad model rather than a bad adapter.
  it("serialises the context into the prompt", async () => {
    const fetchMock = captureFetch().mockResolvedValue(reply(completion()));

    await createProvider().generate(REQUEST);

    const messages = firstCall(fetchMock).body.messages as { content: string }[];
    expect(messages.at(-1)?.content).toContain("Count the words in a sentence.");
  });

  it("asks for JSON only when the caller did", async () => {
    const fetchMock = captureFetch();
    // `mockResolvedValue` would hand the same Response to both calls below, and
    // a body can only be read once — the second call would fail on a spent
    // body rather than on anything this test is about. A fresh one per call.
    fetchMock.mockImplementation(() => Promise.resolve(reply(completion())));

    await createProvider().generate(REQUEST);
    expect(firstCall(fetchMock).body).not.toHaveProperty("response_format");

    fetchMock.mockClear();
    await createProvider().generate({ ...REQUEST, responseFormat: "json" });
    expect(firstCall(fetchMock).body.response_format).toStrictEqual({
      type: "json_object",
    });
  });

  it("passes a token ceiling through when one is given", async () => {
    const fetchMock = captureFetch().mockResolvedValue(reply(completion()));

    await createProvider().generate({ ...REQUEST, maxOutputTokens: 256 });

    expect(firstCall(fetchMock).body.max_tokens).toBe(256);
  });

  it("bounds the call with an abort signal", async () => {
    const fetchMock = captureFetch().mockResolvedValue(reply(completion()));

    await createProvider().generate(REQUEST);

    expect(firstCall(fetchMock).signal).toBeInstanceOf(AbortSignal);
  });
});

describe("the credential", () => {
  it("is sent as a bearer token when one is configured", async () => {
    vi.stubEnv("LLM_API_KEY", FAKE_KEY);
    const fetchMock = captureFetch().mockResolvedValue(reply(completion()));

    await createProvider().generate(REQUEST);

    expect(firstCall(fetchMock).header("authorization")).toBe(`Bearer ${FAKE_KEY}`);
  });

  // A local endpoint such as vLLM or LM Studio accepts no header where it
  // rejects a bare `Authorization: Bearer `.
  it("is omitted entirely when none is configured", async () => {
    vi.stubEnv("LLM_API_KEY", "");
    const fetchMock = captureFetch().mockResolvedValue(reply(completion()));

    await createProvider().generate(REQUEST);

    expect(firstCall(fetchMock).header("authorization")).toBeNull();
  });

  // The whole point of `readModelApiKey` living apart from
  // `getModelProviderConfig` is that the secret reaches exactly one
  // destination. If a future edit put it in a message, this fails.
  it("never appears in an error, even when the endpoint rejects it", async () => {
    vi.stubEnv("LLM_API_KEY", FAKE_KEY);
    captureFetch().mockResolvedValue(
      reply({ error: { message: "Invalid credentials" } }, { status: 401 }),
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
  it("returns the message text and the model", async () => {
    captureFetch().mockResolvedValue(reply(completion()));

    const response = await createProvider().generate(REQUEST);

    expect(response.text).toBe("the model's answer");
    expect(response.model).toBe(MODEL);
    expect(response.providerId).toBe(OPENAI_STYLE_PROVIDER_ID);
    expect(response.finishReason).toBe("stop");
  });

  it("reports token usage when the endpoint does", async () => {
    captureFetch().mockResolvedValue(reply(completion()));

    const response = await createProvider().generate(REQUEST);

    expect(response.usage).toStrictEqual({ inputTokens: 11, outputTokens: 22 });
  });

  it("omits usage rather than inventing zeroes", async () => {
    captureFetch().mockResolvedValue(
      reply(completion({ usage: undefined })),
    );

    const response = await createProvider().generate(REQUEST);

    // The key must be absent, not present-and-undefined: this response is
    // serialised into execution state, and `{ usage: undefined }` and `{}`
    // differ once they have been through JSON.
    expect(Object.hasOwn(response, "usage")).toBe(false);
  });

  it("maps a length stop to length", async () => {
    captureFetch().mockResolvedValue(
      reply({
        choices: [{ message: { content: "truncated" }, finish_reason: "length" }],
      }),
    );

    const response = await createProvider().generate(REQUEST);

    expect(response.finishReason).toBe("length");
  });

  // A reason this adapter does not recognise has not been shown to mean the
  // answer is complete. Reporting it as a clean stop would let a filtered or
  // truncated response be evaluated as a whole one.
  it("maps an unrecognised stop reason to error, not stop", async () => {
    captureFetch().mockResolvedValue(
      reply({
        choices: [{ message: { content: "filtered" }, finish_reason: "content_filter" }],
      }),
    );

    const response = await createProvider().generate(REQUEST);

    expect(response.finishReason).toBe("error");
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
    [
      "a message whose content is not a string",
      { choices: [{ message: { content: { nested: true } } }] },
    ],
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

    await expect(createProvider().generate(REQUEST)).rejects.toBeInstanceOf(
      ModelProviderError,
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
      .generate(REQUEST)
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
    expect(error.message).toContain(String(DEFAULT_MODEL_TIMEOUT_MS));
  });

  it("names its provider on every failure", async () => {
    captureFetch().mockRejectedValue(new TypeError("fetch failed"));

    const error = (await createProvider()
      .generate(REQUEST)
      .catch((thrown: unknown) => thrown)) as ModelProviderError;

    expect(error.providerId).toBe(OPENAI_STYLE_PROVIDER_ID);
  });
});
