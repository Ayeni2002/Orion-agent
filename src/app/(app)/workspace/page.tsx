import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { ExecutionPanel } from "@/components/workspace/execution-panel";
import { ObjectiveForm } from "@/components/workspace/objective-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Workspace",
};

/**
 * The agent workspace — where a user gives Orion an objective.
 *
 * Two columns on wide screens: the objective on the left where it is typed, and
 * the execution/activity/results stack on the right where the answer will
 * appear. They collapse to one column below `lg`.
 */
export default function WorkspacePage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Workspace"
        description="Describe what you want Orion to research. This is where the agent will plan, act and report once the engine exists."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Objective</CardTitle>
            <CardDescription>
              Be specific about what you want to know and what a useful answer
              would contain.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <ObjectiveForm />
          </CardContent>
        </Card>

        <ExecutionPanel />
      </div>
    </div>
  );
}
