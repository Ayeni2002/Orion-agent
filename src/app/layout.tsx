import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Orion — Autonomous AI Research Agent",
    template: "%s · Orion",
  },
  description:
    "Orion turns complex goals into structured, researched, actionable results.",
};

/**
 * The root layout carries document concerns only — `<html>`, `<body>`, fonts
 * and metadata. It deliberately renders no chrome, because the two surfaces
 * below it need different frames:
 *
 *   `/`  — `MarketingShell`, a top bar for the public landing page
 *   (app) — `AppShell`, sidebar navigation for application pages
 *
 * Putting either shell here would force the other to opt out of it.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-svh antialiased">{children}</body>
    </html>
  );
}
