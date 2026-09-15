import type { ResearchLimitKind } from "@/types/research";

/**
 * How each limit is described to a reader.
 *
 * Every description names the environment variable that sets it, and that is the
 * point of the module rather than a detail. A limit being reached is not a
 * mystery to be investigated: it is a ceiling that someone configured, and the
 * person reading "the run reached the source ceiling" is very likely the person
 * who can decide whether to raise it. Naming `RESEARCH_MAX_SOURCES` in the
 * message turns "the research stopped early" into "raise this number or expect
 * this again", which is the difference between a report and a diagnosis.
 *
 * A record rather than a `switch`, so adding a member to `ResearchLimitKind`
 * fails to compile here — a new limit with no description would otherwise
 * surface to a reader as an internal identifier like `max_findings`.
 */

export const RESEARCH_LIMIT_DESCRIPTIONS: Record<ResearchLimitKind, string> = {
  max_tasks: "the task ceiling (RESEARCH_MAX_TASKS)",
  max_sources_per_task:
    "the per-task source ceiling (RESEARCH_MAX_SOURCES_PER_TASK)",
  max_sources_total: "the source ceiling (RESEARCH_MAX_SOURCES)",
  max_findings: "the finding ceiling (RESEARCH_MAX_FINDINGS)",
  max_duration: "the time limit (RESEARCH_MAX_DURATION_MS)",
};

export function describeLimit(kind: ResearchLimitKind): string {
  return RESEARCH_LIMIT_DESCRIPTIONS[kind];
}
