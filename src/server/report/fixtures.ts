import type { AgentExecutionError, ExecutionProvider } from "@/types/agent";
import type {
  ResearchConflict,
  ResearchEvidence,
  ResearchFinding,
  ResearchLimitKind,
  ResearchRecord,
  ResearchResult,
  ResearchSource,
  ResearchStatus,
  ResearchSufficiency,
} from "@/types/research";

/**
 * A research record, built for the report tests.
 *
 * Test-only, and not exported from `report/index.ts` — it is the same kind of
 * helper `research/provider/stub-provider.ts` is, and it exists for the same
 * reason: several test files need the same record, and five copies of it would
 * drift. It is never imported by anything the application runs.
 *
 * **The content is deliberately shaped to exercise the awkward cases**, because a
 * fixture that only contains the happy path produces tests that only pass on it:
 *
 *   - `SOURCE_BLOOMBERG` and `SOURCE_IEA` each support a finding and each carry a
 *     passage, so the citation chain has real branches;
 *   - `SOURCE_COMMENTARY` supports no finding and was retrieved with no body text,
 *     which is a real state the renderer has to handle and the one that proves a
 *     source list is not a citation list;
 *   - `FINDING_INFERENCE` has `basis: "model"` and no sources, so the
 *     unsupported-claim path is always covered;
 *   - there is a conflict and an unresolved question, so the two conditional
 *     sections (§3: omit when empty) are present by default and a test that needs
 *     them absent can say so.
 */

export const RESEARCH_ID = "res_fixture";
export const EXECUTION_ID = "exec_fixture";

export const QUESTION =
  "What did grid-scale battery storage cost in 2024, and how much capacity was installed?";

export const RESTATEMENT =
  "Establish the 2024 cost of grid-scale battery storage and the installed capacity worldwide.";

export const SUMMARY =
  "Grid-scale battery pack costs fell by about 40% between 2019 and 2024, while installed capacity reached 90 GW in 2025. The sources disagree about which of the two drove the other.";

export const SOURCE_BLOOMBERG_ID = "src_bloomberg";
export const SOURCE_IEA_ID = "src_iea";
export const SOURCE_COMMENTARY_ID = "src_commentary";

export const FINDING_COST_ID = "fnd_cost";
export const FINDING_CAPACITY_ID = "fnd_capacity";
export const FINDING_INFERENCE_ID = "fnd_inference";

export const CONFLICT_ID = "cnf_cause";

export const UNRESOLVED_QUESTION =
  "Whether the cost decline continues through 2027.";

/** The set of limits, so a fixture can name one that was reached. */
export const LIMIT_REACHED: ResearchLimitKind = "max_sources_total";

export const PROVIDER: ExecutionProvider = {
  id: "stub",
  label: "Scripted retrieval",
  model: "stub-search",
  isExternal: false,
};

const CREATED_AT = "2026-01-01T00:00:00.000Z";

export const SOURCES: ResearchSource[] = [
  {
    id: SOURCE_BLOOMBERG_ID,
    url: "https://www.bloomberg.com/news/battery-cost-survey",
    domain: "bloomberg.com",
    title: "Battery pack prices fall again",
    content:
      "Grid-scale battery pack costs fell by about 40% between 2019 and 2024, according to the survey.",
    providerId: "stub",
    rank: 0,
    retrievedAt: CREATED_AT,
  },
  {
    id: SOURCE_IEA_ID,
    url: "https://www.iea.org/reports/energy-storage-2025",
    domain: "iea.org",
    title: "Energy Storage Outlook 2025",
    content:
      "Installed grid-scale storage capacity reached 90 GW worldwide in 2025.",
    providerId: "stub",
    rank: 1,
    retrievedAt: CREATED_AT,
  },
  {
    // Retrieved, no title, no body text, and cited by nothing.
    id: SOURCE_COMMENTARY_ID,
    url: "https://example.org/storage-commentary",
    domain: "example.org",
    providerId: "stub",
    rank: 2,
    retrievedAt: CREATED_AT,
  },
];

export const FINDINGS: ResearchFinding[] = [
  {
    id: FINDING_COST_ID,
    statement:
      "Grid-scale battery pack costs fell by about 40% between 2019 and 2024.",
    taskId: "rtk_one",
    basis: "source",
    sourceIds: [SOURCE_BLOOMBERG_ID],
    createdAt: CREATED_AT,
  },
  {
    id: FINDING_CAPACITY_ID,
    statement:
      "Installed grid-scale storage capacity reached 90 GW worldwide in 2025.",
    taskId: "rtk_two",
    basis: "source",
    sourceIds: [SOURCE_IEA_ID],
    createdAt: CREATED_AT,
  },
  {
    id: FINDING_INFERENCE_ID,
    statement: "Cost declines are likely to continue through 2027.",
    taskId: "rtk_two",
    basis: "model",
    sourceIds: [],
    createdAt: CREATED_AT,
  },
];

