import type {
  ModelOperation,
  ModelProvider,
  ModelProviderDescriptor,
  ModelProviderRequest,
  ModelProviderResponse,
} from "./provider";

/**
 * A scripted provider, for tests.
 *
 * Two reasons this exists rather than tests mocking `generate` directly.
 *
 * First, it makes the tests honest about what they cover. A test that drives
 * the real planner, executor and evaluator against scripted model output is
 * testing the engine; a test that mocks the planner is testing the mock.
 *
 * Second, it is the proof that the provider seam is real. `ModelProvider` has
 * two independent implementations — the deterministic development adapter and
 * this one — and neither the planner, the executor nor the evaluator knows
 * which it is talking to. That is what "not hard-coded to a single provider"
 * means in practice.
 *
 * It is NOT wired into `resolveModelProvider` and must not be. It never
 * contacts anything, and its responses are exactly what a test asked for —
 * which is precisely what makes it useless as a way to produce a real answer.
 */

/** What a scripted handler returns: an object to be JSON-encoded, or raw text. */
export type StubResponse = Record<string, unknown> | string;

export interface StubProviderScript {
  plan?: (context: Record<string, unknown>) => StubResponse;
  execute_step?: (context: Record<string, unknown>) => StubResponse;
  evaluate?: (context: Record<string, unknown>) => StubResponse;
  research_plan?: (context: Record<string, unknown>) => StubResponse;
  research_findings?: (context: Record<string, unknown>) => StubResponse;
  report?: (context: Record<string, unknown>) => StubResponse;
}

export interface StubProviderOptions {
  script: StubProviderScript;
  /** Defaults to a non-external identity, so a test never implies real inference. */
  descriptor?: Partial<ModelProviderDescriptor>;
  /** Number of times `generate` was called, by operation. */
  calls?: Record<ModelOperation, number>;
}

/**
 * Builds a plan object for a list of step descriptions.
 *
 * Chains each step to the one before it, which is the shape most executor tests
 * want. Tests that need a different dependency graph should build the plan
 * themselves.
 */
export function scriptedPlan(
  descriptions: string[],
): Record<string, unknown> {
  return {
    steps: descriptions.map((description, index) => ({
      description,
      expectedOutput: `Output for step ${index + 1}.`,
      ...(index === 0 ? {} : { dependsOn: [index - 1] }),
    })),
  };
}

/**
 * Builds a research plan object for a list of questions.
 *
 * The Phase 5 counterpart of `scriptedPlan`, and it derives each task's `query`
 * from the question it is paired with. Tests that need a query which does not
 * resemble its question — to prove the two are genuinely separate fields —
 * should build the plan themselves.
 */
export function scriptedResearchPlan(
  questions: string[],
): Record<string, unknown> {
  return {
    restatement: `Establish: ${questions.join("; ")}`,
    tasks: questions.map((question) => ({
      question,
      query: question,
    })),
  };
}

export function createStubModelProvider({
  script,
  descriptor,
  calls,
}: StubProviderOptions): ModelProvider {
  const recorded = calls ?? {
    plan: 0,
    execute_step: 0,
    evaluate: 0,
    research_plan: 0,
    research_findings: 0,
    report: 0,
  };

  function respond(request: ModelProviderRequest): ModelProviderResponse {
    const handler = script[request.operation];

    if (handler === undefined) {
      throw new Error(
        `The stub provider was not scripted for the "${request.operation}" operation.`,
      );
    }

    const result = handler(request.context);

    return {
      text: typeof result === "string" ? result : JSON.stringify(result),
      providerId: "stub",
      model: "stub-model",
      finishReason: "stop",
    };
  }

  return {
    descriptor: {
      id: "stub",
      label: "Scripted test provider",
      model: "stub-model",
      isExternal: false,
      ...descriptor,
    },
    generate: (request) => {
      recorded[request.operation] += 1;
      return Promise.resolve(respond(request));
    },
  };
}
