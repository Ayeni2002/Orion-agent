import { Activity, ListChecks, Sparkles } from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
import { StatusIndicator } from "@/components/common/status-indicator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * The task, activity and results column of the workspace.
 *
 * Everything here is an empty state, and that is the honest rendering: there is
 * no executor, so no plan is produced, no tool runs and no result exists. When
 * the engine lands, each panel is driven by `AgentTask`, `TaskStep` and
 * `ToolExecution` from `src/types/agent.ts` — the vocabulary is already in
 * place, which is why this panel names the stages it will show rather than
 * inventing placeholder output.
 */
export function ExecutionPanel() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-sm">Execution</CardTitle>
            <CardDescription>Plan, steps and tool calls.</CardDescription>
          </div>

          <StatusIndicator tone="idle" label="Idle" />
        </CardHeader>

        <CardContent>
          <EmptyState
            icon={ListChecks}
            title="Nothing running"
            description="Once the agent engine exists, Orion's plan and each step it takes will appear here as the task runs."
          />
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
          <EmptyState
            icon={Activity}
            title="No activity yet"
            description="Start a workspace task to begin."
            className="py-8"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Results</CardTitle>
          <CardDescription>
            The structured answer, with the evidence behind it.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <EmptyState
            icon={Sparkles}
            title="No results yet"
            description="Orion's findings will be reported here, and saved as a report you can return to."
            className="py-8"
          />
        </CardContent>
      </Card>
    </div>
  );
}
