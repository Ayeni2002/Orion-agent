import type { ResearchResult } from "@/types/research";
import type { Report } from "@/types/report";
import { splitSentences } from "@/lib/reports/text";

/**
 * The mechanical checks that keep a report honest.
 *
 * The Phase 5 finding extractor states the principle this file inherits, in the
 * docblock of `research/findings/schema.ts`:
 *
 *   *"Stating that rule to a model is necessary and nowhere near sufficient...
 *   So the rule is not enforced by instruction. It is enforced by arithmetic."*
 *
 * A report has the same problem with more surface. Its prose is fluent, its
 * subject is whatever was researched, and a reader has no way to tell a sentence
 * a source supports from one the model supplied from its own knowledge — unless
 * something checks. Three things are checkable here, and each is a comparison of
 * the output against the input rather than a judgement about meaning:
 *
 *   1. **Every citation resolves.** The model names findings by index into a list
 *      the server built, so an index that is out of range is a reference to
 *      something that does not exist. It is dropped and counted.
 *   2. **Every number is one the model was given.** A statistic that appears in
 *      neither the brief the model read nor a count the server computed was not
 *      retrieved. This is `verifyQuote`'s idea applied to figures, and it is the
 *      only defence against the fabrication §4 names, because a number is
 *      exactly the kind of claim a reader trusts without checking.
 *   3. **The document's own invariants hold.** The objective is the question that
 *      was asked, the conflicts and unresolved questions are the ones that were
 *      recorded, and no citation points at a source that is not in the result.
 *
 * **What is deliberately not attempted.** Whether a sentence *fairly represents*
 * the finding it cites. That is a judgement about meaning, and a mechanical check
 * for it would be a heuristic that fails in both directions — rejecting honest
 * paraphrase, accepting confident misreading. The honest answer is structural
 * instead: the reader is shown the finding's own words and the source's own
 * passage beside the prose, so a misrepresentation is visible rather than
 * undetectable. See `ReportCitation`, and the renderer that puts the two side by
 * side.
 */

/**
 * Numbers that are always permitted, whatever the brief says.
 *
 * Zero and one, and nothing else. They appear in ordinary English — "one of the
 * sources", "no findings", "the first of two" — where they are not claims about
 * the world, and flagging them would train a reader to ignore the flag.
 *
 * The temptation is to widen this to small integers generally, and it is worth
 * recording why not: a fabricated statistic is very often a small one. "The
 * market grew 12% last year" is not made honest by 12 being under twenty, and a
 * check that let it through would be a check that catches only conspicuous
 * fabrications.
 */
const ALWAYS_PERMITTED_NUMBERS: readonly string[] = ["0", "1"];

/**
 * A numeric token, in the forms prose actually uses.
 *
 * Matches thousands separators and decimals; deliberately does not match a bare
 * trailing separator, so "in 2023." yields "2023" rather than "2023." with the
 * sentence's full stop attached. A trailing percent sign or unit is not part of
 * the token, which is what lets "47%", "47 percent" and "47 per cent" compare
 * equal to a source that wrote any of the three.
 */
const NUMBER_PATTERN = /\d[\d,_]*(?:\.\d+)?/g;

/**
 * Reduces a matched token to the form two spellings of one number share.
 *
 * Returns every form the token could legitimately be written in, because the
 * same quantity is spelled several ways and a comparison that did not know that
 * would flag honest prose. "1,200" and "1200" are one number with a thousands
 * separator; "20.0" and "20" are one number with a redundant decimal; "0.47" and
 * "47" are one proportion written two ways, which is common enough in retrieved
 * text ("the share rose to 0.47") that excluding it would generate false flags
 * on exactly the sentences that were most careful.
 */
function numberForms(token: string): string[] {
  const stripped = token.replace(/[,_]/g, "");
  const canonical = stripped.replace(/^0+(?=\d)/, "").replace(/\.0+$/, "");

  const forms = [canonical];

  // A decimal below one, restated as the percentage it equals.
  if (canonical.startsWith("0.")) {
    const scaled = canonical.slice(2).replace(/0+$/, "");
    if (scaled.length > 0) {
      forms.push(scaled);
    }
  }

  return forms;
}

/**
 * Every number a piece of prose could honestly have used.
 *
 * **Read from the brief, not from the corpus.** This is the whole design of the
 * check, and the reason it takes a string rather than a `ResearchResult`. The
 * model is shown one thing: the numbered finding brief the generator built. So
 * the legitimate number set is the set of numbers *in that exact text* — not in
 * the sources behind it, not in the retrieved corpus, not in anything else the
 * server happens to hold.
 *
 * The looser version was tempting and is worth recording as rejected. Grounding
 * on every retrieved source's full text would flag fewer sentences, but for the
 * wrong reason: a model that invented "the figure rose 47%" would pass whenever
 * 47 happened to appear anywhere in a retrieved page, including one it was never
 * shown and no finding cites. The flag would then mean "this number appears
 * somewhere in the corpus", which is not the claim a reader reads it as. Deriving
 * the set from the brief makes the check exact: *was this number in front of the
 * model when it wrote this?*
 *
 * `extraNumbers` carries values the server computed and stated outside the brief
 * — the counts in the instruction line, if any. They are passed explicitly rather
 * than defaulted, so the set cannot silently disagree with what was sent.
 */
export function collectGroundedNumbers(
  brief: string,
  extraNumbers: readonly number[] = [],
): Set<string> {
  const grounded = new Set<string>(ALWAYS_PERMITTED_NUMBERS);

  for (const match of brief.match(NUMBER_PATTERN) ?? []) {
    for (const form of numberForms(match)) {
      grounded.add(form);
    }
  }

  for (const value of extraNumbers) {
    if (Number.isFinite(value)) {
      for (const form of numberForms(String(value))) {
        grounded.add(form);
      }
    }
  }

  return grounded;
}

