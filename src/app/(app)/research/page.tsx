import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { ResearchConsole } from "@/components/research/research-console";

export const metadata: Metadata = {
  title: "Research",
};

/**
 * Research — where a user asks Orion a question and reads what the sources say.
 *
 * The page itself is a server component that renders one client component and
 * nothing else, mirroring the workspace page: all the interactivity lives in
 * `ResearchConsole`, because the question form and the result panel share the
 * record they produce and that state has to live above both of them.
 *
 * **What changed here in Phase 5.** This page previously rendered a disabled
 * search box and an empty list, and both were honest then: nothing had been
 * researched, so there was no index to search. There is still no index — §20
 * rules out search over findings, and nothing here searches anything — but the
 * disabled box is gone because the page now has a real job. A control that
 * announces an absent capability sitting beside a working form reads as a broken
 * feature rather than as a deliberate boundary, and the boundary is stated
 * instead where it is actually enforced: retrieval is either configured or the
 * console says it is not, before a question is asked.
 *
 * The recent-research list below the console comes from `GET /api/research` and
 * is therefore real or empty. It is never populated with samples — see the note
 * on `ProjectsPage` for why that rule holds everywhere in this application.
 */
export default function ResearchPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Research"
        description="Ask a question. Orion plans the retrieval, searches for each task, and reports what the sources it found actually say — quoting them, so every claim can be checked."
      />

      <ResearchConsole />
    </div>
  );
}
