import type {
  ResearchRecord,
  ResearchResult,
  ResearchSource,
} from "@/types/research";
import type {
  Report,
  ReportCitation,
  ReportSection,
  ReportSource,
} from "@/types/report";
import { createId, now } from "@/server/agent/ids";

/**
 * The report builder that needs no model.
 *
 * Two jobs, and they are the same code. It is §15's deterministic fallback —
 * what a report generation produces when no provider is configured, when the
 * provider throws, or when the provider's output fails validation — and it is
 * the server-authored half of *every* report, including one a model wrote the
 * prose for. There is no second path: `generator.ts` calls into
 * `buildServerSections` and appends the model's prose, so a report generated
 * with a model and a report generated without one cannot disagree about what the
 * research found. That is the property §15 is really asking for. A fallback
 * implemented separately would be a second opinion about the evidence, and the
 * first time the two drifted, one of them would be wrong.
 *
 * **What it will not do.** It does not summarise, rank, interpret or draw a
 * conclusion. Every string below is either copied from the research record or
 * assembled from values already on it. A finding's statement is the finding's
 * statement, verbatim; a quote is the passage Phase 5 verified; a URL is the
 * source's URL. The only place it composes a sentence is the next-steps section,
 * and there it does no more than restate a question the research recorded as
 * open — see `buildNextSteps`.
 *
 * That restraint is what makes it an honest answer rather than a degraded one. A
 * report built this way is shorter than a model's, reads less smoothly, and says
 * nothing a reader could not have learned from the record — which is exactly the
 * standard §4 sets for every sentence in a report.
 */

/** Longest title before the question is truncated at a word boundary. */
export const MAX_REPORT_TITLE_LENGTH = 90;

/** Ceiling on the deterministic next-steps list, matching the model's bound. */
export const MAX_DERIVED_NEXT_STEPS = 6;

const TRUNCATION_MARKER = "…";

/**
 * The document's title.
 *
 * Derived from the question, and only by trimming. A model that writes the title
 * can write a title the research does not support — "The 2024 Market Collapse",
 * say, for a run that established nothing of the kind — and §14 checks the
 * *objective* against the record rather than the title precisely because one of
 * the two has to be free to be readable. So the readable one is derived
 * mechanically instead, and the checkable one is copied.
 *
 * A question short enough to be a title is used as it stands, question mark and
 * all, because it is the user's own words and there is no reason to improve
 * them. A longer one is cut at a word boundary rather than mid-word, and the
 * cut is marked, because a silently truncated question reads as the whole
 * question.
 */
export function deriveTitle(question: string): string {
  const collapsed = question.replace(/\s+/g, " ").trim();

  if (collapsed.length === 0) {
    return "Research report";
  }

  if (collapsed.length <= MAX_REPORT_TITLE_LENGTH) {
    return collapsed;
  }

  const available = MAX_REPORT_TITLE_LENGTH - TRUNCATION_MARKER.length;
  const cut = collapsed.slice(0, available);
  const lastSpace = cut.lastIndexOf(" ");

  // Only honour a word boundary that leaves most of the text standing; a
  // question with one very long word in it should still use the room it has.
  const body = lastSpace > available / 2 ? cut.slice(0, lastSpace) : cut;

  return `${body.trimEnd()}${TRUNCATION_MARKER}`;
}

/**
 * A source as a report carries it: everything but the retrieved body text.
 *
 * `content` is dropped for the reason `ReportSource` gives — a report renders
 * the verified quotes on its citations, never a source's whole text, and copying
 * every retrieved page into every report would multiply the document's size for
 * material no reader asked to see.
 */
export function toReportSources(
  sources: readonly ResearchSource[],
): ReportSource[] {
  return sources.map((source) => {
    const { content: _content, ...rest } = source;
    return rest;
  });
}

/**
 * The flat chain §4 requires: statement → finding → passage → source → URL.
 *
 * One record per (finding, source) branch, because a finding may rest on several
 * sources and a chain with one hop that fans out needs a record per branch to
 * stay walkable. A finding with `basis: "model"` — one the extractor could not
 * tie to retrieved text — produces exactly one citation carrying its statement
 * and its basis and no source at all. That is not a gap in the data; it is the
 * finding saying what it is, and the renderer shows it as an unsupported claim
 * rather than dressing it in a link it does not have.
 *
 * `quote` is taken from `ResearchEvidence`, never composed. Phase 5 already
 * checked that passage against the retrieved text with `verifyQuote` and
 * downgraded any finding whose quote was not found in it, so a quote reaching
 * this function has been verified once and is not re-checked here — a second
 * check against the same text would be the same arithmetic with more places to
 * go wrong.
 */
