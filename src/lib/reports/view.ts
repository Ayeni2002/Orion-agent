import type { StatusTone } from "@/components/common/status-indicator";
import type {
  Report,
  ReportCitation,
  ReportGeneration,
  ReportSource,
  ReportStatus,
  ReportSummary,
} from "@/types/report";

/**
 * The report presentation rules, as pure functions.
 *
 * The same role `research-panel.tsx`'s inline maps play for a research record,
 * extracted for one reason beyond tidiness: this is the only part of the report
 * UI that can be tested. The project has no component test infrastructure — no
 * `@testing-library/react`, no jsdom, and every one of its test files is
 * server-side — so a rule that lives inside a component is a rule nothing
 * checks. Everything decidable without rendering is decided here instead, and
 * the components below it do layout and nothing else.
 *
 * **What this file must never do.** Decide anything about a report's *contents*.
 * It maps a status to a word and a tone, reads a response body, and groups
 * citations that are already in the document. It does not derive a claim, fill a
 * missing field with a plausible one, or repair a malformed response — a body it
 * does not recognise is reported as unrecognised, because a component that
 * "helpfully" reconstructs a report the server did not send is a component that
 * can show a reader a document that does not exist.
 */

/**
 * What each status is called, and how it reads.
 *
 * Two members, because generation is synchronous — see `ReportStatus`. The
 * in-flight state a user actually sees is not here: it belongs to the request,
 * not to a document, and the console holds it as a boolean rather than
 * pretending a stored report has a progress state.
 */
export const REPORT_STATUS_PRESENTATION: Record<
  ReportStatus,
  { tone: StatusTone; label: string }
> = {
  completed: { tone: "success", label: "Completed" },
  failed: { tone: "error", label: "Failed" },
};

/**
 * How the prose was written, and what that means for the reader.
 *
 * The description is the load-bearing part. A reader who cannot tell a
 * model-written report from one assembled out of the research record cannot
 * weigh either properly — the first contains judgement, the second contains none
 * at all — so the difference is stated in words rather than encoded as a colour
 * or a badge alone.
 */
export const GENERATION_MODE_PRESENTATION: Record<
  ReportGeneration["mode"],
  { tone: StatusTone; label: string; description: string }
> = {
  model: {
    tone: "active",
    label: "Written by a model",
    description:
      "The summary, analysis and next steps were written by a language model from the findings below, and checked against them. Every section says which findings it drew on; anything the model wrote that could not be traced is marked.",
  },
  deterministic: {
    tone: "idle",
    label: "Assembled from the research record",
    description:
      "No model wrote this report. Every finding, quote and source below is copied from the research run, and the summary is the run's own. Nothing here is a model's interpretation, and nothing was added to it.",
  },
};

/** One sentence naming how the report was written and why, when there is a why. */
export function describeGeneration(report: Report): string {
  const { mode, reason } = report.metadata.generation;
  const base = GENERATION_MODE_PRESENTATION[mode].description;

  return reason === undefined ? base : `${reason} ${base}`;
}

/**
 * The corrections the generator had to make, in words.
 *
 * Returned rather than rendered, so the component decides whether the list is
 * empty and this decides what each entry says. All three counters are things a
 * reader would otherwise have no way to learn: a report that quietly dropped
 * three citations looks identical to one that had none to drop.
 */
export function describeGenerationCorrections(report: Report): string[] {
  const { droppedCitationCount, ungroundedNumberCount, truncatedSectionCount } =
    report.metadata.generation;

  const notes: string[] = [];

  if (droppedCitationCount > 0) {
    notes.push(
      `${droppedCitationCount} reference(s) in the generated prose pointed at a finding that does not exist and were removed.`,
    );
  }

  if (ungroundedNumberCount > 0) {
    notes.push(
      `${ungroundedNumberCount} sentence(s) in the generated prose stated a figure that is not in the findings they cite. Those sentences are kept and marked below rather than deleted.`,
    );
  }

  if (truncatedSectionCount > 0) {
    notes.push(
      `${truncatedSectionCount} section(s) were beyond this report's limit and were left out. What remains is complete.`,
    );
  }

  return notes;
}

/** Reads the `error` field from an error response, falling back to a safe string. */
export function readErrorMessage(
  payload: unknown,
  fallback: string,
): string {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const message = (payload as { error?: unknown }).error;

    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }

  return fallback;
}

