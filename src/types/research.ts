/**
 * The research domain vocabulary.
 *
 * Phase 5 adds a second kind of work to Orion. Phase 3's agent takes an
 * objective and produces a plan it can execute; research takes a *question* and
 * produces *sources*, the *findings* drawn from them, and the *evidence* that
 * connects the two. Those are different nouns, so they are different types —
 * and this file is where they are declared.
 *
 * It lives beside `agent.ts` rather than inside it for the reason that file
 * gives about itself: these types cross the HTTP boundary and are written to
 * logs, so every one of them must survive `JSON.stringify` unchanged. Keep it
 * to plain objects, arrays, strings and numbers. No `Map`, no `Set`, no class
 * instance, no function, no `ZodType` — the executable half of this subsystem
 * lives under `src/server/research/`.
 *
 * **What is deliberately reused rather than redeclared.** A research run has a
 * lifecycle, observations, an event log and a provider descriptor, and Phases 3
 * and 4 already named all four. `StepStatus`, `Observation`, `ExecutionProvider`
 * and `AgentExecutionError` are imported rather than copied, so a research run
 * and an agent run cannot drift into two spellings of the same idea. Only the
 * nouns research adds are new here.
 *
 * **The chain this file exists to make walkable.** §13 of the Phase 5 brief
 * requires Finding → Evidence → Source → URL. Each link is a real reference
 * rather than a nested copy: a finding names source ids, an evidence record
 * names one finding and one source, and a source carries the URL. That shape is
 * what makes "which URL supports this sentence?" a lookup instead of an
 * inference, and it is the property §12 depends on — a finding that cannot be
 * walked to a URL is a finding with nothing behind it.
 */

import type {
  AgentEvent,
  AgentExecutionError,
  ExecutionProvider,
  ExecutionStatus,
  Observation,
  StepStatus,
  ToolCapability,
} from "./agent";

/**
 * Lifecycle of a research run.
 *
 * Aliased to `ExecutionStatus` rather than redeclared. A research run is a run:
 * it is created, planned, executed, evaluated and then finishes, and the seven
 * states Phase 3 settled on describe that exactly. A second union with the same
 * members would be two spellings of one lifecycle, and the first place they
 * diverged would be a bug.
 *
 * Note what is NOT a status here: "we could not find enough". A run that
 * searched, found too little and said so has completed successfully. That
 * outcome is `ResearchSufficiency.insufficient`, and conflating it with a
 * failure would report an honest answer as a broken one.
 */
export type ResearchStatus = ExecutionStatus;

/**
 * What a research run asked for.
 *
 * `question` is the user's own words, kept verbatim. The planner restates it
 * into tasks, and the restatement is stored on the plan rather than replacing
 * this — the difference between what was asked and what was understood is
 * exactly what a reader needs when a result looks wrong.
 */
export interface ResearchRequest {
  id: string;
  question: string;
  createdAt: string;
}

/**
 * One unit of research work.
 *
 * Narrower than Phase 3's `TaskStep` on purpose. A research task is not a
 * generic step that happens to mention searching: it is a question to answer,
 * and it may carry the query the planner proposed and the sources that came
 * back. Modelling it as a `TaskStep` with a `toolId` would have made "did this
 * task retrieve anything?" a question about a tool receipt rather than a fact
 * about the task.
 */
export interface ResearchTask {
  id: string;
  planId: string;
  /** Position within the plan. Stable for a given plan revision. */
  index: number;
  /** What this task is trying to establish, in the planner's words. */
  question: string;
  /**
   * The query proposed for retrieval.
   *
   * Required, and that is a statement about what a research task *is*: a task
   * exists because something has to be looked up. A task with no query would be
   * a task that retrieves nothing, and the plan schema refuses to produce one
   * rather than letting an unsearchable task sit in a plan looking like work.
   *
   * Untrusted by construction — it originates from model output and reaches a
   * remote service. It is a search string and nothing else: it is never
   * interpolated into a URL, a shell command or a header, and the tool that
   * consumes it validates its own input before use.
   */
  query: string;
  status: StepStatus;
  /** Sources this task retrieved, by id, in the order they were returned. */
  sourceIds: string[];
  error?: AgentExecutionError;
  createdAt: string;
  updatedAt: string;
}

