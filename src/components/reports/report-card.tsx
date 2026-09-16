import { FileText } from "lucide-react";
import Link from "next/link";

import { StatusIndicator } from "@/components/common/status-indicator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  formatGeneratedAt,
  GENERATION_MODE_PRESENTATION,
  REPORT_STATUS_PRESENTATION,
} from "@/lib/reports/view";
import type { ReportSummary } from "@/types/report";

/**
 * A report in a list.
 *
 * Presentational, and now reading a real record. Until this phase this component
 * took three loose props and the list was empty by design — its docblock said no
 * report is ever fabricated to fill it. That rule has not changed; what changed is
 * that there is now something real to fill it with, so the props are a
 * `ReportSummary` rather than a shape invented for a placeholder.
 *
 * **The objective is shown as well as the title.** A title is derived from the
 * question and may be truncated to fit; the objective is the question verbatim,
 * and a reader scanning a list of six reports about similar questions is choosing
 * between questions, not between titles. It is also the field a reader can check
 * against what they asked — §8 asks the list to show the research a report came
 * from, and this shows both what was asked and which record answered it.
 *
 * **The generation mode is on the card, not only inside.** Whether a model wrote
 * the prose is the first thing that determines how much weight to give a report,
 * so it belongs where the choice to open one is made.
 */
export function ReportCard({ report }: { report: ReportSummary }) {
  const status = REPORT_STATUS_PRESENTATION[report.status];
  const generation = GENERATION_MODE_PRESENTATION[report.generationMode];

  return (
    <Card className="h-full">
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base text-balance">
            <Link
              href={`/reports/${report.id}`}
              className="inline-flex items-start gap-2 rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <FileText
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              />
              <span>{report.title}</span>
            </Link>
          </CardTitle>

          <StatusIndicator tone={status.tone} label={status.label} />
        </div>

        <CardDescription className="text-pretty">
          {report.objective}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-2 text-xs text-muted-foreground">
        <StatusIndicator tone={generation.tone} label={generation.label} />

        <p className="tabular-nums">
          {report.sectionCount} section(s) · {report.citationCount} citation(s) ·{" "}
          {report.sourceCount} source(s)
        </p>

        <p>
          {formatGeneratedAt(report.createdAt)} · from research{" "}
          <code className="font-mono">{report.researchId}</code>
        </p>
      </CardContent>
    </Card>
  );
}
