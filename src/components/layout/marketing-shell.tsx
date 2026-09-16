import type { ReactNode } from "react";

import { SiteHeader } from "@/components/layout/site-header";

/**
 * The frame for public pages.
 *
 * Deliberately not `AppShell`: the landing page is a marketing surface with a
 * simple top bar, not an application surface with navigation between sections.
 * Keeping them separate is what stops one shell growing conditionals to serve
 * both.
 */
export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-1 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>Orion — autonomous AI research agent.</p>
          <p>Planning, tool use and evaluation run live. Retrieval needs an OpenRouter key.</p>
        </div>
      </footer>
    </div>
  );
}
