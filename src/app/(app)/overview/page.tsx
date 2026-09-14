import { Activity, ArrowRight, FileText, Folder } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusIndicator } from "@/components/common/status-indicator";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Overview",
};

/**
 * The Orion dashboard.
 *
 * Every section here renders an empty state, because no backend exists yet.
 * That is deliberate: a dashboard showing invented counts and fabricated
 * activity would misrepresent what the product does, and the first honest
 * signal about progress is that these panels are genuinely waiting for data.
 */
export default function OverviewPage() {
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
                Runs, tool calls and evaluations will be listed here.
              </CardDescription>
            </div>

            <StatusIndicator tone="idle" label="Engine not implemented" />
          </CardHeader>

          <CardContent>
            <EmptyState
              icon={Activity}
              title="No activity yet"
              description="Start a workspace task to begin. Until the agent engine ships, nothing is executed and nothing is recorded."
            />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