export const EVIDENCE: ResearchEvidence[] = [
  {
    id: "evd_cost",
    findingId: FINDING_COST_ID,
    sourceId: SOURCE_BLOOMBERG_ID,
    quote: "costs fell by about 40% between 2019 and 2024",
    url: "https://www.bloomberg.com/news/battery-cost-survey",
    createdAt: CREATED_AT,
  },
  {
    id: "evd_capacity",
    findingId: FINDING_CAPACITY_ID,
    sourceId: SOURCE_IEA_ID,
    quote: "Installed grid-scale storage capacity reached 90 GW worldwide in 2025.",
    url: "https://www.iea.org/reports/energy-storage-2025",
    createdAt: CREATED_AT,
  },
];

export const CONFLICTS: ResearchConflict[] = [
  {
    id: CONFLICT_ID,
    findingIds: [FINDING_COST_ID, FINDING_CAPACITY_ID],
    description:
      "The two sources attribute the cost decline to different causes and cannot both be right.",
    sourceIds: [SOURCE_BLOOMBERG_ID, SOURCE_IEA_ID],
    createdAt: CREATED_AT,
  },
];

export interface RecordOverrides {
  id?: string;
  question?: string;
  restatement?: string;
  summary?: string;
  sufficiency?: ResearchSufficiency;
  /** Replaces the result wholesale, for the tests that need one that is not there. */
  result?: ResearchResult;
  /**
   * Overrides the status the fixture would otherwise derive.
   *
   * Without it, "no result" and "failed" are the same fixture, and the case the
   * report service handles separately — a record that reached `completed` and
   * still recorded nothing — could not be built at all.
   */
  status?: ResearchStatus;
  sources?: ResearchSource[];
  findings?: ResearchFinding[];
  evidence?: ResearchEvidence[];
  conflicts?: ResearchConflict[];
  unresolvedQuestions?: string[];
  limitsReached?: ResearchLimitKind[];
  errors?: AgentExecutionError[];
  planRestatement?: string | undefined;
}

/**
 * The result, or `undefined`.
 *
 * `result: undefined` is the state §14's fail-safe exists for — a record exists
 * and has nothing to report on — so it has to be reachable from a test rather
 * than only from a run that failed. Passing `result` explicitly overrides
 * everything; omitting it builds one from the other overrides.
 */
export function researchResultFixture(
  overrides: RecordOverrides = {},
): ResearchResult {
  return {
    requestId: "req_fixture",
    executionId: EXECUTION_ID,
    status: "completed",
    sufficiency: overrides.sufficiency ?? "conflicting",
    // `in` rather than `??`, so an explicit `summary: undefined` means "this run
    // recorded no summary" instead of quietly restoring the fixture's. The same
    // idiom `result` and `planRestatement` use below, for the same reason: a
    // test that wants an absent value has to be able to ask for one.
    ...("summary" in overrides ? { summary: overrides.summary } : { summary: SUMMARY }),
    question: overrides.question ?? QUESTION,
    findings: overrides.findings ?? FINDINGS,
    evidence: overrides.evidence ?? EVIDENCE,
    sources: overrides.sources ?? SOURCES,
    conflicts: overrides.conflicts ?? CONFLICTS,
    unresolvedQuestions:
      overrides.unresolvedQuestions ?? [UNRESOLVED_QUESTION],
    limitsReached: overrides.limitsReached ?? [LIMIT_REACHED],
    errors: overrides.errors ?? [],
  };
}

/**
 * A complete `ResearchRecord`.
 *
 * `planRestatement` is separate from `restatement` on purpose: the plan's
 * restatement is what the generator keeps *only when it differs from the
 * question*, and a test that wants to see that decision has to be able to set the
 * two independently.
 */
export function researchRecordFixture(overrides: RecordOverrides = {}): ResearchRecord {
  const question = overrides.question ?? QUESTION;
  const restatement = overrides.restatement ?? RESTATEMENT;
  const result =
    "result" in overrides
      ? overrides.result
      : researchResultFixture(overrides);

  return {
    id: overrides.id ?? RESEARCH_ID,
    request: {
      id: "req_fixture",
      question,
      createdAt: CREATED_AT,
    },
    plan: {
      id: "rpl_fixture",
      requestId: "req_fixture",
      restatement:
        "planRestatement" in overrides
          ? (overrides.planRestatement ?? "")
          : restatement,
      tasks: [],
      createdAt: CREATED_AT,
    },
    status: overrides.status ?? (result === undefined ? "failed" : "completed"),
    provider: PROVIDER,
    observations: [],
    events: [],
    sources: overrides.sources ?? SOURCES,
    findings: overrides.findings ?? FINDINGS,
    evidence: overrides.evidence ?? EVIDENCE,
    conflicts: overrides.conflicts ?? CONFLICTS,
    ...(result === undefined ? {} : { result }),
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}
