"use client";

import { Activity, ListChecks, Sparkles } from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
import {
  StatusIndicator,
  type StatusTone,
} from "@/components/common/status-indicator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  AgentExecution,
  ExecutionStatus,
  StepStatus,
  ToolExecution,
  ToolExecutionStatus,
} from "@/types/agent";

/**
 * The execution, activity and results column of the workspace.
 *
 * Every value rendered here comes from an `AgentExecution` the engine returned.
 * Nothing is inferred, animated or advanced locally: if the engine did not
 * report it, it is not on screen. The empty states are the honest rendering of
 * "no execution yet" rather than placeholders standing in for data that does
 * not exist.
 *
 * The provider notice is the part worth not removing. When a run was produced
 * by the deterministic development adapter, the panel says so next to the
 * results — the run is a genuine engine execution, and saying which provider
 * produced it is what keeps it from reading as model output.
 *
 * Phase 4 added the tool block inside each step. It renders `step.execution`,
 * the receipt the tool layer recorded, which is the same object the engine
 * stored — so the tool a step used, whether it succeeded, how long it took and
 * what it returned are all facts about what happened rather than a timeline the
 * UI animated while waiting.
 */

const EXECUTION_PRESENTATION: Record<
  ExecutionStatus,
  { tone: StatusTone; label: string }
> = {
  created: { tone: "idle", label: "Created" },
  planning: { tone: "active", label: "Planning" },
  running: { tone: "active", label: "Running" },
  evaluating: { tone: "active", label: "Evaluating" },
  completed: { tone: "success", label: "Completed" },
  failed: { tone: "error", label: "Failed" },
  cancelled: { tone: "warning", label: "Cancelled" },
};

const STEP_PRESENTATION: Record<
  StepStatus,
  { tone: StatusTone; label: string }
> = {
  pending: { tone: "idle", label: "Pending" },
  running: { tone: "active", label: "Running" },
  completed: { tone: "success", label: "Completed" },
  failed: { tone: "error", label: "Failed" },
  skipped: { tone: "warning", label: "Skipped" },
};

const TOOL_PRESENTATION: Record<
  ToolExecutionStatus,
  { tone: StatusTone; label: string }
> = {
  running: { tone: "active", label: "Running" },
  succeeded: { tone: "success", label: "Completed" },
  failed: { tone: "error", label: "Failed" },
};

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString();
}

/**
 * How long a tool call took, from the receipt's own timestamps.
 *
 * Returns undefined rather than a guess when either end is missing or unparseable
 * — the panel shows only what the engine recorded. A negative span means the
 * clock moved between the two reads, which is not a duration worth printing.
 */
function formatDuration(
  startedAt?: string,
  finishedAt?: string,
): string | undefined {
  if (startedAt === undefined || finishedAt === undefined) {
    return undefined;
  }

  const elapsedMs = Date.parse(finishedAt) - Date.parse(startedAt);

  if (Number.isNaN(elapsedMs) || elapsedMs < 0) {
    return undefined;
  }

  return elapsedMs < 1000
    ? `${elapsedMs} ms`
    : `${(elapsedMs / 1000).toFixed(2)} s`;
}

