import type { ReactNode } from "react";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";

/**
 * The application frame: sidebar on desktop, disclosure menu on mobile, and a
 * main content area between them.
 *
 * This is the single shell for every authenticated-style route. It is applied
 * by `src/app/(app)/layout.tsx` rather than by the root layout, because the
 * landing page at `/` is a marketing surface and should not carry app chrome.
 *
 * A route that later needs a genuinely different frame (a full-bleed workspace,
 * say) should add its own layout inside the group rather than grow conditionals
 * here.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col lg:flex-row">
      <AppSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav />

        <main id="main" className="flex-1 px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