/**
 * The plan for one request.
 *
 * `restatement` is the planner's reading of the question. It is kept beside the
 * original rather than replacing it because a research result is only as good
 * as the question it actually answered, and a reader comparing the two can see
 * when those differ.
 */
export interface ResearchPlan {
  id: string;
  requestId: string;
  /** The question as the planner understood it. */
  restatement: string;
  tasks: ResearchTask[];
  createdAt: string;
}

/**
 * A retrieved document, normalised.
 *
 * Every retrieval path — whichever provider served it — produces this shape, so
 * nothing downstream has to know which one ran. That is §11's requirement, and
 * it is the same seam the model provider makes for inference: one vocabulary at
 * the boundary, one place where a vendor's response shape is translated.
 *
 * `domain` is derived from `url` at normalisation time and stored rather than
 * recomputed, because §14's deduplication keys on it and a dedupe that
 * recomputed the key differently from the reader would produce two answers to
 * "are these the same source?".
 */
export interface ResearchSource {
  id: string;
  url: string;
  /** Registrable domain, lowercased, derived from `url`. Never guessed. */
  domain: string;
  title?: string;
  /**
   * The retrieved passage text, when the provider returned any.
   *
   * Absent is a real state and a meaningful one. Some retrieval paths return a
   * URL and a title with no body, and in that case there is no text to quote —
   * which is precisely why `ResearchFinding.basis` exists. A finding resting on
   * a source with no content is not supported by retrieved text, and must not
   * claim to be.
   */
  content?: string;
  /** Which provider produced this, so a result can be explained later. */
  providerId: string;
  /** Position in the provider's own result list, where it reported one. */
  rank?: number;
  retrievedAt: string;
}

/**
 * How a finding relates to retrieved material.
 *
 * The distinction §12 turns on. `source` means every claim in the statement is
 * traceable to text that was actually retrieved, and the evidence records are
 * the trace. `model` means the planner or evaluator asserted it without
 * retrieved support — which is not forbidden, but must be visible, because a
 * result that presents an unsupported assertion identically to a supported one
 * is a result that overstates itself.
 */
export type FindingBasis = "source" | "model";

/**
 * A single atomic claim.
 *
 * One sentence, one claim. A finding that bundles several claims cannot be
 * traced to a URL, and an untraceable finding is the thing §12 rules out.
 */
export interface ResearchFinding {
  id: string;
  /** The claim, in one sentence, in the research run's own words. */
  statement: string;
  /**
   * The id of the task that produced it, when one did.
   *
   * Present so a finding can be traced back through the plan to the question it
   * was meant to answer, which is how a reader spots a question the run never
   * actually addressed.
   */
  taskId?: string;
  basis: FindingBasis;
  /**
   * Sources supporting this statement, by id.
   *
   * Empty exactly when `basis` is `"model"`. A finding claiming source basis
   * with no sources is a contradiction, and the research service refuses to
   * construct one rather than trusting the two fields to agree.
   */
  sourceIds: string[];
  createdAt: string;
}

/**
 * One link in the Finding → Evidence → Source → URL chain.
 *
 * An evidence record says: *this finding* rests on *this passage* of *this
 * source*, which is at *this URL*. The URL is denormalised onto the record
 * rather than left to be looked up, because §13 asks for the chain to be
 * walkable and a chain with a hop that requires a join is a chain a reader will
 * skip.
 *
 * `quote` is the retrieved text as it arrived — trimmed, never rewritten. An
 * evidence record whose quote has been paraphrased by the model is not
 * evidence.
 */