/** Renders a structured value the engine produced, without interpreting it. */
function StructuredValue({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-muted px-3 py-2 text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** The tool call a step made, if it made one. */
function ToolReceiptBlock({ execution }: { execution: ToolExecution }) {
  const presentation = TOOL_PRESENTATION[execution.status];
  const duration = formatDuration(execution.startedAt, execution.finishedAt);

  return (
    <div className="space-y-2 rounded-md border border-border px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs">
          <span className="text-muted-foreground">Tool</span>{" "}
          <code className="font-mono">{execution.toolId}</code>
          {execution.toolVersion === undefined ? null : (
            <span className="text-muted-foreground">
              {" "}
              v{execution.toolVersion}
            </span>
          )}
        </p>

        <StatusIndicator
          tone={presentation.tone}
          label={presentation.label}
          className="shrink-0"
        />
      </div>

      {duration === undefined ? null : (
        <p className="text-xs text-muted-foreground">Took {duration}</p>
      )}

      {execution.error === undefined ? null : (
        <p className="text-xs">
          <span className="font-mono text-muted-foreground">
            {execution.error.code}
          </span>{" "}
          {execution.error.message}
        </p>
      )}

      {execution.output === undefined ? null : (
        <StructuredValue value={execution.output} />
      )}
    </div>
  );
}

export interface ExecutionPanelProps {
  execution: AgentExecution | null;
  isSubmitting: boolean;
}

export function ExecutionPanel({
  execution,
  isSubmitting,
}: ExecutionPanelProps) {
  const presentation =
    execution === null
      ? null
      : EXECUTION_PRESENTATION[execution.state.status];

  // Read once, so the Results card below does not depend on the JSX conditions
  // narrowing `execution` for each other.
  const result = execution?.result;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-sm">Execution</CardTitle>
            <CardDescription>Plan, steps and tool calls.</CardDescription>
          </div>

          <StatusIndicator
            tone={isSubmitting ? "active" : (presentation?.tone ?? "idle")}
            label={isSubmitting ? "Running" : (presentation?.label ?? "Idle")}
          />
        </CardHeader>

        <CardContent className="space-y-4">
          {execution === null ? (
            <EmptyState
              icon={ListChecks}
              title={isSubmitting ? "Planning…" : "Nothing running"}
              description={
                isSubmitting
                  ? "Orion is decomposing the objective and running each step."
                  : "Give Orion an objective and its plan will appear here, step by step."
              }
            />
          ) : (
            <>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>
                  Execution{" "}
                  <code className="font-mono">{execution.id}</code>
                </p>
                <p>
                  Provider{" "}
                  <code className="font-mono">
                    {execution.provider.id}:{execution.provider.model}
                  </code>
                </p>
              </div>

              {execution.provider.isExternal ? null : (
                <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
                  {execution.provider.label}. No external model was called — this
                  is a real engine execution on a deterministic local adapter,
                  not AI output.
                </p>
              )}

              {execution.task.steps.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  The run did not produce a plan.
                </p>
              ) : (
                <ol className="space-y-3">
                  {execution.task.steps.map((step) => {
                    const stepPresentation = STEP_PRESENTATION[step.status];

                    return (
                      <li
                        key={step.id}
                        className="space-y-1 border-l-2 border-border pl-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm">
                            <span className="text-muted-foreground">
                              {step.index + 1}.
                            </span>{" "}
                            {step.description}
                          </p>
                          <StatusIndicator
                            tone={stepPresentation.tone}
                            label={stepPresentation.label}
                            className="shrink-0"
                          />
                        </div>

                        {step.expectedOutput === undefined ? null : (
                          <p className="text-xs text-muted-foreground">
                            Expected: {step.expectedOutput}
                          </p>
                        )}

                        {step.execution !== undefined ? (
                          <ToolReceiptBlock execution={step.execution} />
                        ) : step.toolId === undefined ? null : (
                          // No receipt yet: the run ended before this step
                          // reached its tool call, so all that is known is what
                          // the plan asked for.
                          <p className="text-xs text-muted-foreground">
                            Requires capability{" "}
                            <code className="font-mono">{step.toolId}</code>
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Activity</CardTitle>
          <CardDescription>
            A chronological log of what Orion did and why.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {execution === null || execution.events.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="No activity yet"
              description="Start a workspace task to begin."
              className="py-8"
            />
          ) : (
            <ol className="space-y-2">
              {execution.events.map((event) => (
                <li key={event.id} className="flex gap-3 text-xs">
                  <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                    {formatTime(event.timestamp)}
                  </span>
                  <span className="min-w-0">
                    <span className="font-mono text-muted-foreground">
                      {event.type}
                    </span>{" "}
                    {event.message}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Results</CardTitle>
          <CardDescription>
            What each step produced, exactly as the engine recorded it.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {result === undefined ? (
            <EmptyState
              icon={Sparkles}
              title="No results yet"
              description="Orion's findings will be reported here once a run finishes."
              className="py-8"
            />
          ) : (
            <>
              <p className="text-sm">{result.summary}</p>

              {result.errors === undefined ||
              result.errors.length === 0 ? null : (
                <div className="space-y-2">
                  <p className="text-xs font-medium">Errors</p>
                  <ul className="space-y-2">
                    {result.errors.map((resultError, index) => (
                      <li
                        key={`${resultError.code}-${index}`}
                        className="rounded-md border border-border px-3 py-2 text-xs"
                      >
                        <span className="font-mono text-muted-foreground">
                          {resultError.code}
                        </span>
                        <p>{resultError.message}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.findings === undefined ||
              result.findings.length === 0 ? null : (
                <div className="space-y-3">
                  <p className="text-xs font-medium">
                    Step output (raw, unsummarised)
                  </p>
                  {result.findings.map((finding, index) => (
                    <StructuredValue key={index} value={finding} />
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
