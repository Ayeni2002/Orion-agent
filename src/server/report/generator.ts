import {
  ModelProviderError,
  parseModelJson,
  type ModelProvider,
  type ModelProviderResponse,
} from "@/server/agent";
import { createId, now } from "@/server/agent/ids";
import type { ResearchRecord, ResearchResult } from "@/types/research";
import type { Report, ReportSection } from "@/types/report";

import {
  buildCitations,
  buildDeterministicReport,
  buildServerSections,
  deriveTitle,
  toReportSources,
} from "./deterministic";
import {
  collectGroundedNumbers,
  findUngroundedSentences,
  resolveFindingIndices,
} from "./grounding";
import {
  MAX_NEXT_STEPS,
  MAX_REPORT_SECTIONS,
  modelReportSchema,
  SUMMARY_MAX_LENGTH,
  SECTION_BODY_MAX_LENGTH,
  type ModelReportSection,
} from "./schema";

/**
 * Report generation: a research result in, a document out.
 *
 * The architecture §2 asks for is visible in the imports above and nowhere else.
 * This module reads a `ResearchResult` that already exists, asks a model to write
 * prose about it, checks that prose against the result, and assembles the two
 * halves into a `Report`. It does not search, retrieve, plan research, or call a
 * tool — there is no import from `@/server/research/tools`, no retrieval provider
 * resolution, and no way for this file to acquire a fact the research run did not
 * already record. A report generator that could go and look something up would be
 * a second research engine with a different set of honesty checks, which is what
 * §2 rules out.
 *
 * **The division of labour, restated as code.** Everything evidence-bearing comes
 * from `./deterministic` — the findings, the sources, the verified quotes, the
 * conflicts, the unresolved questions. Everything this file adds is prose, and
 * every prose block arrives with a list of integer indices into the findings the
 * server numbered. That is the entire model interface. There is no field in
 * `modelReportSchema` through which a URL, a source name, a date or a quotation
 * could arrive, so §4's "do not fabricate URLs" is not a rule the model is asked
 * to follow and might break — it is something the model has no syntax for.
 *
 * **Three outcomes, and none of them is silent.** Either the prose is used, or
 * the prose is dropped and the report is built deterministically with the reason
 * recorded, or the whole generation fails because there was no research to report
 * on. The middle case is the common one and the one worth getting right: a report
 * that fell back is a *successful* report, marked `mode: "deterministic"` and
 * carrying a sentence saying why, because a reader who cannot tell a
 * model-written report from a template one cannot weigh either properly.
 */

export const REPORT_INSTRUCTION = [
  "You are given the complete record of what a research run established: a",
  "question, and the findings recorded for it. Each finding is numbered.",
  "Write the readable parts of a report about those findings.",
  "",
  "Respond with JSON only, matching exactly this shape:",
  '{"summary":{"body":"...","findingIndices":[0,1]},',
  ' "sections":[{"heading":"...","body":"...","findingIndices":[0]}],',
  ' "nextSteps":[{"body":"...","findingIndices":[0]}]}',
  "",
  "Rules:",
  "- The findings are numbered. `findingIndices` names the findings each part of",
  "  your prose is drawn from. Use the numbers only — never a title, a URL, a",
  "  publication name or a quotation of your own. You have no other material.",
  "- State nothing the numbered findings do not already say. You are writing about",
  "  what was found, not about the subject in general.",
  "- Introduce no figure, date, name or statistic that is not in the findings you",
  "  cite. Figures you write are checked against them automatically, and a",
  "  sentence carrying one that is not there is marked as unsupported.",
  "- Where the findings leave a question open or disagree with each other, say so.",
  "  Do not resolve a disagreement and do not fill a gap with what you know.",
  "- `sections` is two to eight analysis sections, each with a short heading.",
  "- `nextSteps` is optional and at most six short entries.",
  `- A summary body is at most ${SUMMARY_MAX_LENGTH} characters; a section body at most ${SECTION_BODY_MAX_LENGTH}.`,
].join("\n");

export interface GenerateReportParams {
  record: ResearchRecord;
  result: ResearchResult;
  /**
   * The model to write the prose.
   *
   * Optional, and its absence is a supported state rather than an error — §5
   * requires a report to remain generatable with no paid provider. `undefined`
   * means the deterministic report is what is wanted, not that something failed.
   */
  provider?: ModelProvider;
  /** Set false to demand a report built only from recorded data. */
  useModel?: boolean;
  generatedAt?: string;
}