export interface ResearchEvidence {
  id: string;
  findingId: string;
  sourceId: string;
  /** The passage from the source that supports the finding. */
  quote: string;
  /** Denormalised from the source so the chain terminates on the record itself. */
  url: string;
  createdAt: string;
}

/**
 * Two findings that cannot both be true.
 *
 * §16 requires conflicts to be represented explicitly rather than averaged
 * away. A run that found "the answer is 4" and "the answer is 5" and reported
 * one of them has not researched the question; it has guessed. Representing the
 * pair is what makes `ResearchSufficiency.conflicting` a statement about the
 * evidence rather than a failure to decide.
 */
export interface ResearchConflict {
  id: string;
  /** The disagreeing findings, by id. At least two. */
  findingIds: string[];
  /** What the disagreement is, in one line, for a human reading the result. */
  description: string;
  /** Sources on each side, so a reader can judge the disagreement themselves. */
  sourceIds: string[];
  createdAt: string;
}

/**
 * Whether the run answered the question — a judgement about the evidence, not
 * about whether the code worked.
 *
 * Four outcomes, and the fourth is not a synonym for any of the first three:
 *
 *   - `sufficient`   — the question is answered, with sources behind it.
 *   - `insufficient` — the run finished and did not find enough. An honest
 *                      answer, reported as a completed run.
 *   - `conflicting`  — sources disagree and the run could not resolve them.
 *                      Distinct from `insufficient`: there is plenty of
 *                      evidence, and it points two ways.
 *   - `failed`       — the run could not carry out the research at all. The
 *                      only one of the four that describes a malfunction.
 */
export type ResearchSufficiency =
  | "sufficient"
  | "insufficient"
  | "conflicting"
  | "failed";

/**
 * A ceiling a run can reach.
 *
 * A closed union rather than free-form strings, so a reader of a result can
 * switch on it exhaustively and a new limit cannot be introduced without the
 * places that report limits being updated. The names correspond one-to-one with
 * the fields of `ResearchLimits`, which is what lets a caller map "this run hit
 * `max_sources_total`" back to the setting that caused it.
 */
export type ResearchLimitKind =
  | "max_tasks"
  | "max_sources_per_task"
  | "max_sources_total"
  | "max_findings"
  | "max_duration";

/**
 * The machine-readable result of a research run.
 *
 * Structured rather than prose. A `summary` is present for a human, but every
 * claim in it is expected to be derivable from `findings` and `evidence` —
 * which is the difference between a result a caller can act on and a result a
 * caller has to trust.
 *
 * `sources` is included alongside the findings rather than reachable only
 * through them, because the two questions a reader asks are different: "what
 * does Orion say?" walks findings, and "what did Orion actually read?" walks
 * sources. A source that supported no finding is a fact worth being able to
 * see — it is often the most interesting one.
 */
export interface ResearchResult {
  requestId: string;
  /** The run that produced this result. */
  executionId?: string;
  status: ResearchStatus;
  sufficiency: ResearchSufficiency;
  /** Human-readable summary. Every claim in it traces to `findings`. */
  summary?: string;
  question: string;
  findings: ResearchFinding[];
  evidence: ResearchEvidence[];
  sources: ResearchSource[];
  conflicts: ResearchConflict[];
  /** Populated when `sufficiency` is `"failed"`. */
  errors: AgentExecutionError[];
  /** Limits that were reached. Empty when the run stayed inside all of them. */
  limitsReached: ResearchLimitKind[];
  completedAt?: string;
}

/**
 * A complete research record: what was asked, how it was planned, what was
 * found, and — once the run ends — the result.
 *
 * The parts are separated for the same reason `AgentExecution` separates them:
 * they have different lifetimes. `observations` is the append-only account of
 * what happened, `sources`/`findings`/`evidence` are the evidence base as it
 * accumulated, and `result` is written once and never changes.
 *
 * `events` is the Phase 3 event log, carried here unchanged. §19 requires the
 * workspace to show a research run's progress from real backend events, and
 * this is where they come from: the same `EventLog` and the same
 * `AgentEventType` union an agent run uses, so the workspace follows a research
 * run with the component it already has and no second event vocabulary exists.
 */
