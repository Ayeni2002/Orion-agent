import { z } from "zod";

import { defineTool } from "../definition";

/**
 * Text analysis — Orion's first real tool.
 *
 * WHAT THIS IS: a deterministic, read-only measurement of a block of text.
 * Given the same text it returns the same four numbers, every time, on any
 * machine, with no network call, no API key and no model. That is what makes it
 * a genuine executable tool while every external dependency stays out of the
 * build.
 *
 * WHAT THIS IS NOT: natural-language understanding. It is not an LLM, it is not
 * a summariser, and it is emphatically not a search tool. The counts are
 * produced by the rules documented below, and the description says so plainly
 * so the result is never read as more than it is.
 *
 * The counting rules are deliberately simple and fully specified, because a
 * measurement whose definition is vague is a measurement that cannot be
 * trusted:
 *
 *   characters  the length of the text exactly as supplied, including
 *               whitespace and punctuation, in UTF-16 code units
 *   words       runs of non-whitespace, so hyphenated and slashed forms count
 *               as one word and "don't" counts as one
 *   sentences   the text split at each run of terminal punctuation
 *               (`.`, `!`, `?`, `…`) that is followed by whitespace or the end
 *               of the text, counting only non-blank results
 *   paragraphs  the text split on a blank line — two or more line breaks with
 *               only whitespace between them — counting only non-blank results
 *
 * The sentence rule is the one worth being honest about. It counts terminal
 * punctuation; it does not resolve abbreviation, so "Dr. Smith arrived." counts
 * as two. Every such case is a known consequence of the rule above rather than
 * a bug, and stating the rule is what lets a reader check the number instead of
 * having to trust it.
 */

export const TEXT_ANALYSIS_TOOL_ID = "text.analyze";
export const TEXT_ANALYSIS_TOOL_VERSION = "1.0.0";

/**
 * Longest input accepted.
 *
 * A bound rather than an unbounded pass over whatever arrives: the input comes
 * from a model, and a response bodies' worth of text would be copied into the
 * execution state as a tool output. Generous enough that no realistic block of
 * prose hits it.
 */
export const MAX_ANALYSIS_CHARACTERS = 50_000;

export const textAnalysisInputSchema = z.object({
  text: z
    .string()
    .max(
      MAX_ANALYSIS_CHARACTERS,
      `Text must be at most ${MAX_ANALYSIS_CHARACTERS} characters.`,
    ),
  // Deliberately NOT trimmed and NOT required to be non-empty. The counts
  // describe the text that was actually given, so trimming it first would make
  // `characters` disagree with the input; and empty text is a valid question
  // with a correct answer of zero, not a validation failure.
});

export type TextAnalysisInput = z.infer<typeof textAnalysisInputSchema>;

/**
 * A `type` rather than an `interface`, and that is load-bearing: TypeScript
 * gives an object type alias an implicit index signature but withholds one from
 * an interface, so only this form is assignable to the `ToolOutput` a tool must
 * return. Declaring it as an interface compiles the tool but fails at the
 * `defineTool` call.
 */
export type TextAnalysisOutput = {
  characters: number;
  words: number;
  sentences: number;
  paragraphs: number;
};

function countWords(text: string): number {
  const trimmed = text.trim();

  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

function countSentences(text: string): number {
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    return 0;
  }

  // A lookahead rather than a consuming match, so the whitespace that follows a
  // terminator stays with the next segment instead of being eaten by the
  // separator. `…` is included because it terminates a sentence in practice and
  // excluding it would silently undercount.
  return trimmed
    .split(/[.!?…]+(?=\s|$)/)
    .filter((segment) => segment.trim().length > 0).length;
}

function countParagraphs(text: string): number {
  return text
    .split(/\n\s*\n/)
    .filter((paragraph) => paragraph.trim().length > 0).length;
}

export const textAnalysisTool = defineTool({
  id: TEXT_ANALYSIS_TOOL_ID,
  name: "Text analysis",
  description:
    "Counts characters, words, sentences and paragraphs in a block of text. " +
    "Deterministic and read-only: it measures the text it is given and " +
    "retrieves nothing.",
  version: TEXT_ANALYSIS_TOOL_VERSION,
  // Reads the input it was handed and nothing else. No network, no storage.
  capabilities: ["read_only"],
  inputSchema: textAnalysisInputSchema,
  execute: (input: TextAnalysisInput): Promise<TextAnalysisOutput> => {
    return Promise.resolve({
      characters: input.text.length,
      words: countWords(input.text),
      sentences: countSentences(input.text),
      paragraphs: countParagraphs(input.text),
    });
  },
});