/**
 * The exact text the model is shown about the findings.
 *
 * **Its output is reused as the grounding key, and that is the point.** The
 * number check in `./grounding` asks whether a figure in the model's prose
 * appeared in front of the model, and the honest answer to that is a question
 * about *this string* — not about the research result, which the model never saw,
 * and not about the retrieved corpus, most of which no finding rests on. So the
 * brief is built once, sent as one field of the prompt, and handed to the check
 * unchanged. A second rendering for the check would be a second thing to keep in
 * step, and the first time the two diverged the check would be measuring
 * something other than what the model read.
 *
 * The unsupported findings are labelled rather than hidden. A finding the
 * extractor could not tie to retrieved text is still a recorded claim, the model
 * may still write about it, and telling the model which is which is what lets it
 * say "this was inferred rather than sourced" — which is the sentence a reader
 * most needs, and the one a model cannot write if it is not told.
 */
export function buildFindingBrief(result: ResearchResult): string {
  const lines: string[] = [
    `Research question: ${result.question}`,
    "",
    `Findings (${result.findings.length} in total, numbered from 0):`,
  ];

  result.findings.forEach((finding, index) => {
    lines.push(`[${index}] ${finding.statement}`);

    if (finding.basis === "model") {
      lines.push(
        "     (inferred: the extractor could not tie this to retrieved text)",
      );
      return;
    }

    const named = result.sources
      .filter((source) => finding.sourceIds.includes(source.id))
      .map((source) =>
        source.title === undefined
          ? source.domain
          : `${source.title} — ${source.domain}`,
      )
      .join("; ");

    lines.push(
      `     (from: ${named.length > 0 ? named : "a retrieved source"})`,
    );
  });

  lines.push(
    "",
    `The run retrieved ${result.sources.length} source(s), recorded ${result.conflicts.length} conflict(s), and left ${result.unresolvedQuestions.length} question(s) it could not establish.`,
  );

  if (result.unresolvedQuestions.length > 0) {
    lines.push("", "Questions the run did not establish:");

    for (const question of result.unresolvedQuestions) {
      lines.push(`- ${question}`);
    }
  }

  return lines.join("\n");
}

/**
 * What a model's response yielded, once checked.
 *
 * No citation list is carried. The report's chain is built by `./deterministic`
 * from the result, and a model's contribution to it would be strictly poorer: a
 * model names findings by index, and only the record can say which passage
 * supports one, at which URL, from which source. The indices the response named
 * are resolved here for two purposes and no others — deciding whether the prose
 * was grounded in anything at all, and setting each section's `findingIds`, which
 * is what makes "where did Orion get this?" answerable at section granularity.
 */
interface ProseResult {
  sections: ReportSection[];
  droppedCitationCount: number;
  ungroundedNumberCount: number;
  truncatedSectionCount: number;
}

/**
 * Turns one prose block into a section, resolving its citations and checking its
 * numbers.
 *
 * The order is deliberate: resolve first, then ground. The grounded-number set is
 * built from the *whole* brief rather than from the cited findings alone, so the
 * two checks stay independent — a block that cites nothing still has its figures
 * checked against everything the model was shown, which is the only reading under
 * which an uncited sentence is checkable at all.
 */
function toProseSection({
  kind,
  heading,
  body,
  indices,
  findings,
  grounded,
}: {
  kind: "summary" | "analysis";
  heading: string;
  body: string;
  indices: readonly number[];
  findings: ResearchResult["findings"];
  grounded: ReadonlySet<string>;
}): {
  section: ReportSection;
  citedIds: string[];
  droppedCitationCount: number;
  ungroundedNumberCount: number;
} {
  const { findings: cited, droppedCount } = resolveFindingIndices(
    indices,
    findings,
  );

  const ungrounded = findUngroundedSentences(body, grounded);

  return {
    section: {
      id: createId("rsec"),
      kind,
      heading,
      origin: "model",
      body,
      findingIds: cited.map((finding) => finding.id),
      ...(ungrounded.length === 0 ? {} : { ungroundedSentences: ungrounded }),
    },
    citedIds: cited.map((finding) => finding.id),
    droppedCitationCount: droppedCount,
    ungroundedNumberCount: ungrounded.length,
  };
}

/**
 * Everything a model's response contributes, or nothing.
 *
 * Returns a rejection reason when the response must not be used, and the caller
 * then builds the deterministic report. Four rejections, each with a reason that
 * is safe to show a user:
 *
 *   1. the provider threw — an unreachable endpoint, a bad key, a timeout;
 *   2. the response was not JSON;
 *   3. the JSON did not match the schema;
 *   4. **the prose cited no finding at all.**
 *
 * The fourth is the one worth stating. Prose that cites nothing is prose about
 * nothing that was researched — it may be fluent, it may even be plausible, and
 * there is no way to check a word of it, because the grounding machinery works by
 * comparing what was written against what it was written from. A response that
 * names no finding has nothing to compare against, so the honest disposition is
 * not to mark it but to refuse it. This also makes the deterministic development
 * adapter structurally incapable of producing a model-mode report: it offers no
 * citations, so its output is always rejected here, and a report generated with
 * no real provider is always labelled as one.
 */
