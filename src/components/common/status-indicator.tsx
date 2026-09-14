import { cn } from "@/lib/utils";

/**
 * The states a task can be presented in.
 *
 * These describe *presentation*, not the domain. `TaskStatus` in
 * `src/types/agent.ts` is the domain vocabulary and stays the single source of
 * truth for what a task is; this maps those values onto a colour and a label so
 * the status is readable at a glance. When the engine exists, it will drive
 * this from real task state.
 */
export type StatusTone = "idle" | "active" | "success" | "warning" | "error";

const TONE_CLASSES: Record<StatusTone, string> = {
  idle: "bg-muted-foreground/50",
  active: "bg-primary",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-destructive",
};

export function StatusIndicator({
  tone = "idle",
  label,
  className,
}: {
  tone?: StatusTone;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-xs text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", TONE_CLASSES[tone])}
      />
      {label}
    </span>
  );
}
