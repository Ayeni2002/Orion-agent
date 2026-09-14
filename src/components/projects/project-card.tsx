import { Folder } from "lucide-react";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * A project in a list.
 *
 * Presentational only: the props describe what to render, not a domain model.
 * `src/types/agent.ts` owns the domain vocabulary and will gain a project type
 * with the phase that persists one — inventing it here would put a guess in the
 * type system ahead of the schema that has to satisfy it.
 */
export interface ProjectCardProps {
  name: string;
  description?: string;
  taskCount?: number;
}

export function ProjectCard({ name, description, taskCount }: ProjectCardProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <Folder aria-hidden className="size-4 text-muted-foreground" />
            {name}
          </CardTitle>

          {description ? (
            <CardDescription>{description}</CardDescription>
          ) : null}
        </div>

        {taskCount !== undefined ? (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {taskCount} {taskCount === 1 ? "task" : "tasks"}
          </span>
        ) : null}
      </CardHeader>
    </Card>
  );
}