function readProse({
  response,
  findings,
  brief,
}: {
  response: ModelProviderResponse;
  findings: ResearchResult["findings"];
  brief: string;
}): ProseResult | { rejected: string } {
  // The seam's own parser, not a bare `JSON.parse`: model output arrives fenced
  // in markdown or wrapped in a sentence often enough that every call site
  // hand-rolling the unwrapping is how one of them ends up unhandled.
  const parsed = parseModelJson(response);

  if (!parsed.ok) {
    return { rejected: `The model's response was not usable. ${parsed.error}` };
  }

  const validated = modelReportSchema.safeParse(parsed.value);

  if (!validated.success) {
    return {
      rejected:
        "The model's response did not match the required report structure.",
    };
  }

  const data = validated.data;
  const grounded = collectGroundedNumbers(brief);

  const sections: ReportSection[] = [];
  const citedFindingIds = new Set<string>();
  let droppedCitationCount = 0;
  let ungroundedNumberCount = 0;

  const summary = toProseSection({
    kind: "summary",
    heading: "Executive summary",
    body: data.summary.body,
    indices: data.summary.findingIndices,
    findings,
    grounded,
  });

  sections.push(summary.section);
  summary.citedIds.forEach((id) => citedFindingIds.add(id));
  droppedCitationCount += summary.droppedCitationCount;
  ungroundedNumberCount += summary.ungroundedNumberCount;

  // The cap is a truncation rather than a rejection — see `schema.ts`. Sections
  // past the cap are dropped whole, so everything retained is intact.
  const kept: ModelReportSection[] = data.sections.slice(0, MAX_REPORT_SECTIONS);
  const truncatedSectionCount = data.sections.length - kept.length;

  for (const candidate of kept) {
    const section = toProseSection({
      kind: "analysis",
      heading: candidate.heading,
      body: candidate.body,
      indices: candidate.findingIndices,
      findings,
      grounded,
    });

    sections.push(section.section);
    section.citedIds.forEach((id) => citedFindingIds.add(id));
    droppedCitationCount += section.droppedCitationCount;
    ungroundedNumberCount += section.ungroundedNumberCount;
  }

  const allSteps = data.nextSteps ?? [];
  const steps = allSteps.slice(0, MAX_NEXT_STEPS);
  const truncatedStepCount = allSteps.length - steps.length;

  if (steps.length > 0) {
    const items: string[] = [];
    const stepFindingIds = new Set<string>();
    const ungrounded: string[] = [];

    for (const step of steps) {
      const { findings: cited, droppedCount } = resolveFindingIndices(
        step.findingIndices,
        findings,
      );

      droppedCitationCount += droppedCount;
      items.push(step.body);

      for (const finding of cited) {
        stepFindingIds.add(finding.id);
        citedFindingIds.add(finding.id);
      }

      // A step is short, but it is prose and it may still state a figure, so it
      // goes through the same check as a section body.
      const flagged = findUngroundedSentences(step.body, grounded);

      ungroundedNumberCount += flagged.length;
      ungrounded.push(...flagged);
    }

    sections.push({
      id: createId("rsec"),
      kind: "next_steps",
      heading: "Suggested next steps",
      origin: "model",
      items,
      findingIds: [...stepFindingIds],
      ...(ungrounded.length === 0 ? {} : { ungroundedSentences: ungrounded }),
    });
  }

  // The rejection described above. Checked after assembly so it is a statement
  // about the whole response rather than about any one block: a model that cited
  // findings everywhere but wrote an uncited summary wrote one unsupported
  // paragraph, which is worth keeping and marking — not a model that ignored the
  // contract.
  if (citedFindingIds.size === 0) {
    return {
      rejected:
        "The model's prose named no finding from the research run, so there was nothing to check it against.",
    };
  }

  return {
    sections,
    droppedCitationCount,
    ungroundedNumberCount,
    truncatedSectionCount: truncatedSectionCount + truncatedStepCount,
  };
}

/**
 * Builds the report.
 *
 * Never throws for a reason the caller could act on. A record with a result
 * produces a report — model-written prose if the prose survived checking,
 * deterministic otherwise — and the caller records which. The only failure is a
 * record with no result at all, which `./service` refuses before reaching here,
 * because "generate a report from research that did not finish" has no honest
 * output.
 */