/**
 * The sentences in a block of prose that state a number the model was not given.
 *
 * Returned as whole sentences rather than as the offending figures, because the
 * flagged sentence is what gets shown to a reader and what has to make sense on
 * its own. Empty when the prose stayed inside its brief, which is the ordinary
 * case and the one worth not cluttering.
 *
 * A flagged sentence is not deleted. It is kept and marked, the same disposition
 * Phase 5 gives an unverifiable quote: the claim survives, its false support does
 * not, and a count is surfaced so nothing is quietly dropped.
 *
 * **The splitter is imported, not written here.** It lives in
 * `@/lib/reports/text`, and the renderer imports the same one. That is not
 * tidiness: what this function returns is a list of sentences, and what the
 * renderer does is find those sentences inside the body to mark them. Two
 * splitters that disagreed about where a sentence ends — on a decimal point, an
 * abbreviation, an ellipsis — would put the mark on the neighbouring sentence,
 * and the result would read as a bug in the report rather than in the splitter.
 */
export function findUngroundedSentences(
  text: string,
  grounded: ReadonlySet<string>,
): string[] {
  const flagged: string[] = [];

  for (const sentence of splitSentences(text)) {
    const numbers = sentence.match(NUMBER_PATTERN) ?? [];

    const ungrounded = numbers.some((token) =>
      numberForms(token).every((form) => !grounded.has(form)),
    );

    if (ungrounded) {
      flagged.push(sentence);
    }
  }

  return flagged;
}

export interface CitationResolution {
  /** The findings the indices named that actually exist, in the order given. */
  findings: ResearchResult["findings"];
  /** Indices that resolved to nothing. Counted, never silently ignored. */
  droppedCount: number;
}

/**
 * Turns the indices a model cited into findings that exist.
 *
 * The point of the whole index device. The model never names a finding by id,
 * because it cannot know ids the engine has not minted; it names a position in
 * the numbered list it was given. Resolving that against the same list is what
 * makes "the model cited a source that was not retrieved" unrepresentable rather
 * than merely forbidden — an index with nothing behind it produces no citation,
 * and there is no field through which a title, a URL or a passage could have
 * been supplied instead.
 *
 * Duplicates are collapsed: a model that cites the same finding twice in one
 * section has cited one finding, and counting it twice would overstate how much
 * the section rests on.
 */
export function resolveFindingIndices(
  indices: readonly number[],
  findings: ResearchResult["findings"],
): CitationResolution {
  const resolved: ResearchResult["findings"] = [];
  const seen = new Set<string>();
  let droppedCount = 0;

  for (const index of indices) {
    const finding = findings[index];

    if (finding === undefined) {
      droppedCount += 1;
      continue;
    }

    if (seen.has(finding.id)) {
      continue;
    }

    seen.add(finding.id);
    resolved.push(finding);
  }

  return { findings: resolved, droppedCount };
}

/**
 * Whether an assembled report still describes the research it was built from.
 *
 * The last line of defence, run on the finished document rather than on the
 * model's output, because it is a statement about the report as a whole: §14 of
 * the brief requires the objective to be the one that was researched, the
 * conflicts to be preserved, the unresolved questions to be preserved, and no
 * citation to point at a source that is not in the result.
 *
 * Returns the violations rather than a boolean so a caller can record *what* was
 * wrong. An empty array is the only pass, and every check is an equality or a
 * membership test — nothing here inspects prose.
 */
export function verifyReportInvariants(
  report: Report,
  result: ResearchResult,
): string[] {
  const violations: string[] = [];

  if (report.title.trim().length === 0) {
    violations.push("The report has no title.");
  }

  if (report.objective !== result.question) {
    violations.push(
      "The report's objective is not the question the research run asked.",
    );
  }

  if (report.sections.length === 0) {
    violations.push("The report has no sections.");
  }

  const findingIds = new Set(result.findings.map((finding) => finding.id));
  const sourcesById = new Map(result.sources.map((source) => [source.id, source]));

  for (const citation of report.citations) {
    if (!findingIds.has(citation.findingId)) {
      violations.push(
        `A citation names finding "${citation.findingId}", which is not in the research result.`,
      );
    }

    if (citation.sourceId === undefined) {
      continue;
    }

    const source = sourcesById.get(citation.sourceId);

    if (source === undefined) {
      violations.push(
        `A citation names source "${citation.sourceId}", which was not retrieved.`,
      );
      continue;
    }

    // The URL is the strongest check available: it is the one field a reader
    // might follow, and the one a fabrication would most want to supply. It must
    // be the URL of the source the citation names, character for character.
    if (citation.url !== source.url) {
      violations.push(
        `A citation's URL does not match the source "${citation.sourceId}" it names.`,
      );
    }
  }

  const sourcesInReport = new Set(report.sources.map((source) => source.id));

  for (const source of result.sources) {
    if (!sourcesInReport.has(source.id)) {
      violations.push(
        `The report omits source "${source.id}", which the research retrieved.`,
      );
    }
  }

  if (report.conflicts.length !== result.conflicts.length) {
    violations.push(
      `The report carries ${report.conflicts.length} conflict(s) where the research recorded ${result.conflicts.length}.`,
    );
  }

  if (report.unresolvedQuestions.length !== result.unresolvedQuestions.length) {
    violations.push(
      `The report carries ${report.unresolvedQuestions.length} unresolved question(s) where the research recorded ${result.unresolvedQuestions.length}.`,
    );
  }

  return violations;
}
