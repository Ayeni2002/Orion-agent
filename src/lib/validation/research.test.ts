import { describe, expect, it } from "vitest";

import {
  QUESTION_MAX_LENGTH,
  QUESTION_MIN_LENGTH,
  researchRequestSchema,
} from "./research";

/**
 * The request contract, at the boundary a user's text crosses.
 *
 * Two properties matter beyond "the bounds hold".
 *
 * The first is that the schema has exactly one field. §10 requires the run's
 * limits to be explicit and configurable, and they are — through the
 * environment. A request that could carry its own limits would let a client
 * raise a ceiling that exists to bound what a run costs, so the test that asserts
 * an unknown field does not survive is asserting a resource control, not tidiness.
 *
 * The second is that the parsed value is trimmed. The question is echoed into the
 * planner's context, copied onto the request record and restated into every
 * task's query, so whitespace a user did not mean would be amplified into every
 * provider call the run makes.
 */

describe("researchRequestSchema", () => {
  it("accepts a question", () => {
    const parsed = researchRequestSchema.safeParse({
      question: "What did grid-scale battery storage cost between 2019 and 2024?",
    });

    expect(parsed.success).toBe(true);
  });

  it("trims the question", () => {
    const parsed = researchRequestSchema.parse({
      question: "   What did grid-scale storage cost?   ",
    });

    expect(parsed.question).toBe("What did grid-scale storage cost?");
  });

  it("accepts a question at the minimum length", () => {
    expect(
      researchRequestSchema.safeParse({
        question: "a".repeat(QUESTION_MIN_LENGTH),
      }).success,
    ).toBe(true);
  });

  it("refuses a question below the minimum length", () => {
    // A question shorter than a few words cannot be broken into retrieval tasks.
    expect(
      researchRequestSchema.safeParse({
        question: "a".repeat(QUESTION_MIN_LENGTH - 1),
      }).success,
    ).toBe(false);
  });

  it("accepts a question at the maximum length", () => {
    expect(
      researchRequestSchema.safeParse({
        question: "a".repeat(QUESTION_MAX_LENGTH),
      }).success,
    ).toBe(true);
  });

  it("refuses a question above the maximum length", () => {
    expect(
      researchRequestSchema.safeParse({
        question: "a".repeat(QUESTION_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it("measures the length after trimming, not before", () => {
    // Otherwise padding a one-word question with spaces would pass the floor.
    expect(
      researchRequestSchema.safeParse({
        question: `${" ".repeat(50)}short${" ".repeat(50)}`,
      }).success,
    ).toBe(false);
  });

  it("refuses an empty question", () => {
    expect(researchRequestSchema.safeParse({ question: "" }).success).toBe(false);
  });

  it("refuses a whitespace-only question", () => {
    expect(researchRequestSchema.safeParse({ question: "     " }).success).toBe(false);
  });

  it("refuses a request with no question field", () => {
    expect(researchRequestSchema.safeParse({}).success).toBe(false);
  });

  it("refuses a non-string question", () => {
    expect(researchRequestSchema.safeParse({ question: 42 }).success).toBe(false);
    expect(researchRequestSchema.safeParse({ question: null }).success).toBe(false);
    expect(researchRequestSchema.safeParse({ question: ["a question"] }).success).toBe(
      false,
    );
  });

  it("refuses a body that is not an object", () => {
    expect(researchRequestSchema.safeParse("a question").success).toBe(false);
    expect(researchRequestSchema.safeParse(null).success).toBe(false);
    expect(researchRequestSchema.safeParse(undefined).success).toBe(false);
  });

  it("discards a limit supplied by the caller", () => {
    const parsed = researchRequestSchema.parse({
      question: "What did grid-scale storage cost?",
      limits: { maxTasks: 1_000, maxSourcesTotal: 100_000 },
      maxTasks: 1_000,
    });

    // Accepted and dropped rather than rejected: a caller cannot raise a
    // ceiling, and the run's own configuration is the only thing that sets one.
    expect(parsed).toStrictEqual({ question: "What did grid-scale storage cost?" });
  });

  it("discards a plan, a status and a result supplied by the caller", () => {
    // The property that matters most here. Nothing a client sends can assert
    // that research was carried out — a finding is a claim with a URL behind it,
    // and a client able to inject one could manufacture evidence.
    const parsed = researchRequestSchema.parse({
      question: "What did grid-scale storage cost?",
      status: "completed",
      findings: [{ statement: "Costs fell.", basis: "source" }],
      sources: [{ url: "https://example.org/a" }],
      result: { sufficiency: "sufficient" },
    });

    expect(Object.keys(parsed)).toStrictEqual(["question"]);
  });

  it("writes its messages for the person who typed the input", () => {
    const parsed = researchRequestSchema.safeParse({ question: "Why?" });

    expect(parsed.success).toBe(false);

    if (parsed.success) {
      throw new Error("Expected the question to be refused for being too short.");
    }

    expect(parsed.error.issues[0]?.message).toBe(
      `Ask a question of at least ${QUESTION_MIN_LENGTH} characters.`,
    );
  });
});
