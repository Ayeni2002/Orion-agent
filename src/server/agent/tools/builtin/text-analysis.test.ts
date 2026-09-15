import { describe, expect, it } from "vitest";

import { ToolExecutor } from "../executor";
import { createToolRegistry } from "../registry";
import {
  MAX_ANALYSIS_CHARACTERS,
  textAnalysisInputSchema,
  textAnalysisTool,
  TEXT_ANALYSIS_TOOL_ID,
  TEXT_ANALYSIS_TOOL_VERSION,
} from "./text-analysis";

/**
 * `One two. Three.` then a blank line then `Four.`
 *
 * Chosen so every count is checkable by eye: 2 paragraphs, 3 sentences, 4
 * words, and a character total that includes the blank-line break.
 */
const SAMPLE = "One two. Three.\n\nFour.";

const SAMPLE_COUNTS = {
  characters: 22,
  words: 4,
  sentences: 3,
  paragraphs: 2,
};

function analyse(text: string) {
  const parsed = textAnalysisInputSchema.parse({ text });

  return textAnalysisTool.execute(parsed, {
    executionId: "exec_test",
    taskId: "task_test",
    stepId: "step_test",
    toolId: TEXT_ANALYSIS_TOOL_ID,
    objective: "Measure the text.",
    startedAt: new Date().toISOString(),
    grantedCapabilities: ["read_only"],
  });
}

describe("textAnalysisTool", () => {
  it("declares itself as read-only and versioned", () => {
    expect(textAnalysisTool.id).toBe(TEXT_ANALYSIS_TOOL_ID);
    expect(textAnalysisTool.version).toBe(TEXT_ANALYSIS_TOOL_VERSION);
    expect([...textAnalysisTool.capabilities]).toStrictEqual(["read_only"]);
  });

  it("counts a normal block of text", async () => {
    await expect(analyse(SAMPLE)).resolves.toStrictEqual(SAMPLE_COUNTS);
  });

  it("returns zeros for empty text rather than failing", async () => {
    await expect(analyse("")).resolves.toStrictEqual({
      characters: 0,
      words: 0,
      sentences: 0,
      paragraphs: 0,
    });
  });

  it("counts characters, but no words, in whitespace-only text", async () => {
    await expect(analyse("   \n\n  ")).resolves.toStrictEqual({
      characters: 7,
      words: 0,
      sentences: 0,
      paragraphs: 0,
    });
  });

  it("counts the text exactly as supplied, without trimming it", async () => {
    const padded = await analyse(`  ${SAMPLE}  `);

    // The counts describe the input, so surrounding whitespace must be included
    // in `characters` while leaving the other counts unchanged.
    expect(padded.characters).toBe(SAMPLE_COUNTS.characters + 4);
    expect(padded.words).toBe(SAMPLE_COUNTS.words);
    expect(padded.paragraphs).toBe(SAMPLE_COUNTS.paragraphs);
  });

  it("counts several paragraphs separated by blank lines", async () => {
    const result = await analyse("First.\n\nSecond.\n\n\n\nThird.");

    expect(result.paragraphs).toBe(3);
    expect(result.sentences).toBe(3);
  });

  it("treats a single line break as one paragraph, not two", async () => {
    const result = await analyse("First line\nsecond line");

    expect(result.paragraphs).toBe(1);
    expect(result.words).toBe(4);
  });

  it("counts sentences by terminal punctuation", async () => {
    await expect(analyse("One. Two! Three?")).resolves.toMatchObject({
      sentences: 3,
    });
  });

  it("counts a sentence with no terminal punctuation as one", async () => {
    await expect(analyse("No terminator here")).resolves.toMatchObject({
      sentences: 1,
    });
  });

  it("collapses a run of terminators into one sentence break", async () => {
    await expect(analyse("Really?! Yes.")).resolves.toMatchObject({
      sentences: 2,
    });
  });

  it("counts an abbreviation as two sentences, as the documented rule says", async () => {
    // Not a bug and not a claim of linguistic accuracy: the rule counts
    // terminal punctuation, and this is what that rule produces. Asserting it
    // keeps the tool honest about what it measures.
    await expect(analyse("Dr. Smith arrived.")).resolves.toMatchObject({
      sentences: 2,
    });
  });

  it("counts hyphenated and apostrophised forms as single words", async () => {
    await expect(analyse("A well-known don't")).resolves.toMatchObject({
      words: 3,
    });
  });

  it("is deterministic", async () => {
    const [first, second] = await Promise.all([analyse(SAMPLE), analyse(SAMPLE)]);

    expect(second).toStrictEqual(first);
  });

  it("accepts text at the size limit and rejects anything longer", () => {
    expect(
      textAnalysisInputSchema.safeParse({
        text: "x".repeat(MAX_ANALYSIS_CHARACTERS),
      }).success,
    ).toBe(true);

    expect(
      textAnalysisInputSchema.safeParse({
        text: "x".repeat(MAX_ANALYSIS_CHARACTERS + 1),
      }).success,
    ).toBe(false);
  });

  it("rejects input that is not a string", () => {
    expect(textAnalysisInputSchema.safeParse({ text: 42 }).success).toBe(false);
    expect(textAnalysisInputSchema.safeParse({}).success).toBe(false);
    expect(textAnalysisInputSchema.safeParse({ text: SAMPLE, extra: 1 }).success).toBe(
      true,
    );
  });

  it("runs through the ToolExecutor, which is the only sanctioned path", async () => {
    const registry = createToolRegistry();
    registry.register(textAnalysisTool);

    const receipt = await new ToolExecutor(registry).execute({
      toolId: TEXT_ANALYSIS_TOOL_ID,
      // Untrusted input, exactly as a planner would propose it.
      input: { text: SAMPLE },
      executionId: "exec_test",
      taskId: "task_test",
      stepId: "step_test",
      objective: "Measure the text.",
    });

    expect(receipt.status).toBe("succeeded");
    expect(receipt.toolVersion).toBe(TEXT_ANALYSIS_TOOL_VERSION);
    expect(receipt.output).toStrictEqual(SAMPLE_COUNTS);
  });
});
