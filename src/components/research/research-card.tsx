import { FileText } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * A research run in a list — a question Orion was asked, and what came of it.
 *
 * Still presentational only, and still taking strings rather than a
 * `ResearchSummary`: the card renders whatever it is handed and knows nothing
 * about how a run is produced. Phase 5 gave it a real caller — the recent list
 * on the research page maps `ResearchSummary` onto these props — so its shape is
 * now exercised by data rather than only by the empty list it shipped beside.
 */
export interface ResearchCardProps {
  title: string;
  source?: string;
  summary?: string;
}

export function ResearchCard({ title, source, summary }: ResearchCardProps) {
  return (
    <Card>
      <CardHeader className="space-y-1.5">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText aria-hidden className="size-4 text-muted-foreground" />
          {title}
        </CardTitle>

        {source ? (
          <CardDescription className="truncate">{source}</CardDescription>
        ) : null}
      </CardHeader>

      {summary ? (
        <CardContent>
          <p className="text-sm text-muted-foreground">{summary}</p>
        </CardContent>
      ) : null}
    </Card>
  );
}
