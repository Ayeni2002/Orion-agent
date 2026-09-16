import { FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ReportCard } from "@/components/reports/report-card";
import { Button } from "@/components/ui/button";
import { listRecentReportSummaries } from "@/server/services/reports";

export const metadata: Metadata = {
  title: "Reports",
};

/**
 * Reports Orion has produced.
 *
 * The list is read from the report store through the service, so it is real or
 * it is empty — there is no third state, and in particular no sample data. That
 * rule is older than this phase: the page was empty for four phases because
 * nothing generated reports, and the note that used to sit here said a fabricated
 * report would be the single most misleading thing this application could show.
 * It is now empty only until someone generates one.
 *
 * **Read at request time.** The store is process-local and empty at build time, so
 * a prerendered list would be the empty state, frozen — the page would look
 * correct and never show a report that had actually been generated. §11 of the
 * brief asks for persistence where the architecture supports it; there is still no
 * database and still no auth (both blocked on Phase 5R), so this is the honest
 * maximum: reports survive as long as the process does, and `docs/REPORTS.md`
 * records exactly that.
 *
 * **The empty state says what to do, not what is missing.** The copy it replaces
 * waited on an agent engine that now exists, which made it worse than useless — a
 * page that tells a visitor a working feature is unbuilt. This one names the real
 * precondition (a finished research run) and links to where one is made.
 */
export const dynamic = "force-dynamic";

export default function ReportsPage() {
  const reports = listRecentReportSummaries();

  return (
    <div className="space-y-8">
      <PageHeader
        title="Reports"
        description="A report turns a finished research run into something readable — the question, what was found, the sources behind every finding, what the sources disagree about, and what stayed unanswered."
      />

      <section aria-labelledby="report-list" className="space-y-3">
        <h2 id="report-list" className="text-sm font-medium tracking-tight">
          All reports
        </h2>

        {reports.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No reports yet"
            description="A report is generated from a finished research run, so there is nothing to list until you ask a question and Orion answers it. Open the report from the research result when it completes."
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/research">Go to Research</Link>
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {reports.map((report) => (
              <li key={report.id}>
                <ReportCard report={report} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