export function buildCitations(result: ResearchResult): ReportCitation[] {
  const sourcesById = new Map(result.sources.map((source) => [source.id, source]));
  const citations: ReportCitation[] = [];

  for (const finding of result.findings) {
    if (finding.sourceIds.length === 0) {
      citations.push({
        findingId: finding.id,
        statement: finding.statement,
        basis: finding.basis,
      });
      continue;
    }

    for (const sourceId of finding.sourceIds) {
      const source = sourcesById.get(sourceId);

      // A finding naming a source the result does not contain is a broken chain,
      // and the honest response is to drop the branch rather than emit a
      // citation with a dangling id. Phase 5's extractor resolves source ids
      // against the same result, so this is a guard rather than an expectation.
      if (source === undefined) {
        continue;
      }

      const evidence = result.evidence.find(
        (record) =>
          record.findingId === finding.id && record.sourceId === sourceId,
      );

      citations.push({
        findingId: finding.id,
        statement: finding.statement,
        basis: finding.basis,
        ...(evidence === undefined ? {} : { quote: evidence.quote }),
        sourceId: source.id,
        url: source.url,
        domain: source.domain,
        ...(source.title === undefined ? {} : { sourceTitle: source.title }),
        retrievedAt: source.retrievedAt,
      });
    }
  }

  return citations;
}

/**
 * Next steps, derived rather than suggested.
 *
 * This is the one section the deterministic path composes itself, so it is worth
 * being exact about what it is allowed to say. It restates two things the record
 * already contains:
 *
 *   - a question the extractor reported as *not established* by the sources it
 *     read, which is a thing a further run could look up;
 *   - a limit the run reached, which is a boundary a further run could be given
 *     more room to cross.
 *
 * Both are facts about the run, so a step derived from one is a statement about
 * what is missing rather than a recommendation about what to do. It will not
 * propose a course of action, name a party, estimate a cost or suggest a
 * decision, because every one of those would be Orion's own opinion wearing the
 * clothes of a finding — the fabrication §4 names, in the section where it would
 * be least expected and most persuasive.
 *
 * **Why a gap is restated behind a label rather than folded into a sentence.**
 * The obvious phrasing is `Establish whether <gap>`, and it is wrong, because
 * `gaps` has no guaranteed grammatical form. The extractor asks the model for
 * "anything the question asks that these sources do not establish", and that
 * arrives as a noun clause ("whether the cost decline continues through 2027"), a
 * question ("what the 2024 price was") or a full sentence ("the sources do not
 * state the price"). Prefixing produced "Establish whether whether the cost
 * decline continues" for the first, an ungrammatical step for the second, and —
 * worst — "Establish whether the sources do not state the price" for the third,
 * which says the opposite of what was recorded. Any frame that makes a sentence
 * *about* text whose shape is unknown will be wrong for some input.
 *
 * So the gap is carried as what it is: the run's own words, behind a label that is
 * true of all three forms. Nothing is claimed about the gap; it is reported.
 */
export function buildNextSteps(result: ResearchResult): string[] {
  const steps: string[] = [];

  for (const question of result.unresolvedQuestions) {
    if (steps.length >= MAX_DERIVED_NEXT_STEPS) {
      break;
    }

    steps.push(`The run did not establish: ${lowerFirst(question)}`);
  }

  for (const kind of result.limitsReached) {
    if (steps.length >= MAX_DERIVED_NEXT_STEPS) {
      break;
    }

    steps.push(`${describeLimit(kind)} Re-running with a higher limit would establish more.`);
  }

  return steps;
}

/**
 * The limit's name, in words rather than as an enum member.
 *
 * An exhaustive switch with no `default`, so adding a member to
 * `ResearchLimitKind` is a compile error here rather than a step reading
 * "max_sources_total" in a document meant for a person.
 */
function describeLimit(kind: ResearchResult["limitsReached"][number]): string {
  switch (kind) {
    case "max_tasks":
      return "This run was limited in how many sub-questions it could pursue.";
    case "max_sources_per_task":
      return "This run was limited in how many sources it could read per sub-question.";
    case "max_sources_total":
      return "This run was limited in how many sources it could read in total.";
    case "max_findings":
      return "This run was limited in how many findings it could record.";
    case "max_duration":
      return "This run was stopped at its time limit.";
  }
}

/**
 * Lowercases a gap's opening word so it sits after a colon.
 *
 * Only the first character, and only when the opening word is not an acronym or
 * a proper noun — "GDP grew" must not become "gDP grew". The test is whether the
 * word has any lowercase letter to be confused about, which is crude on purpose:
 * the cost of being wrong is a capital letter in an odd place, and the cost of a
 * cleverer rule is a sentence that no longer reads as the thing it was copied
 * from.
 *
 * The trailing punctuation is left alone. The gap is quoted rather than joined
 * into a sentence, so a full stop at the end of it is the gap's own and removing
 * it would be editing text the run recorded.
 */
function lowerFirst(text: string): string {
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    return trimmed;
  }

  const [word = ""] = trimmed.split(/\s/, 1);

  if (!/[a-z]/.test(word)) {
    return trimmed;
  }

  return `${trimmed[0]?.toLowerCase() ?? ""}${trimmed.slice(1)}`;
}

