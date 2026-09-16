import { Activity, ArrowRight, FileText, Folder } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import {
  StatusIndicator,
  type StatusTone,
} from "@/components/common/status-indicator";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getEngineCapabilities,
  listRecentExecutionSummaries,
} from "@/server/services/agent";
import type { ExecutionStatus } from "@/types/agent";

export const metadata: Metadata = {
  title: "Overview",
};

/**
 * The Orion dashboard.
 *
 * **What changed here.** Every section on this page used to be an empty state,
 * and the activity one carried a status chip reading "Engine not implemented".
 * That stopped being true two phases before this was written — the engine plans,
 * executes, calls tools and evaluates, and has done so against a real model. A
 * dashboard that announces a missing engine while the same deployment runs
 * objectives end to end is worse than a blank one, because the reader has no way
 * to tell which of the two is wrong.
 *
 * It now reports the two things it can actually observe: the provider the
 * running server resolved, and the runs this instance has executed. Both are
 * read per request, which is what `force-dynamic` is for — resolved during a
 * static render they would report the build machine's environment and an empty
 * list for the life of the deployment.
 *
 * The honest limit is stated rather than hidden: executions are held in process
 * memory (`ARCHITECTURE.md` §10), so the list is what *this* instance has run
 * since it started, and the empty state covers a fresh instance truthfully.
 *
 * Projects and research stay empty on purpose — neither has a backend yet, and
 * an invented list would misrepresent the product in exactly the way this page
 * used to.
 */
export const dynamic = "force-dynamic";

/** How each run status reads at a glance. Presentation only; see `agent.ts`. */
const STATUS_PRESENTATION: Record<
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

/** Most recent first, and a dashboard does not need all fifty. */
const MAX_LISTED_RUNS = 5;

export default function OverviewPage() {
  const engine = getEngineCapabilities();
  const provider = engine.provider;
  const executions = listRecentExecutionSummaries();

  const providerTone: StatusTone =
    provider === null ? "error" : provider.isExternal ? "success" : "idle";

  const providerLabel =
    provider === null
      ? "Misconfigured"
      : provider.isExternal
        ? `Live · ${provider.model}`
        : "Development adapter";

  return (
    <div className="space-y-8">
      <PageHeader
        title="ORION"
        description="Autonomous AI Research Agent. Give Orion an objective and it will plan the work, gather what it needs, evaluate the result and report back."
        actions={
          <Button asChild>
            <Link href="/workspace">
              Start a task
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Start here</CardTitle>
          <CardDescription>
            Describe what you want researched. Orion will break the objective
            into steps, choose the tools each step needs, and report what it
            found.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-wrap items-center gap-3">
          <Button asChild>
            <Link href="/workspace">Open the workspace</Link>
          </Button>

          <Button asChild variant="outline">
            <Link href="/projects">Create a project</Link>
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="recent-projects" className="space-y-3">
          <h2
            id="recent-projects"
            className="text-sm font-medium tracking-tight"
          >
            Recent projects
          </h2>

          <EmptyState
            icon={Folder}
            title="No projects yet"
            description="Projects group related research so a long-running objective stays organised."
            action={
              <Button asChild size="sm" variant="outline">
                <Link href="/projects">Go to Projects</Link>
              </Button>
            }
          />
        </section>

        <section aria-labelledby="recent-research" className="space-y-3">
          <h2
            id="recent-research"
            className="text-sm font-medium tracking-tight"
          >
            Recent research
          </h2>

          <EmptyState
            icon={FileText}
            title="No research yet"
            description="Findings appear here once Orion has run an objective and gathered sources."
            action={
              <Button asChild size="sm" variant="outline">
                <Link href="/research">Go to Research</Link>
              </Button>
            }
          />
        </section>
      </div>

      <section aria-labelledby="activity" className="space-y-3">
        <h2 id="activity" className="text-sm font-medium tracking-tight">
          Activity
        </h2>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div className="space-y-1">
              <CardTitle className="text-sm">Agent status</CardTitle>
              <CardDescription>
                The provider this server resolved, and the runs it has executed.
              </CardDescription>
            </div>

            <StatusIndicator tone={providerTone} label={providerLabel} />
          </CardHeader>

          <CardContent>
            {executions.length === 0 ? (
              <EmptyState
                icon={Activity}
                title="No activity yet"
                description="Runs are held in memory, so this lists what this instance has executed since it started. Start a workspace task and it will appear here."
              />
            ) : (
              <ul className="divide-y divide-border">
                {executions.slice(0, MAX_LISTED_RUNS).map((execution) => {
                  const presentation = STATUS_PRESENTATION[execution.status];

                  return (
                    <li
                      key={execution.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm">{execution.objective}</p>
                        <StatusIndicator
                          tone={presentation.tone}
                          label={presentation.label}
                        />
                      </div>

                      <p className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {execution.completedStepCount}/{execution.stepCount}{" "}
                        step(s) ·{" "}
                        {new Date(execution.createdAt).toLocaleString()}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
