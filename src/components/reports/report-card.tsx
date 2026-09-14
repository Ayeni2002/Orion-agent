import { FileText } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * A saved report in a list.
 *
 * Presentational only. Nothing generates reports yet, so there is no report
 * shape to model — and no report is ever fabricated to fill this component.
 */
export interface ReportCardProps {
  title: string;
  summary?: string;
  generatedAt?: string;
}

export function ReportCard({ title, summary, generatedAt }: ReportCardProps) {
  return (
    <Card>
      <CardHeader className="space-y-1.5">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText aria-hidden className="size-4 text-muted-foreground" />
          {title}
        </CardTitle>

        {summary ? <CardDescription>{summary}</CardDescription> : null}
      </CardHeader>

      {generatedAt ? (
        <CardContent>
          <p className="text-xs text-muted-foreground">{generatedAt}</p>
        </CardContent>
      ) : null}
    </Card>
  );
}