export interface ResearchRecord {
  id: string;
  request: ResearchRequest;
  plan?: ResearchPlan;
  status: ResearchStatus;
  /** Who retrieved the sources. */
  provider: ExecutionProvider;
  /**
   * Who planned the research and read the retrieved text.
   *
   * A research run uses two providers, and this is the second one. Storing only
   * the retrieval provider would leave a record unable to answer "was this
   * planned by a model or by the deterministic adapter?", which is exactly the
   * question §9's free-provider support makes worth asking — a run produced
   * entirely by the development adapter must be recognisable as such from the
   * record alone.
   */
  modelProvider?: ExecutionProvider;
  observations: Observation[];
  events: AgentEvent[];
  sources: ResearchSource[];
  findings: ResearchFinding[];
  evidence: ResearchEvidence[];
  conflicts: ResearchConflict[];
  result?: ResearchResult;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
}

/**
 * A list entry, without the parts that only matter once you open one.
 *
 * The same shape of decision Phase 3 made for `ExecutionSummary`: a full record
 * carries every source, every finding and the whole observation log, which is
 * the right size for a detail view and the wrong size for a list.
 */
export interface ResearchSummary {
  id: string;
  question: string;
  status: ResearchStatus;
  /** Absent while the run is unfinished. */
  sufficiency?: ResearchSufficiency;
  provider: ExecutionProvider;
  sourceCount: number;
  findingCount: number;
  conflictCount: number;
  createdAt: string;
  finishedAt?: string;
  summary?: string;
}

/**
 * What the research subsystem can currently do, readable without starting a run.
 *
 * The same honesty Phase 4 applied with `EngineCapabilities`: a user deciding
 * whether to ask a research question should learn that retrieval is not
 * configured *before* waiting for a run, not from a failed result afterwards.
 */
export interface ResearchCapabilities {
  /** The retrieval provider, or null when none could be constructed. */
  provider: ExecutionProvider | null;
  /** Whether retrieval is configured at all. False is a supported state. */
  searchConfigured: boolean;
  /** The tool a research run calls to retrieve. Named so the UI need not guess. */
  toolId: string;
  /**
   * What a research run is granted.
   *
   * Reported because it is the one place in Orion where a grant is widened, and
   * a widened grant that nothing states is a grant nobody reviews. A reader
   * seeing `network` here learns exactly what a research run may do that an
   * agent run may not.
   */
  grantedCapabilities: ToolCapability[];
  limits: ResearchLimits;
  /** Present when the provider could not be resolved from the environment. */
  configurationError?: string;
}

/**
 * The ceilings a research run operates under.
 *
 * Explicit and configurable, as §10 and §22 require. Every one of these exists
 * because the alternative is an unbounded loop reaching a metered endpoint: a
 * planner that keeps proposing tasks, a run that keeps fetching, a finding list
 * that keeps growing. The values are small by default so a misconfiguration is
 * cheap to discover.
 *
 * Reaching a limit is not a failure. §22 requires partial results to survive,
 * so a run that hits one records the limit's name in
 * `ResearchResult.limitsReached` and returns everything it found.
 */
export interface ResearchLimits {
  /** Maximum tasks a plan may contain. */
  maxTasks: number;
  /** Maximum sources retrieved for any single task. */
  maxSourcesPerTask: number;
  /** Maximum sources across the whole run, after deduplication. */
  maxSourcesTotal: number;
  /** Maximum findings the run will record. */
  maxFindings: number;
  /** Wall-clock ceiling for the whole run, in milliseconds. */
  maxDurationMs: number;
}
