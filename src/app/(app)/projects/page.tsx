import { Folder, Plus } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ProjectCard, type ProjectCardProps } from "@/components/projects/project-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const metadata: Metadata = {
  title: "Projects",
};

/**
 * Projects group related research.
 *
 * `projects` is an empty list, not a placeholder one: no store exists, so there
 * is genuinely nothing to show and the empty state is the honest rendering. The
 * list below is wired for the real thing — when persistence lands, this
 * constant is replaced by a query and nothing else here changes.
 */
const projects: readonly ProjectCardProps[] = [];

export default function ProjectsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Projects"
        description="Organise research into projects so a long-running objective stays in one place."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New project</CardTitle>
          <CardDescription>
            Not available yet — creating a project does not persist until a
            later phase, so this form is disabled rather than accepting input it
            would discard.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <label htmlFor="project-name" className="text-sm font-medium">
                Project name
              </label>

              <Input
                id="project-name"
                name="project-name"
                placeholder="e.g. Grid-scale storage review"
                disabled
              />
            </div>

            <Button type="button" disabled>
              <Plus aria-hidden />
              Create project
            </Button>
          </form>
        </CardContent>
      </Card>

      <section aria-labelledby="project-list" className="space-y-3">
        <h2 id="project-list" className="text-sm font-medium tracking-tight">
          All projects
        </h2>

        {projects.length === 0 ? (
          <EmptyState
            icon={Folder}
            title="No projects yet"
            description="When projects can be created, they will be listed here."
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {projects.map((project) => (
              <li key={project.name}>
                <ProjectCard {...project} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
