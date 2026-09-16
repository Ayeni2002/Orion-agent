import { Fragment } from "react";
import {
  AlertTriangle,
  BookOpen,
  ExternalLink,
  FileText,
  HelpCircle,
  Link2,
  Quote,
  Scale,
} from "lucide-react";

import { StatusIndicator } from "@/components/common/status-indicator";
import { cn } from "@/lib/utils";
import {
  describeGeneration,
  describeGenerationCorrections,
  findingIdsForSource,
  formatGeneratedAt,
  formatRetrievedAt,
  GENERATION_MODE_PRESENTATION,
  groupCitationsByFinding,
  REPORT_STATUS_PRESENTATION,
  sourceLabel,
} from "@/lib/reports/view";
import { splitAroundFlagged } from "@/lib/reports/text";
import { parseSourceUrl } from "@/server/research/url-safety";
import type { FindingBasis } from "@/types/research";
import type {
  Report,
  ReportCitation,
  ReportSection,
  ReportSource,
} from "@/types/report";

/**
 * The renderer: a `Report` becomes a document.
 *
 * §7 asks for one reusable renderer, separate from generation, and this is it.
 * It takes a finished `Report` and knows nothing about how one was made — no
 * provider, no research record, no generator import, no fetch. Every string it
 * prints came off the object it was handed. The separation is not tidiness: it is
 * what lets the same component serve the detail page and the print view, and
 * what guarantees that a change to how reports are generated cannot change how
 * one reads.
 *
 * **This is a server component, deliberately.** It imports `parseSourceUrl` to
 * re-vet every URL at render time, which is the last chance to stop a dangerous
 * scheme reaching an anchor. A source URL was already vetted before it was
 * recorded, so this is defence in depth rather than the control — but a report
 * is the artefact a person trusts, and the cost of the second check is one
 * function call. Because it touches `src/server`, importing it from a client
 * component is a build error rather than a silent bundling of server code, which
 * is the failure mode worth having.
 *
 * **No HTML, anywhere.** The `Report` type has no HTML field and this file has no
 * `dangerouslySetInnerHTML`: prose is emitted as React text nodes, so a model
 * that wrote `<script>` into a body would have it rendered as those eight
 * characters. §21 asks that raw model output never be treated as markup, and the
 * way to guarantee that is to have no place where markup could be.
 *
 * **The chain is walked, not summarised.** §9 asks the detail view to make the
 * source relationship obvious, and §4 asks every statement to be traceable. So a
 * finding is rendered as: its statement, whether it rests on retrieved text, the
 * verified passage that supports it, and the URL that passage came from — in that
 * order, adjacent, with nothing between them. "Where did Orion get this?" is
 * answerable by reading downward, not by navigating.
 */

/** What every section body needs, computed once per render rather than per section. */
interface RenderContext {
  report: Report;
  /** The report's flat chain, grouped by the finding each branch supports. */
  citationsByFinding: Map<string, ReportCitation[]>;
  /**
   * Finding id → its position in the findings list, 1-based.
   *
   * A model-written analysis names the findings it drew on, and this is what
   * turns those ids into the numbers a reader can find above them. Built from the
   * same map the findings section iterates, so the two cannot disagree about
   * which finding is "2".
   */
  findingNumber: Map<string, number>;
}

/**
 * The basis badge: whether a claim rests on retrieved text.
 *
 * Phase 5's distinction, repeated rather than recomputed, and repeated *visibly*
 * because it is the single most important thing a reader can know about a
 * statement — an unsupported claim rendered identically to a supported one
 * overstates the whole result.
 */
function BasisBadge({ basis }: { basis: FindingBasis }) {
  return (
    <StatusIndicator
      tone={basis === "source" ? "success" : "warning"}
      label={basis === "source" ? "From a source" : "Inferred, not sourced"}
      className="shrink-0"
    />
  );
}

/**
 * A URL, as a link when it may be one.
 *
 * The re-vetting described in the file docblock happens here, and the refusal is
 * shown rather than hidden. A URL that fails it is printed as plain text with no
 * anchor around it: a reader of a report about a hostile page should see what was
 * recorded, and the alternative — silently dropping the link — would leave a
 * citation that appears to cite nothing.
 */
