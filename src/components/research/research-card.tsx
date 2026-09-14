import { FileText } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * A research item in a list — a finding Orion gathered.
 *
 * Presentational only, for the same reason as `ProjectCard`: no research is
 * gathered yet, so there is no domain shape to commit to.
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