/**
 * The sections built from the record, in document order.
 *
 * These are the evidence-bearing half of every report, and no model contributes
 * to any of them. Two of them are conditional and one is not:
 *
 *   - **Conflicts** are omitted when there were none. §3's rule — do not
 *     hard-code a section when there is no information for it — matters most
 *     here, because a "Conflicting information: none" heading in a report about a
 *     question nobody disputed reads as a claim that the question was contested
 *     and settled.
 *   - **Unresolved questions** are omitted on the same reasoning, and the section
 *     also carries the limits the run reached, because "we did not establish
 *     this" and "we stopped before we could" are the same thing to a reader.
 *   - **Sources and evidence** is present whenever anything was retrieved, which
 *     is not the same as being present whenever anything was found. A run that
 *     read six pages and concluded nothing is a real outcome, and it is the one
 *     where the sources matter most.
 */
export function buildServerSections({
  result,
  restatement,
  skip,
}: {
  result: ResearchResult;
  /** The planner's reading of the question, when it differed enough to keep. */
  restatement?: string;
  /**
   * Kinds the caller is supplying itself, so this does not duplicate them.
   *
   * The list is exactly the two server-derived sections a model may also write:
   * the executive summary, which falls back to `result.summary`, and the next
   * steps, which fall back to the questions the run left open. Typed as those two
   * rather than as every `ReportSectionKind`, because the other kinds have no
   * model counterpart and offering to skip them would be offering something this
   * function does not do.
   *
   * Without it a report would carry two of each — the model's and the derived
   * one — and a reader would find the document contradicting its own structure.
   */
  skip?: readonly ("summary" | "next_steps")[];
}): ReportSection[] {
  const sections: ReportSection[] = [];
  const omitted = new Set<string>(skip ?? []);

  const want = (kind: string): boolean => !omitted.has(kind);

  sections.push({
    id: createId("rsec"),
    kind: "objective",
    heading: "Research objective",
    origin: "research",
    findingIds: [],
    ...(restatement === undefined ? {} : { body: restatement }),
  });

  if (
    want("summary") &&
    result.summary !== undefined &&
    result.summary.trim().length > 0
  ) {
    sections.push({
      id: createId("rsec"),
      kind: "summary",
      heading: "Executive summary",
      origin: "research",
      body: result.summary,
      findingIds: result.findings.map((finding) => finding.id),
    });
  }

  if (result.findings.length > 0) {
    sections.push({
      id: createId("rsec"),
      kind: "findings",
      heading: "Key findings",
      origin: "research",
      findingIds: result.findings.map((finding) => finding.id),
    });
  }

  if (result.sources.length > 0) {
    sections.push({
      id: createId("rsec"),
      kind: "sources",
      heading: "Sources and evidence",
      origin: "research",
      findingIds: [],
    });
  }

  if (result.conflicts.length > 0) {
    sections.push({
      id: createId("rsec"),
      kind: "conflicts",
      heading: "Conflicting information",
      origin: "research",
      findingIds: [],
    });
  }

  if (
    result.unresolvedQuestions.length > 0 ||
    result.limitsReached.length > 0 ||
    result.errors.length > 0
  ) {
    sections.push({
      id: createId("rsec"),
      kind: "unresolved",
      heading: "Unresolved questions",
      origin: "research",
      findingIds: [],
    });
  }

  const nextSteps = want("next_steps") ? buildNextSteps(result) : [];

  if (nextSteps.length > 0) {
    sections.push({
      id: createId("rsec"),
      kind: "next_steps",
      heading: "Suggested next steps",
      origin: "research",
      items: nextSteps,
      findingIds: [],
    });
  }

  return sections;
}

/**
 * The finished deterministic report.
 *
 * Called in two situations that look different and are not: a caller asked for a
 * report with `useModel: false`, and something went wrong on the way to a
 * model-written one. Both want the same document, and `reason` is what
 * distinguishes them in the record — absent for the first, a sentence naming the
 * failure for the second. §14's "fail safely if the underlying research data is
 * incomplete" is met by the caller, which never reaches here without a result;
 * a record with no result produces a `failed` report instead.
 */
export function buildDeterministicReport({
  record,
  result,
  reason,
  generatedAt,
}: {
  record: ResearchRecord;
  result: ResearchResult;
  reason?: string;
  generatedAt?: string;
}): Report {
  const restatement = record.plan?.restatement;
  const question = result.question;

  return {
    id: createId("report"),
    researchId: record.id,
    ...(result.executionId === undefined
      ? {}
      : { executionId: result.executionId }),
    title: deriveTitle(question),
    objective: question,
    status: "completed",
    sections: buildServerSections({
      result,
      // Kept only when it says something the question does not. A restatement
      // identical to the question is not a second reading, and printing both
      // would suggest the planner understood something extra.
      ...(restatement === undefined || restatement.trim() === question.trim()
        ? {}
        : { restatement }),
    }),
    citations: buildCitations(result),
    sources: toReportSources(result.sources),
    conflicts: result.conflicts,
    unresolvedQuestions: result.unresolvedQuestions,
    limitsReached: result.limitsReached,
    errors: [],
    metadata: {
      researchProvider: record.provider,
      generation: {
        mode: "deterministic",
        ...(reason === undefined ? {} : { reason }),
        droppedCitationCount: 0,
        ungroundedNumberCount: 0,
        truncatedSectionCount: 0,
      },
    },
    generatedAt: generatedAt ?? now(),
  };
}
