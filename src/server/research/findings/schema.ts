import { z } from "zod";

/**
 * Schema for finding extraction, and the check that makes it mean something.
 *
 * §12 of the Phase 5 brief says: do not invent facts that are not supported by
 * retrieved sources. Stating that rule to a model is necessary and nowhere near
 * sufficient — a model asked to summarise sources will produce a fluent,
 * plausible, occasionally invented summary, and asking it to "only use the
 * sources" changes its behaviour without making the output verifiable.
 *
 * So the rule is not enforced by instruction. It is enforced by arithmetic. The
 * model must supply, for every claim it attributes to a source, a *verbatim
 * quote* from that source. `verifyQuote` then checks, character by character,
 * that the quote is actually present in the text that was retrieved. A claim
 * whose quote cannot be found is not rejected — it is **downgraded** to
 * `basis: "model"`, stripped of its evidence, and counted. The finding survives,
 * because a model's unsupported inference can still be worth reading; what does
 * not survive is any suggestion that a source said it.
 *
 * That is the difference between a system that asks a model to be honest and one
 * that can tell when it was not, and it is why this check is mechanical rather
 * than another instruction in the prompt.
 *
 * **What the comparison tolerates, and what it does not.** Whitespace is
 * collapsed, case is ignored, Unicode is NFKC-normalised, and the common
 * typographic variants — curly quotes, en and em dashes, the ellipsis character,
 * the non-breaking space — are folded to their ASCII forms. All of those differ
 * between a page as rendered and a page as retrieved, so treating them as
 * mismatches would downgrade honest quotes for cosmetic reasons.
 *
 * What it does not tolerate is a word changing. An inserted "not", a swapped
 * number, a name replaced with a similar one — each breaks the match, and each
 * is exactly the shape of fabrication this exists to catch.
 */

export const MAX_FINDINGS_PER_TASK = 10;
export const MAX_CONFLICTS_PER_TASK = 10;
export const MAX_GAPS_PER_TASK = 10;
export const FINDING_STATEMENT_MIN_LENGTH = 8;
export const FINDING_STATEMENT_MAX_LENGTH = 500;
export const QUOTE_MIN_LENGTH = 8;
/** Bounded by the search tool's own content cap: a quote cannot exceed its source. */
export const QUOTE_MAX_LENGTH = 1_000;

export const extractedFindingSchema = z.object({
  /** The claim, in one sentence. */
  statement: z
    .string()
    .trim()
    .min(
      FINDING_STATEMENT_MIN_LENGTH,
      `A finding must be at least ${FINDING_STATEMENT_MIN_LENGTH} characters.`,
    )
    .max(
      FINDING_STATEMENT_MAX_LENGTH,
      `A finding must be at most ${FINDING_STATEMENT_MAX_LENGTH} characters.`,
    ),
  /**
   * Which supplied source the quote comes from, by index.
   *
   * An index rather than an id, for the same reason the Phase 3 planner asks for
   * indices: a model cannot know ids the engine has not minted. The sources are
   * numbered in the prompt, and the number is resolved to a real id here.
   */
  sourceIndex: z.number().int().nonnegative().optional(),
  /**
   * The passage from that source, copied exactly.
   *
   * Optional in the schema and required in practice: a finding without a
   * verifiable quote is accepted as a `basis: "model"` finding. Making the field
   * required would turn every unsupported claim into a schema failure and lose
   * the claim, when the useful outcome is to keep it and label it.
   */
  quote: z
    .string()
    .trim()
    .min(QUOTE_MIN_LENGTH)
    .max(QUOTE_MAX_LENGTH)
    .optional(),
});

export const extractedConflictSchema = z.object({
  /** What the disagreement is, in one line. */
  description: z
    .string()
    .trim()
    .min(
      FINDING_STATEMENT_MIN_LENGTH,
      `A conflict must be described in at least ${FINDING_STATEMENT_MIN_LENGTH} characters.`,
    )
    .max(FINDING_STATEMENT_MAX_LENGTH),
  /**
   * The disagreeing findings, by index into this response's own `findings`.
   *
   * Two or more. A conflict with one side is not a conflict, and a conflict with
   * none is an assertion with nothing behind it.
   */
  findingIndices: z
    .array(z.number().int().nonnegative())
    .min(2, "A conflict must name at least two findings.")
    .max(4, "A conflict may name at most four findings."),
});

export const findingsResponseSchema = z.object({
  findings: z.array(extractedFindingSchema).max(MAX_FINDINGS_PER_TASK),
  conflicts: z.array(extractedConflictSchema).max(MAX_CONFLICTS_PER_TASK).optional(),
  /**
   * What the sources did not establish.
   *
   * Recorded rather than filled in. A run that says "the sources do not state
   * the price" is more useful than one that omits the gap, and far more useful
   * than one that closes it from the model's own knowledge. These become
   * observations, so a reader sees the shape of what is missing.
   */
  gaps: z
    .array(z.string().trim().min(FINDING_STATEMENT_MIN_LENGTH).max(FINDING_STATEMENT_MAX_LENGTH))
    .max(MAX_GAPS_PER_TASK)
    .optional(),
});

export type ExtractedFinding = z.infer<typeof extractedFindingSchema>;
export type ExtractedConflict = z.infer<typeof extractedConflictSchema>;
export type FindingsResponse = z.infer<typeof findingsResponseSchema>;

/**
 * Typographic variants folded before comparison.
 *
 * Every one of these is a character a page renders as another character a
 * different page renders literally. Folding them means a quote copied from a
 * typographically-typeset article matches the same sentence retrieved as plain
 * text.
 */
const TYPOGRAPHIC_EQUIVALENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[‘’‚‛′]/g, "'"],
  [/[“”„‟″]/g, '"'],
  [/[‐‑‒–—―]/g, "-"],
  [/…/g, "..."],
  [/ /g, " "],
];

/**
 * Reduces text to the form quotes are compared in.
 *
 * Exported because a test asserting on what does and does not match is clearer
 * when it can name the function it is testing rather than restate its rules.
 */
export function normalizeForComparison(text: string): string {
  let result = text.normalize("NFKC");

  for (const [pattern, replacement] of TYPOGRAPHIC_EQUIVALENTS) {
    result = result.replace(pattern, replacement);
  }

  return result.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Whether a quote genuinely appears in the text it claims to come from.
 *
 * A substring check on normalised text, and nothing more clever than that. It
 * has the property that matters: a fabricated passage does not appear in the
 * source, so it fails, and no amount of fluency changes that.
 */
export function verifyQuote(sourceContent: string, quote: string): boolean {
  const needle = normalizeForComparison(quote);

  if (needle.length === 0) {
    return false;
  }

  return normalizeForComparison(sourceContent).includes(needle);
}