function SourceUrl({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  const vetted = parseSourceUrl(url);

  if (!vetted.ok) {
    return (
      <span
        className={cn("font-mono text-xs break-all text-muted-foreground", className)}
      >
        {url}
      </span>
    );
  }

  return (
    <a
      href={vetted.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-baseline gap-1 font-mono text-xs break-all text-muted-foreground underline underline-offset-2 hover:text-foreground",
        className,
      )}
    >
      <ExternalLink aria-hidden className="size-3 shrink-0 self-center" />
      {vetted.url}
    </a>
  );
}

/**
 * Prose, with the sentences that stated an unsupported figure marked.
 *
 * §4's number check flags rather than deletes — the same disposition Phase 5
 * gives an unverifiable quote — so the renderer has to show which sentences were
 * flagged, and `splitAroundFlagged` is the shared splitter that guarantees the
 * mark lands on the sentence the generator flagged rather than on a differently
 * parsed neighbour.
 *
 * A `title` alone would not be enough: it is not reliably announced, so a marked
 * sentence carries a visible explanation beside its section as well. Both are
 * given, because a reader who hovers learns it in place and a reader who does not
 * still finds out.
 */
function Prose({
  text,
  ungrounded,
  className,
}: {
  text: string;
  ungrounded?: readonly string[];
  className?: string;
}) {
  const segments = splitAroundFlagged(text, ungrounded ?? []);

  return (
    <p className={cn("text-sm leading-relaxed", className)}>
      {segments.map((segment, index) => (
        <Fragment key={index}>
          {index === 0 ? null : " "}
          {segment.flagged ? (
            <mark
              title="This sentence states a figure that does not appear in the findings it cites."
              className="rounded-sm bg-amber-500/20 px-0.5 text-foreground underline decoration-amber-600/60 decoration-dotted underline-offset-2"
            >
              {segment.text}
            </mark>
          ) : (
            segment.text
          )}
        </Fragment>
      ))}
    </p>
  );
}

/** The legend for a section that has marks, shown only when it has them. */
function UngroundedNotice({ count }: { count: number }) {
  return (
    <p className="flex items-start gap-2 text-xs text-muted-foreground">
      <AlertTriangle aria-hidden className="mt-0.5 size-3 shrink-0 text-amber-600" />
      <span>
        {count === 1
          ? "One sentence above is marked. It states a figure that does not appear in the findings this section cites. It is shown rather than removed, so you can judge it."
          : `${count} sentences above are marked. They state figures that do not appear in the findings this section cites. They are shown rather than removed, so you can judge them.`}
      </span>
    </p>
  );
}

/**
 * The findings a section drew on, as links to the findings themselves.
 *
 * What makes traceability per-section rather than per-document: a model-written
 * analysis says which findings it was written from, and a reader can go and check
 * exactly those. An empty list is not rendered as "none" — an uncited block is
 * already covered by the counts in the header, and printing "drawn from: nothing"
 * under a paragraph invites a reader to distrust prose that may simply be a
 * restatement.
 */
function FindingRefs({
  ids,
  findingNumber,
}: {
  ids: readonly string[];
  findingNumber: Map<string, number>;
}) {
  const numbered = ids
    .map((id) => ({ id, number: findingNumber.get(id) }))
    .filter((entry): entry is { id: string; number: number } => entry.number !== undefined);

  if (numbered.length === 0) {
    return null;
  }

  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span>Drawn from</span>
      {numbered.map((entry) => (
        <a
          key={entry.id}
          href={`#finding-${entry.id}`}
          className="rounded border border-border px-1.5 py-0.5 font-mono tabular-nums hover:bg-muted"
        >
          finding {entry.number}
        </a>
      ))}
    </p>
  );
}

/**
 * The chain, walked: statement → basis → passage → source.
 *
 * Rendered from the citation groups rather than from the findings section's
 * `findingIds`, and the reason is that a citation group is what is actually
 * printed. Iterating the groups means this cannot produce a finding with no
 * evidence block beside it, which is the one rendering that would make a traceable
 * report look like an untraceable one.
 *
 * The number badge is the anchor a model-written analysis links to, and it is
 * also the answer to "which finding is this?" without counting.
 */
