import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The placeholder shown wherever a section has no data yet.
 *
 * Still what most sections render, because most of them have nothing behind
 * them: projects and memory are later phases, and the sections that do have a
 * backend are empty until a run is made. It states the situation plainly and
 * offers the next action rather than showing invented content — a "no research
 * yet" panel is honest, a fabricated list is not.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-12 text-center",
        className,
      )}
    >
      {Icon ? (
        <span
          aria-hidden
          className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <Icon className="size-5" />
        </span>
      ) : null}

      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>

        {description ? (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>

      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
