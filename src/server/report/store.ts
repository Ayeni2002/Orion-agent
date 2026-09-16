import type { Report } from "@/types/report";

/**
 * Process-local report store.
 *
 * The third of its kind, and it is worth saying why it is a third rather than a
 * reuse of one of the others. `agent/runtime/store.ts` holds executions,
 * `research/store.ts` holds research records, and this holds reports. They are
 * different entities with different lifetimes, different list projections and —
 * the reason that matters here — different sizes. A report carries every
 * citation and every source, denormalised on purpose so it renders without a
 * join, which makes it larger than a research summary and smaller than the
 * record it was built from. A shared map would mean a union at every read, and
 * the first read to pick the wrong branch would be a bug in the workspace rather
 * than in a query.
 *
 * The departure the other two record applies unchanged: the persistence phase
 * is not built, so a stored report is visible only from the process that
 * produced it, does not survive a restart, and is not shared between instances.
 * **This is also why §11's "persist reports if the existing persistence
 * architecture supports it" is answered with this file and not with a database.**
 * There is no persistence architecture to extend — `supabase/server.ts` states
 * the session middleware arrives with authentication in a later phase, and no
 * table, migration or repository exists anywhere in the repo. Writing a real
 * store here would be inventing an architecture rather than using one.
 *
 * §22 rules out building caching infrastructure, and this is not that. There is
 * no expiry, no invalidation, no key strategy. It is a bounded container, and
 * the only lookup performed against it is the single one that answers "does a
 * report for this research record already exist?" — which is how §22's "do not
 * regenerate unnecessarily" is satisfied without a cache.
 */

/**
 * Upper bound on retained reports.
 *
 * Between the execution store's fifty and the research store's twenty. A report
 * is bigger than an execution summary and smaller than the research record it
 * came from, because it carries the citations and sources but drops each
 * source's retrieved body text — see `ReportSource`.
 */
export const MAX_RETAINED_REPORTS = 25;

const reports = new Map<string, Report>();

export function saveReport(report: Report): void {
  // Delete before setting so a re-saved report moves to the end of the Map's
  // insertion order, exactly as the other two stores do — otherwise a report
  // that was just written would still be evicted first for having been written
  // earliest.
  reports.delete(report.id);
  reports.set(report.id, report);

  while (reports.size > MAX_RETAINED_REPORTS) {
    const oldest = reports.keys().next();

    if (oldest.done === true) {
      break;
    }

    reports.delete(oldest.value);
  }
}

export function getReport(id: string): Report | undefined {
  return reports.get(id);
}

/** Most recently written first — the order the reports page lists them in. */
export function listReports(): Report[] {
  return [...reports.values()].reverse();
}

/**
 * The most recent report generated for a research record.
 *
 * The one lookup §22 needs. Scans newest-first so the answer is the report a
 * caller would expect to be shown, and returns `undefined` rather than a
 * placeholder when there is none — a missing report is a real state the caller
 * acts on by generating one, not an error.
 *
 * Linear in the number of retained reports, bounded at `MAX_RETAINED_REPORTS`.
 * An index would be a cache, and §22 rules out building one for a scan of at
 * most twenty-five entries.
 */
export function findReportByResearchId(researchId: string): Report | undefined {
  for (const report of listReports()) {
    if (report.researchId === researchId) {
      return report;
    }
  }

  return undefined;
}

/** Test-only. Keeps cases independent of each other's runs. */
export function clearReports(): void {
  reports.clear();
}
