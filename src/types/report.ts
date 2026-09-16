/**
 * The report domain vocabulary.
 *
 * Phase 6 adds a third kind of work to Orion. Phase 3's agent takes an objective
 * and produces a plan it can execute. Phase 5's research takes a question and
 * produces sources, findings and the evidence connecting them. A *report* takes
 * a finished research result and produces something a person reads.
 *
 * The distinction that shapes every type here is that a report is a **document,
 * not a measurement**. A `ResearchResult` is the record of what was retrieved; a
 * report is a rendering of it with prose on top. That is why this file can be
 * small: almost everything a report shows already exists in `research.ts`, and
 * the report's job is to arrange it rather than to establish anything.
 *
 * **The one structural guarantee.** There is no field anywhere below through
 * which a URL, a source id or a quotation can arrive from a model. Citations
 * name findings, findings name sources, and sources carry URLs — so a URL in a
 * report can only be one that was retrieved, because there is no other way for
 * one to get in. §4 of the Phase 6 brief asks for every finding to be traceable
 * to its source; this makes the untraceable case unrepresentable rather than
 * forbidden.
 *
 * It lives beside `agent.ts` and `research.ts` for the reason those files state
 * about themselves: these types cross the HTTP boundary and are written to logs,
 * so every one of them must survive `JSON.stringify` unchanged. Keep it to plain
 * objects, arrays, strings and numbers. No `Map`, no `Set`, no class instance,
 * no function, no `ZodType` — the executable half of this subsystem lives under
 * `src/server/report/`.
 *
 * **What is deliberately reused rather than redeclared.** `ExecutionProvider`,
 * `AgentExecutionError` and `FindingBasis` are imported from the phases that
 * named them. `ResearchConflict` is embedded as-is. Only the nouns a report
 * actually adds are new here — and `ReportSource`, which is a narrowed view of
 * `ResearchSource` rather than a second spelling of it.
 */

import type { AgentExecutionError, ExecutionProvider } from "./agent";
import type {
  FindingBasis,
  ResearchConflict,
  ResearchLimitKind,
  ResearchSource,
} from "./research";

/**
 * Where a report is in its lifecycle.
 *
 * Two members, not the four §13 of the brief sketches, and the difference is
 * deliberate rather than an omission. Generation is **synchronous**: the request
 * that asks for a report returns the finished one, exactly as a research run
 * finishes inside the request that starts it. So the store only ever holds a
 * record that has already finished — the same property `research/store.ts`
 * states about itself — and `IDLE` and `GENERATING` describe a *request in
 * flight*, which is a fact about the client, not about a stored record.
 *
 * §13 permits this reading in as many words: *"If generation is synchronous, use
 * a simple loading state rather than pretending to know percentage completion."*
 * The UI therefore owns the in-flight state, and this union owns what can
 * actually be persisted.
 *
 * Note what is NOT a status here: "we generated a report but the model's prose
 * failed validation". That outcome is `completed`, with
 * `metadata.generation.mode` recording that the deterministic path produced it
 * and `reason` saying why. A report that fell back is a *successful* report —
 * conflating it with a failure would report a working fallback as a broken one.
 */
export type ReportStatus = "completed" | "failed";

/**
 * What a section is, for a renderer that must handle every kind.
 *
 * A closed union rather than a free-form heading, so a renderer can switch
 * exhaustively and a new kind of section cannot be added without every place
 * that renders one being updated. This is the same reasoning `ResearchLimitKind`
 * gives, and it is what makes "the evidence-bearing sections are built by the
 * server" checkable rather than merely intended: `kind` says which half of the
 * report a section belongs to.
 *
 * The first four and last are server-authored from recorded data. `summary`,
 * `analysis` and `next_steps` are the only kinds a model may write prose for,
 * and prose is the only thing it contributes.
 */
export type ReportSectionKind =
  | "objective"
  | "findings"
  | "sources"
  | "conflicts"
  | "unresolved"
  | "summary"
  | "analysis"
  | "next_steps";

/**
 * How a section came to exist.
 *
 * Carried per-section rather than only per-report because the two halves coexist
 * inside one document: a report generated with a model still has a server-built
 * findings section beside a model-written summary, and a reader is entitled to
 * know which is which without reading the generator.
 */
export type ReportSectionOrigin = "research" | "model";

