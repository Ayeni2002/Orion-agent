import { describe, expect, it } from "vitest";

import {
  OBJECTIVE_MAX_LENGTH,
  OBJECTIVE_MIN_LENGTH,
  objectiveSchema,
} from "./objective";

describe("objectiveSchema", () => {
  it("accepts an objective within the length bounds", () => {
    const result = objectiveSchema.safeParse({
      objective: "Compare the leading approaches to grid-scale storage.",
    });

    expect(result.success).toBe(true);
  });

  it("trims surrounding whitespace before reporting the value", () => {
    const result = objectiveSchema.safeParse({
      objective: "   Compare grid-scale storage approaches.   ",
    });

    expect(result.success && result.data.objective).toBe(
      "Compare grid-scale storage approaches.",
    );
  });

  it("rejects an objective shorter than the minimum", () => {
    const result = objectiveSchema.safeParse({
      objective: "a".repeat(OBJECTIVE_MIN_LENGTH - 1),
    });

    expect(result.success).toBe(false);
  });

  it("rejects an objective longer than the maximum", () => {
    const result = objectiveSchema.safeParse({
      objective: "a".repeat(OBJECTIVE_MAX_LENGTH + 1),
    });

    expect(result.success).toBe(false);
  });

  it("rejects whitespace that only reaches the minimum before trimming", () => {
    // Guards the `.trim().min()` order: trimming first means a value made
    // entirely of spaces is measured as empty, not as long enough.
    const result = objectiveSchema.safeParse({
      objective: " ".repeat(OBJECTIVE_MIN_LENGTH),
    });

    expect(result.success).toBe(false);
  });

  it("names the objective as missing rather than reporting the schema's internals", () => {
    // Zod 4 runs the type check before `.min()`, so without an explicit `error`
    // on `z.string()` an absent field reports "expected string, received
    // undefined" — and the workspace renders the validation message to the user,
    // so that string would be shown to them verbatim.
    const absent = objectiveSchema.safeParse({});
    const wrongType = objectiveSchema.safeParse({ objective: 42 });

    expect(absent.success).toBe(false);
    expect(wrongType.success).toBe(false);

    if (absent.success || wrongType.success) {
      throw new Error("Expected both inputs to be refused.");
    }

    expect(absent.error.issues[0]?.message).toBe("An objective is required.");
    expect(wrongType.error.issues[0]?.message).toBe("An objective is required.");
  });
});
