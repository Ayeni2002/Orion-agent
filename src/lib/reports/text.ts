/**
 * Sentence handling, shared by the generator's checks and the report renderer.
 *
 * It lives here, in `src/lib`, rather than beside either of them because both
 * need it and the two must agree. The generator marks the sentences in a section
 * that stated a figure nothing supports; the renderer shows that section with
 * those sentences marked. If the two split prose even slightly differently, the
 * mark lands on the wrong sentence — which is a defect that reads as a bug in the
 * report rather than in the splitter, and one nothing would catch, because both
 * halves would still work.
 *
 * `src/lib` is where it belongs for a second reason: the renderer runs in the
 * client bundle, and a shared text utility imported from `src/server` would drag
 * the report subsystem's server modules in with it.
 */

/**
 * Splits prose into sentences, for flagging at a readable granularity.
 *
 * A sentence is the unit a reader can act on: marking a whole paragraph because
 * one clause carried an unsupported figure would be both imprecise and easy to
 * dismiss. The split is deliberately naive — a full stop, question mark or
 * exclamation mark followed by whitespace — because it only has to be
 * fine-grained enough to be useful, and a cleverer splitter introduces its own
 * failures on abbreviations, decimals and initials, which are common in exactly
 * the prose a report contains.
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/** A run of prose, and whether it is one of the sentences that was flagged. */
export interface ProseSegment {
  text: string;
  flagged: boolean;
}

/**
 * Splits prose into segments, marking the ones that were flagged.
 *
 * The renderer's need, and the reason this is not just `splitSentences` mapped
 * over a set: the flagged sentences must be found *within* the body in their
 * original positions and spacing, not matched against it. Comparing strings
 * would be a second, subtly different equality test — the one place a mark could
 * silently land on the wrong sentence — so the body is split once and each piece
 * is checked against the flagged list by the same equality the generator used to
 * produce it.
 *
 * Returns the whole text as a single unflagged segment when nothing was flagged,
 * so the ordinary case renders as one paragraph rather than as a run of spans.
 * That also means the caller can rejoin the segments with a single space and get
 * the original text back whenever nothing was marked.
 */
export function splitAroundFlagged(
  text: string,
  flagged: readonly string[],
): ProseSegment[] {
  if (flagged.length === 0) {
    return [{ text, flagged: false }];
  }

  const marked = new Set(flagged);

  return splitSentences(text).map((sentence) => ({
    text: sentence,
    flagged: marked.has(sentence),
  }));
}