function CitationGroup({
  number,
  findingId,
  citations,
}: {
  number: number;
  findingId: string;
  citations: readonly ReportCitation[];
}) {
  const [first] = citations;

  if (first === undefined) {
    return null;
  }

  return (
    <li
      id={`finding-${findingId}`}
      className="scroll-mt-24 space-y-2 border-t border-border pt-4 first:border-t-0 first:pt-0"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border font-mono text-xs tabular-nums text-muted-foreground"
        >
          {number}
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm">{first.statement}</p>
          <BasisBadge basis={first.basis} />
        </div>
      </div>

      {citations.map((citation, index) =>
        citation.quote === undefined || citation.url === undefined ? null : (
          <blockquote
            key={`${citation.findingId}-${citation.sourceId ?? index}`}
            className="ml-8 space-y-1 border-l-2 border-border pl-3"
          >
            <div className="flex gap-2">
              <Quote aria-hidden className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
              <p className="text-xs italic text-muted-foreground">
                {citation.quote}
              </p>
            </div>

            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 pl-5">
              <Link2 aria-hidden className="size-3 shrink-0 self-center text-muted-foreground" />
              {citation.sourceTitle === undefined ? null : (
                <span className="text-xs text-muted-foreground">
                  {citation.sourceTitle}
                </span>
              )}
              <SourceUrl url={citation.url} />
            </div>
          </blockquote>
        ),
      )}

      {/*
        A finding with no passage is not a rendering failure. It is a finding the
        extractor tied to a source whose text it could not quote, or one it could
        not tie to text at all — and saying so is the entire value of `basis`.
      */}
      {citations.every((citation) => citation.quote === undefined) ? (
        <p className="ml-8 text-xs text-muted-foreground">
          No passage from a source supports this. It is recorded as an inference
          rather than as something the sources say.
        </p>
      ) : null}
    </li>
  );
}

/** One source: what it is, where it is, when Orion read it, what it supports. */
function SourceEntry({
  source,
  context,
}: {
  source: ReportSource;
  context: RenderContext;
}) {
  const supported = findingIdsForSource(
    context.report.citations,
    source.id,
  );
  const retrieved = formatRetrievedAt(source.retrievedAt);

  return (
    <li className="space-y-1.5 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-start gap-2">
        <BookOpen aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm break-words">{sourceLabel(source)}</p>

          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-xs text-muted-foreground">{source.domain}</span>
            {retrieved === undefined ? null : (
              <>
                <span aria-hidden className="text-xs text-muted-foreground">
                  ·
                </span>
                <span className="text-xs text-muted-foreground">{retrieved}</span>
              </>
            )}
          </div>

          <SourceUrl url={source.url} className="block" />

          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {supported.length === 0 ? (
              <span>Retrieved, and supported no finding.</span>
            ) : (
              <>
                <span>Supports</span>
                {supported.map((findingId) => {
                  const number = context.findingNumber.get(findingId);

                  return number === undefined ? null : (
                    <a
                      key={findingId}
                      href={`#finding-${findingId}`}
                      className="rounded border border-border px-1.5 py-0.5 font-mono tabular-nums hover:bg-muted"
                    >
                      finding {number}
                    </a>
                  );
                })}
              </>
            )}
          </p>
        </div>
      </div>
    </li>
  );
}

/**
 * The body of one section, by kind.
 *
 * A `switch` over the closed union with every member handled and no `default`, so
 * a ninth `ReportSectionKind` is a compile error here rather than a section that
 * renders as an empty heading in a document a person reads. That is the same
 * property `describeLimit` and `describeOperation` have, and it is the reason
 * `ReportSectionKind` is a union rather than a free-form heading string.
 *
 * Note what the evidence-bearing kinds do *not* do: they do not read
 * `section.body`. Their material is the report's typed fields, and giving them a
 * body as well would invite a renderer to print a second, prose version of facts
 * that are already below it in their exact form.
 */
