import { FileText, Search } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import {
  ResearchCard,
  type ResearchCardProps,
} from "@/components/research/research-card";
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
  title: "Research",
};

/**
 * Research gathered by Orion.
 *
 * The search and filter controls are present but disabled. There is nothing to
 * search, and an enabled box that silently ignored input would suggest a
 * working index behind it. `items` is genuinely empty rather than filled with
 * samples — see the note on `ProjectsPage`.
 */
const items: readonly ResearchCardProps[] = [];

export default function ResearchPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Research"
        description="Findings Orion has gathered, with the sources behind them."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Search</CardTitle>
          <CardDescription>
            Not available yet — nothing has been researched, so there is no
            index to search.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1">
              <label htmlFor="research-search" className="sr-only">
                Search research
              </label>

              <Input
                id="research-search"
                type="search"
                placeholder="Search findings…"
                disabled
              />
            </div>

            <Button type="button" variant="outline" disabled>
              <Search aria-hidden />
              Filter
            </Button>
          </div>
        </CardContent>
      </Card>

      <section aria-labelledby="research-list" className="space-y-3">
        <h2 id="research-list" className="text-sm font-medium tracking-tight">
          Findings
        </h2>

        {items.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No research yet"
            description="Start a workspace task to begin. Findings appear here once Orion has run an objective, and each one links through to the report it belongs to."
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {items.map((item) => (
              <li key={item.title}>
                <ResearchCard {...item} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
