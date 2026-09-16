import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PrintButton } from "@/components/reports/print-button";
import { ReportRenderer } from "@/components/reports/report-renderer";
import { ServiceError } from "@/server/errors";
import { getReportById } from "@/server/services/reports";
import type { Report } from "@/types/report";

/**
 * One report, as a document.
 *
 * The page is chrome and the renderer is the document: everything between the
 * back link and the print control comes from `ReportRenderer`, which is the same
 * component that would render this report anywhere else. §7 asks for the renderer
 * to be reusable and separate from generation, and the way that stays true is
 * that this file never touches a `Report`'s contents — it fetches one, passes it
 * down, and adds a title and two controls.
 *
 * **The report is read on the server.** It comes from the process-local store
 * through the service, which is where the 404 lives: an id that names no report
 * becomes `notFound()` and the application's own not-found page, not an empty
 * document. That is the honest rendering — a report that was evicted from a
 * bounded store is gone, and showing a blank page where one used to be would
 * suggest it existed and had nothing in it.
 */

/**
 * Both this and `generateMetadata` read the store, and both must do it per
 * request. A report is generated after the build, so a prerendered version of this
 * page would be a 404 frozen at build time — the route would look correct and
 * never serve a report that actually existed.
 */
export const dynamic = "force-dynamic";

async function readReport(id: string): Promise<Report | undefined> {
  try {
    return getReportById(id);
  } catch (error) {
    if (error instanceof ServiceError && error.status === 404) {
      return undefined;
    }

    throw error;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const report = await readReport(id);

  return { title: report === undefined ? "Report not found" : report.title };
}

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const report = await readReport(id);

  if (report === undefined) {
    notFound();
  }

  return (
    <div className="space-y-6">
      {/*
        Navigation, not content. §16 asks the print view to hide exactly this
        kind of thing, and `data-print="hide"` is what the print stylesheet keys
        on — the control marks itself rather than the stylesheet guessing at
        selectors, so a new control cannot be forgotten in the rule.
      */}
      <div
        data-print="hide"
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <Link
          href="/reports"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-4" />
          All reports
        </Link>

        <PrintButton />
      </div>

      <ReportRenderer report={report} />
    </div>
  );
}
