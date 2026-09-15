import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { MarketingShell } from "@/components/layout/marketing-shell";
import { SplineHero } from "@/components/marketing/spline-hero";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <MarketingShell>
      <div className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
        <section className="mx-auto max-w-3xl text-center">
          <h1 className="text-5xl font-semibold tracking-tight sm:text-7xl">
            ORION
          </h1>

          <p className="mt-4 text-lg font-medium">
            Autonomous AI Research Agent
          </p>

          <p className="mt-6 text-base text-muted-foreground">
            Orion is being built to turn complex goals into structured,
            researched, actionable results — understanding an objective, planning
            the work, selecting the right tools, and evaluating what comes back.
          </p>

          <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/overview">
                Open Orion
                <ArrowRight aria-hidden />
              </Link>
            </Button>

            <Button asChild size="lg" variant="outline">
              <Link href="/workspace">Go to Workspace</Link>
            </Button>
          </div>
        </section>

        <div className="mt-16">
          <SplineHero />
        </div>

        <p className="mx-auto mt-16 max-w-2xl text-center text-xs text-muted-foreground">
          Phase 2 provides the application shell only. The workspace collects an
          objective; planning, tool execution and results arrive in later phases.
        </p>
      </div>
    </MarketingShell>
  );
}
