import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";

/**
 * The application route group.
 *
 * Every section listed in `src/lib/navigation.ts` lives under here, so the
 * sidebar shell is applied once rather than per page. The parentheses keep the
 * group out of the URL: `(app)/overview/page.tsx` serves `/overview`.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
