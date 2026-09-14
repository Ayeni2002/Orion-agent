import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { WorkspaceConsole } from "@/components/workspace/workspace-console";

export const metadata: Metadata = {
  title: "Workspace",
};

/**
 * The agent workspace — where a user gives Orion an objective.
 *
 * The page itself is a server component that renders one client component and
 * nothing else. All the interactivity lives in `WorkspaceConsole`, because the
 * objective form and the execution panel share the execution they produce and
 * that state has to live above both of them.
 */
export default function WorkspacePage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Workspace"
        description="Describe what you want Orion to research. Orion plans the objective, runs each step and reports what happened."
      />

      <WorkspaceConsole />
    </div>
  );
}