function SectionBody({
  section,
  context,
}: {
  section: ReportSection;
  context: RenderContext;
}) {
  const ungrounded = section.ungroundedSentences ?? [];

  switch (section.kind) {
    case "objective":
      return (
        <div className="space-y-3">
          <p className="text-base">{context.report.objective}</p>
          {section.body === undefined ? null : (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium">Understood as: </span>
              {section.body}
            </p>
          )}
        </div>
      );

    case "summary":
      return (
        <div className="space-y-3">
          {section.body === undefined ? null : (
            <Prose
              text={section.body}
              ungrounded={ungrounded}
              className="text-base leading-relaxed"
            />
          )}
          {ungrounded.length === 0 ? null : (
            <UngroundedNotice count={ungrounded.length} />
          )}
          <FindingRefs
            ids={section.findingIds}
            findingNumber={context.findingNumber}
          />
        </div>
      );

    case "findings":
      return (
        <ol className="space-y-4">
          {[...context.citationsByFinding.entries()].map(
            ([findingId, citations]) => {
              const number = context.findingNumber.get(findingId);

              return number === undefined ? null : (
                <CitationGroup
                  key={findingId}
                  number={number}
                  findingId={findingId}
                  citations={citations}
                />
              );
            },
          )}
        </ol>
      );

    case "analysis":
      return (
        <div className="space-y-3">
          {section.body === undefined ? null : (
            <Prose text={section.body} ungrounded={ungrounded} />
          )}
          {ungrounded.length === 0 ? null : (
            <UngroundedNotice count={ungrounded.length} />
          )}
          <FindingRefs
            ids={section.findingIds}
            findingNumber={context.findingNumber}
          />
        </div>
      );

    case "sources":
      return (
        <ul className="space-y-4">
          {context.report.sources.map((source) => (
            <SourceEntry key={source.id} source={source} context={context} />
          ))}
        </ul>
      );

    case "conflicts":
      return (
        <ul className="space-y-3">
          {context.report.conflicts.map((conflict) => (
            <li key={conflict.id} className="space-y-2 rounded-md border border-border px-3 py-2">
              <div className="flex gap-2">
                <Scale aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <p className="text-sm">{conflict.description}</p>
              </div>

              {/*
                The positions are listed rather than resolved. §16 of Phase 5
                requires a disagreement to be represented instead of averaged,
                and a report that picked a side here would be making a judgement
                the research did not make.
              */}
              <ul className="space-y-1 pl-5">
                {conflict.findingIds.map((findingId) => {
                  const number = context.findingNumber.get(findingId);

                  return number === undefined ? null : (
                    <li key={findingId} className="text-xs text-muted-foreground">
                      <a
                        href={`#finding-${findingId}`}
                        className="rounded border border-border px-1.5 py-0.5 font-mono tabular-nums hover:bg-muted"
                      >
                        finding {number}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      );

    case "unresolved": {
      const questions = context.report.unresolvedQuestions;
      const limits = context.report.limitsReached;
      const errors = context.report.errors;

      return (
        <div className="space-y-4">
          {questions.length === 0 ? null : (
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-xs font-medium">
                <HelpCircle aria-hidden className="size-3.5 text-muted-foreground" />
                What the research did not establish
              </p>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {questions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </div>
          )}

          {limits.length === 0 ? null : (
            <div className="space-y-2">
              <p className="text-xs font-medium">Limits the run reached</p>
              <p className="flex flex-wrap gap-1">
                {limits.map((kind) => (
                  <code
                    key={kind}
                    className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs"
                  >
                    {kind}
                  </code>
                ))}
              </p>
              <p className="text-xs text-muted-foreground">
                The run stopped at these ceilings and reported everything it had
                found up to that point. Questions above may be unanswered because
                of them rather than because nothing exists.
              </p>
            </div>
          )}

          {errors.length === 0 ? null : (
            <div className="space-y-2">
              <p className="text-xs font-medium">Errors during the run</p>
              <ul className="space-y-2">
                {errors.map((error, index) => (
                  <li
                    key={`${error.code}-${index}`}
                    className="rounded-md border border-border px-3 py-2 text-xs"
                  >
                    <span className="font-mono text-muted-foreground">
                      {error.code}
                    </span>
                    <p>{error.message}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    }

    case "next_steps":
      return (
        <div className="space-y-3">
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            {(section.items ?? []).map((item, index) => (
              <li key={index}>
                {splitAroundFlagged(item, ungrounded).map((segment, part) => (
                  <Fragment key={part}>
                    {part === 0 ? null : " "}
                    {segment.flagged ? (
                      <mark className="rounded-sm bg-amber-500/20 px-0.5 text-foreground underline decoration-amber-600/60 decoration-dotted underline-offset-2">
                        {segment.text}
                      </mark>
                    ) : (
                      segment.text
                    )}
                  </Fragment>
                ))}
              </li>
            ))}
          </ol>
          {ungrounded.length === 0 ? null : (
            <UngroundedNotice count={ungrounded.length} />
          )}
          <FindingRefs
            ids={section.findingIds}
            findingNumber={context.findingNumber}
          />
        </div>
      );
  }
}

/**
 * One section: its heading, its provenance, and its body.
 *
 * The provenance chip appears only on a report a model actually wrote prose for.
 * On a deterministic report every section came from the record, the header says
 * so once, and repeating "from the research record" under eight headings would be
 * noise — noise that trains a reader to stop reading the one label that matters.
 */
function Section({
  section,
  context,
}: {
  section: ReportSection;
  context: RenderContext;
}) {
  const showOrigin = context.report.metadata.generation.mode === "model";

  return (
    <section className="space-y-3">
      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold tracking-tight">{section.heading}</h2>

        {showOrigin ? (
          <StatusIndicator
            tone={section.origin === "model" ? "active" : "idle"}
            label={
              section.origin === "model"
                ? "Written by a model from the findings it names"
                : "From the research record"
            }
          />
        ) : null}
      </div>

      <SectionBody section={section} context={context} />
    </section>
  );
}

/**
 * How the report was written, and what had to be corrected.
 *
 * Two blocks, and the second is the one a reader would never otherwise get. A
 * report with `mode: "deterministic"` says a model wrote none of it and why. A
 * report with corrections says how many citations were dropped, how many
 * sentences were marked, and how many sections were cut — because a document that
 * quietly lost three citations is indistinguishable from one that had none to
 * lose, and presenting the first as the second is the failure mode this whole
 * subsystem exists to prevent.
 */
function ProvenanceBlock({ report }: { report: Report }) {
  const mode = GENERATION_MODE_PRESENTATION[report.metadata.generation.mode];
  const corrections = describeGenerationCorrections(report);

  return (
    <div className="space-y-2 rounded-md border border-border px-3 py-2">
      <StatusIndicator tone={mode.tone} label={mode.label} />
      <p className="text-xs text-muted-foreground">{describeGeneration(report)}</p>

      {corrections.length === 0 ? null : (
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {corrections.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface ReportRendererProps {
  report: Report;
  className?: string;
}

/**
 * The document.
 *
 * The whole of it, from the `<h1>` down: the page around it supplies chrome and
 * an id, and nothing about how the report reads. §16's print view needs the same
 * document without navigation or controls, and that is satisfied by the chrome
 * marking itself, not by a second rendering path — there is one document, and two
 * ways of surrounding it.
 */
export function ReportRenderer({ report, className }: ReportRendererProps) {
  const status = REPORT_STATUS_PRESENTATION[report.status];
  const citationsByFinding = groupCitationsByFinding(report.citations);
  const findingNumber = new Map(
    [...citationsByFinding.keys()].map((id, index) => [id, index + 1]),
  );

  const context: RenderContext = { report, citationsByFinding, findingNumber };
  const generated = formatGeneratedAt(report.generatedAt);

  return (
    <article className={cn("space-y-8", className)}>
      <header className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileText aria-hidden className="size-3.5" />
            <span>Report</span>
            <span aria-hidden>·</span>
            <span>{generated}</span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            {report.title}
          </h1>

          <StatusIndicator tone={status.tone} label={status.label} />
        </div>

        <ProvenanceBlock report={report} />

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Findings</dt>
            <dd className="tabular-nums">{citationsByFinding.size}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Sources</dt>
            <dd className="tabular-nums">{report.sources.length}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Conflicts</dt>
            <dd className="tabular-nums">{report.conflicts.length}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Left open</dt>
            <dd className="tabular-nums">{report.unresolvedQuestions.length}</dd>
          </div>
        </dl>

        <div className="space-y-1 text-xs text-muted-foreground">
          <p>
            Report <code className="font-mono">{report.id}</code>
          </p>
          <p>
            Research <code className="font-mono">{report.researchId}</code>
            {report.executionId === undefined ? null : (
              <>
                {" · execution "}
                <code className="font-mono">{report.executionId}</code>
              </>
            )}
          </p>
          <p>
            Retrieval{" "}
            <code className="font-mono">
              {report.metadata.researchProvider.id}:
              {report.metadata.researchProvider.model}
            </code>
          </p>
          {report.metadata.modelProvider === undefined ? null : (
            <p>
              Prose{" "}
              <code className="font-mono">
                {report.metadata.modelProvider.id}:
                {report.metadata.modelProvider.model}
              </code>
            </p>
          )}
        </div>
      </header>

      {report.sections.map((section) => (
        <Section key={section.id} section={section} context={context} />
      ))}
    </article>
  );
}