export interface ReportSection {
  id: string;
  kind: ReportSectionKind;
  heading: string;
  origin: ReportSectionOrigin;
  /**
   * Prose, when there is any.
   *
   * Absent rather than empty for the server-authored sections that carry their
   * material in the fields around them — a `findings` section renders the
   * findings, and giving it an empty body as well would invite a renderer to
   * print a blank paragraph.
   */
  body?: string;
  /**
   * A list the section renders, when its material is a sequence.
   *
   * Only `next_steps` uses it today, and it exists rather than a newline-joined
   * `body` because the alternative was a small protocol — the generator joining
   * on "\n" and the renderer splitting on it — that nothing would have declared
   * and that a step containing a line break would have broken. A list is a list.
   *
   * Entries are prose, so every one of them was subject to the same
   * number-grounding check as a `body`; `ungroundedSentences` is section-level
   * and covers them.
   */
  items?: string[];
  /**
   * Findings this section draws on, by id.
   *
   * The link that makes "where did Orion get this?" answerable per section
   * rather than only per document. A model-authored section names the findings
   * it was written from; the server resolves and drops indices that do not
   * exist, so an id here is always one that survived.
   */
  findingIds: string[];
  /**
   * Sentences that stated a number appearing in none of the cited findings.
   *
   * Kept rather than deleted, and kept *as sentences*, because the honest
   * disposition of an unsupported statistic is to show it and mark it. This is
   * the same call Phase 5 makes when a quote fails verification and the claim is
   * downgraded instead of discarded — see `research/findings/schema.ts`.
   *
   * Absent when nothing was flagged, which is the ordinary case for a report
   * whose prose stayed inside its sources.
   */
  ungroundedSentences?: string[];
}

/**
 * One link in the chain §4 requires: a statement, the finding it came from, and
 * — when the finding rested on retrieved text — the passage and its URL.
 *
 * Shaped after `ResearchEvidence` rather than after `ResearchFinding`, because a
 * finding may rest on more than one source, and a chain with one hop that fans
 * out needs one record per branch to stay walkable.
 *
 * **Every field is copied, not referenced.** `statement` is the finding's own
 * sentence, `quote` is the passage Phase 5 already verified against the
 * retrieved text, and `url` is the source's URL. `ResearchEvidence` denormalises
 * its URL onto itself for the reason its docblock gives — *"a chain with a hop
 * that requires a join is a chain a reader will skip"* — and a report has a
 * stronger version of that reason: the research record lives in a bounded
 * process-local store, so a report that had to join back to it would render
 * empty the moment its record was evicted. A report carries what it shows.
 */
export interface ReportCitation {
  /** The finding this supports. */
  findingId: string;
  /** The finding's statement, verbatim. Never rewritten, never summarised. */
  statement: string;
  /**
   * Whether the finding rested on retrieved text or on a model's own inference.
   *
   * Carried so a reader can tell a sourced claim from an unsupported one without
   * leaving the report, and so the renderer can present them differently. The
   * distinction is Phase 5's and is repeated rather than recomputed.
   */
  basis: FindingBasis;
  /** The verified passage from the source, when the finding had one. */
  quote?: string;
  /** The source the passage came from, when there was one. */
  sourceId?: string;
  /** Denormalised from the source so the chain terminates on this record. */
  url?: string;
  domain?: string;
  sourceTitle?: string;
  /** When the source was retrieved. The nearest thing to a date this data has. */
  retrievedAt?: string;
}

/**
 * A source, as a report needs it.
 *
 * A projection of `ResearchSource` with `content` left off, which is the only
 * difference and the whole reason the type exists. `content` is the retrieved
 * body text — capped, but by far the largest field a source carries — and a
 * report never renders it: the passages that matter are the verified quotes on
 * the citations, and repeating the full text of every source would multiply a
 * document's size for material no reader asked to see.
 *
 * This is a narrowed view rather than a second spelling, the same relationship
 * `ResearchSummary` has to `ResearchRecord`. §1 of the brief rules out
 * duplicating existing types; §10 asks a report to show a source's title,
 * domain, URL and related findings, and this carries exactly that.
 */
export type ReportSource = Omit<ResearchSource, "content">;

/**
 * Who wrote the prose, and what had to be corrected to keep it honest.
 *
 * The counters are the part worth reading. A report that says
 * `mode: "deterministic"` fell back and says why; a report that says
 * `mode: "model"` with `droppedCitationCount: 3` was written by a model that
 * named three findings it had not been given, and the reader can see that
 * something was removed rather than having to trust that nothing was.
 */
export interface ReportGeneration {
  mode: "model" | "deterministic";
  /** Why the deterministic path produced this, when it did. */
  reason?: string;
  /** Citations the model named that resolved to no finding. Dropped, not shown. */
  droppedCitationCount: number;
  /** Sentences stating a number present in none of their cited findings. */
  ungroundedNumberCount: number;
  /** Sections cut to fit their bound. */
  truncatedSectionCount: number;
}

/**
 * Where a report came from, and how it was written.
 *
 * Both providers are recorded for the reason `ResearchRecord.modelProvider` is:
 * a report produced entirely by the deterministic adapter must be recognisable
 * as such from the record alone, and "was this written by a model or by a
 * template?" is the first question a reader of a suspicious sentence asks.
 */