export async function generateReport({
  record,
  result,
  provider,
  useModel = true,
  generatedAt,
}: GenerateReportParams): Promise<Report> {
  const timestamp = generatedAt ?? now();

  const deterministic = (reason?: string): Report =>
    buildDeterministicReport({
      record,
      result,
      ...(reason === undefined ? {} : { reason }),
      generatedAt: timestamp,
    });

  if (!useModel) {
    return deterministic("The report was requested without model-written prose.");
  }

  if (provider === undefined) {
    return deterministic(
      "No model provider is configured, so the report was built from the research record alone.",
    );
  }

  // The model provider seam is one interface with two kinds of implementation,
  // and `isExternal` is the field that distinguishes them — the development
  // adapter sets it false and says of itself that it "must never be presented to
  // a user as if a model produced it". A report is where that matters most: its
  // prose is the part a reader weighs as judgement, so prose from a
  // deterministic stand-in is never requested, and the report says plainly that
  // no model wrote it.
  if (!provider.descriptor.isExternal) {
    return deterministic(
      `No external model is configured (the provider is "${provider.descriptor.label}"), so the report was built from the research record alone.`,
    );
  }

  const brief = buildFindingBrief(result);

  let response: ModelProviderResponse;

  try {
    response = await provider.generate({
      operation: "report",
      instruction: REPORT_INSTRUCTION,
      // One string rather than a structured bag, so the text the model reads and
      // the text the number check reads are the same value rather than two
      // renderings of one.
      context: { brief },
      responseFormat: "json",
      // Enough output for eight bounded sections plus a summary. A response cut
      // off at the cap is a schema failure and falls back, which is the right
      // disposition but a worse report, so the room is given up front.
      maxOutputTokens: 4_000,
    });
  } catch (error) {
    return deterministic(describeProviderFailure(error));
  }

  const prose = readProse({ response, findings: result.findings, brief });

  if ("rejected" in prose) {
    return deterministic(prose.rejected);
  }

  // The evidence-bearing sections are taken from the server's own list rather
  // than filtered out of a combined one, so nothing a model wrote can displace
  // one, and their positions and contents are not a model's to change.
  const server = buildServerSections({
    result,
    ...(record.plan === undefined ||
    record.plan.restatement.trim() === result.question.trim()
      ? {}
      : { restatement: record.plan.restatement }),
    skip: ["summary", "next_steps"],
  });

  return {
    id: createId("report"),
    researchId: record.id,
    ...(result.executionId === undefined
      ? {}
      : { executionId: result.executionId }),
    title: deriveTitle(result.question),
    objective: result.question,
    status: "completed",
    sections: assembleSections(server, prose.sections),
    // The server's chain, not the model's. See `ProseResult`: a model names
    // findings, and only the record can say what passage supports one at which
    // URL, so the complete walkable chain is built from the result and the
    // model's contribution to it is the `findingIds` on each section.
    citations: buildCitations(result),
    sources: toReportSources(result.sources),
    conflicts: result.conflicts,
    unresolvedQuestions: result.unresolvedQuestions,
    limitsReached: result.limitsReached,
    errors: [],
    metadata: {
      researchProvider: record.provider,
      modelProvider: provider.descriptor,
      generation: {
        mode: "model",
        droppedCitationCount: prose.droppedCitationCount,
        ungroundedNumberCount: prose.ungroundedNumberCount,
        truncatedSectionCount: prose.truncatedSectionCount,
      },
    },
    generatedAt: timestamp,
  };
}

/**
 * The document order, with the model's sections in their places.
 *
 * Written as an explicit sequence rather than a sort or a concatenation, because
 * the order *is* the argument the document makes: what was asked, what was found,
 * what it means, what it rests on, what is disputed, what is missing, what to do
 * next. A model's analysis belongs after the findings it analyses and before the
 * sources those findings rest on, and no property of the data implies that — it
 * is a decision, so it is written down in one place.
 */
function assembleSections(
  server: readonly ReportSection[],
  prose: readonly ReportSection[],
): ReportSection[] {
  const pick = (kind: ReportSection["kind"]): ReportSection[] =>
    server.filter((section) => section.kind === kind);

  const of = (kind: ReportSection["kind"]): ReportSection[] =>
    prose.filter((section) => section.kind === kind);

  return [
    ...pick("objective"),
    ...of("summary"),
    ...pick("findings"),
    ...of("analysis"),
    ...pick("sources"),
    ...pick("conflicts"),
    ...pick("unresolved"),
    ...of("next_steps"),
  ];
}

/**
 * A provider failure, as a sentence safe to store and safe to show.
 *
 * `ModelProviderError`'s message is written for exactly this — its docblock says
 * it "carries no provider payload" and is "safe to log and safe to return",
 * because an upstream SDK error can embed the request that produced it and that
 * request carries the credential. Anything else is an unknown, so it is described
 * by its kind rather than by its text: an unexpected error's message could
 * contain anything, including a URL with a key in it, and a report's metadata is
 * rendered to a user.
 */
function describeProviderFailure(error: unknown): string {
  if (error instanceof ModelProviderError) {
    return `The model could not be reached, so the report was built from the research record alone. ${error.message}`;
  }

  return "The model call failed, so the report was built from the research record alone.";
}