/**
 * Reads the `report` field, or returns undefined.
 *
 * The check is shallow on purpose — that the field is an object with an id, a
 * title and a sections array. Deeper validation would be this file deciding what
 * a report is, which is the server's job; the point here is only to refuse a body
 * that is clearly not one, so the caller reports "a response Orion did not
 * understand" rather than rendering `undefined` as a document.
 */
export function readReport(payload: unknown): Report | undefined {
  if (typeof payload !== "object" || payload === null || !("report" in payload)) {
    return undefined;
  }

  const report = (payload as { report?: unknown }).report;

  if (typeof report !== "object" || report === null) {
    return undefined;
  }

  const candidate = report as Partial<Report>;

  return typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    Array.isArray(candidate.sections)
    ? (candidate as Report)
    : undefined;
}

/** Reads the `reports` field, or returns undefined if the body is not shaped as expected. */
export function readReportSummaries(payload: unknown): ReportSummary[] | undefined {
  if (typeof payload !== "object" || payload === null || !("reports" in payload)) {
    return undefined;
  }

  const value = (payload as { reports?: unknown }).reports;

  return Array.isArray(value) ? (value as ReportSummary[]) : undefined;
}

/**
 * The report already generated for a research record, when there is one.
 *
 * §22 asks the UI not to regenerate a report that already exists, and this is
 * where that becomes visible rather than merely true: the action beside a
 * finished research run reads "View report" and links to it instead of offering
 * to generate one. The server would reuse the existing document anyway — the
 * generator's own store lookup guarantees it — so this is not what prevents the
 * extra work. It is what stops the interface from *offering* work that will not
 * happen, which is the difference between a rule and an honest button.
 *
 * Newest first, because `listReports` returns them in that order and a record
 * regenerated deliberately would have more than one.
 */
export function findReportForResearch(
  summaries: readonly ReportSummary[],
  researchId: string,
): ReportSummary | undefined {
  return summaries.find((summary) => summary.researchId === researchId);
}

/**
 * Citations grouped by the finding they support.
 *
 * A finding may rest on several sources, so the document's chain is a flat list
 * of branches and a reader wants it grouped — this is that grouping, done once
 * per render rather than rescanned per finding, the same reason
 * `research-panel.tsx` builds its own index before its render loop.
 */
export function groupCitationsByFinding(
  citations: readonly ReportCitation[],
): Map<string, ReportCitation[]> {
  const grouped = new Map<string, ReportCitation[]>();

  for (const citation of citations) {
    const existing = grouped.get(citation.findingId);

    if (existing === undefined) {
      grouped.set(citation.findingId, [citation]);
    } else {
      existing.push(citation);
    }
  }

  return grouped;
}

/**
 * The findings a source supports, by id.
 *
 * §10 asks a source to show "related findings", and this is that relation read
 * the other way round from `groupCitationsByFinding` — from the source towards
 * the claims it is behind. A source in no citation returns an empty list, which
 * is a real and interesting state: it was retrieved and supported nothing.
 */
export function findingIdsForSource(
  citations: readonly ReportCitation[],
  sourceId: string,
): string[] {
  const ids = new Set<string>();

  for (const citation of citations) {
    if (citation.sourceId === sourceId) {
      ids.add(citation.findingId);
    }
  }

  return [...ids];
}

/** A source's title or, when it has none, the URL a reader would otherwise see. */
export function sourceLabel(source: ReportSource): string {
  return source.title ?? source.url;
}

/**
 * When a source was retrieved, or nothing at all.
 *
 * Not a publication date, and the interface must not present it as one. The
 * research layer does not record when a page was published — no retrieval
 * provider returns it and inventing one is exactly what §4 forbids — so the
 * nearest true fact is when Orion read it, and it is labelled as such wherever
 * it is shown.
 */
export function formatRetrievedAt(timestamp: string | undefined): string | undefined {
  if (timestamp === undefined) {
    return undefined;
  }

  const parsed = new Date(timestamp);

  return Number.isNaN(parsed.getTime())
    ? undefined
    : `Retrieved ${parsed.toLocaleString()}`;
}

/** When the report was generated, in the reader's locale. */
export function formatGeneratedAt(timestamp: string): string {
  const parsed = new Date(timestamp);

  return Number.isNaN(parsed.getTime())
    ? timestamp
    : parsed.toLocaleString();
}