export interface ReportMetadata {
  /** Who retrieved the sources this report rests on. */
  researchProvider: ExecutionProvider;
  /** Who wrote the report's prose, when a model did. */
  modelProvider?: ExecutionProvider;
  generation: ReportGeneration;
}

/**
 * A generated report.
 *
 * `researchId` is the record this was built from, and is the key §11 asks a
 * report to be associated through. `executionId` is carried when the research
 * run had one, so a reader can get from a document back to the run that
 * produced it without a search.
 *
 * `title` and `objective` are both present although they overlap, and the
 * overlap is the point: `objective` is the research question copied verbatim,
 * and `title` is derived from it. §14 of the brief requires the report to
 * reference the correct objective, and a test can check that against the record
 * — which it could not do if the only copy were a title a model had rewritten.
 */
export interface Report {
  id: string;
  /** The research record this report was generated from. */
  researchId: string;
  executionId?: string;
  title: string;
  /** The research question, copied verbatim. Never model-authored. */
  objective: string;
  status: ReportStatus;
  sections: ReportSection[];
  /** Every link in the chain, flat. Grouped by finding where it is rendered. */
  citations: ReportCitation[];
  /**
   * Every source the research run retrieved, not only the cited ones.
   *
   * Included for the reason `ResearchResult.sources` is: "what did Orion
   * actually read?" and "what does Orion say?" are different questions, and a
   * source that supported no finding is often the most interesting thing in a
   * result.
   */
  sources: ReportSource[];
  /** Copied from the result. Never averaged, never resolved. §16 of Phase 5. */
  conflicts: ResearchConflict[];
  /** Copied from the result. §14 requires these to survive into the report. */
  unresolvedQuestions: string[];
  /** Limits the research run reached, so a partial answer reads as one. */
  limitsReached: ResearchLimitKind[];
  /** Populated when `status` is `"failed"`. */
  errors: AgentExecutionError[];
  metadata: ReportMetadata;
  generatedAt: string;
}

/**
 * What a caller asks for.
 *
 * `useModel` is the one genuine preference §12's "optional report preferences"
 * can carry, and it is included because it means something: `false` demands a
 * report built entirely from recorded data, with no inference call, which is
 * both reproducible and free. Setting it is how a caller gets a document whose
 * every sentence came from a source.
 *
 * `regenerate` exists because §22 asks the UI not to re-generate a report that
 * already exists. Defaulting to reuse rather than to regeneration is what makes
 * that the behaviour rather than a hope.
 */
export interface ReportGenerationRequest {
  /** The research record to report on. */
  researchId: string;
  /** Generate afresh even though a report for this record already exists. */
  regenerate?: boolean;
  /** Whether a model may write the prose. Defaults to true. */
  useModel?: boolean;
}

/**
 * The outcome of asking for a report.
 *
 * An outcome value rather than a throw, mirroring `ExtractionOutcome`. A caller
 * records the failure and carries on, and a report that could not be produced is
 * a fact about one record rather than an exception an entire request should die
 * of.
 *
 * **Why `reason` accompanies the error rather than replacing it.** The two carry
 * different things and neither can do the other's job. `error` is the shared
 * `AgentExecutionError` the UI already knows how to render, so a refused report
 * needs no second presentation path. `reason` is the machine contract, and it
 * exists because the two refusals must not be collapsed into one status:
 *
 *   - `not_found` — the id names no research record. The caller asked for
 *     something that does not exist, and asking again will not help.
 *   - `not_ready` — the record exists and has no result. Nothing malfunctioned;
 *     the research has not produced anything to report on, and asking again once
 *     it has will work.
 *
 * A single error code cannot express that difference without inventing a
 * report-specific member of `AgentErrorCode` — the engine's shared error
 * vocabulary — for a condition that is really about a *record's* state rather
 * than about a failure of any work. So the shared code stays as it is and the
 * distinction is carried here, where it is a statement about reports.
 */
export type ReportGenerationResult =
  | { ok: true; report: Report }
  | {
      ok: false;
      reason: ReportRefusalReason;
      error: AgentExecutionError;
    };

/** Why a report could not be produced. See `ReportGenerationResult`. */
export type ReportRefusalReason = "not_found" | "not_ready";

/**
 * A list entry, without the parts that only matter once you open one.
 *
 * The same shape of decision `ResearchSummary` and `ExecutionSummary` make: a
 * full report carries every section, every citation, every source and the whole
 * conflict list, which is the right size for a document and the wrong size for a
 * list. §8 of the brief asks the list for a title, a date, a status and the
 * research it came from, and this carries those.
 */
export interface ReportSummary {
  id: string;
  researchId: string;
  title: string;
  objective: string;
  status: ReportStatus;
  generationMode: ReportGeneration["mode"];
  sectionCount: number;
  citationCount: number;
  sourceCount: number;
  createdAt: string;
}
