import type { ReactNode } from "react";

import { SiteHeader } from "@/components/layout/site-header";

/**
 * Application chrome shared by every route: navigation, a flexible main
 * content area, and a footer. Route groups that later need a different frame
 * (for example a full-bleed workspace) should add their own layout rather than
 * growing conditionals here.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 text-xs text-muted-foreground sm:px-6">
          Orion — Phase 1 foundation. The agent engine is not implemented yet.
        </div>
      </footer>
    </div>
  );
}
