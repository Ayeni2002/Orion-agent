import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Orion — Autonomous AI Research Agent",
    template: "%s · Orion",
  },
  description:
    "Orion turns complex goals into structured, researched, actionable results.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-svh antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
