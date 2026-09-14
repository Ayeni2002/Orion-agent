import { FileText } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ReportCard, type ReportCardProps } from "@/components/reports/report-card";

export const metadata: Metadata = {
  title: "Reports",
};

/**
 * Reports Orion has produced.
 *
 * `reports` is empty and stays empty: nothing generates reports yet, and a
 * fabricated report would be the single most misleading thing this application
 * could show — a report is meant to be evidence, so inventing one would make
 * the product lie about the one thing it exists to do.
 */
const reports: readonly ReportCardProps[] = [];

export default function ReportsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Reports"
        description="Structured results you can read, share and return to."
      />

      <section aria-labelledby="report-list" className="space-y-3">
        <h2 id="report-list" className="text-sm font-medium tracking-tight">
          All reports
        </h2>

        {reports.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No reports yet"
            description="Reports are produced when a workspace task completes. Until the agent engine exists, none will appear here."
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {reports.map((report) => (
              <li key={report.title}>
                <ReportCard {...report} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
