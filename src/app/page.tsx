import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
      <section className="mx-auto max-w-3xl text-center">
        <h1 className="text-5xl font-semibold tracking-tight sm:text-7xl">
          ORION
        </h1>

        <p className="mt-4 text-lg font-medium">
          Autonomous AI Research Agent
        </p>

        <p className="mt-6 text-base text-muted-foreground">
          Orion is being built to turn complex goals into structured, researched,
          actionable results — understanding an objective, planning the work,
          selecting the right tools, and evaluating what comes back.
        </p>

        <div className="mt-10 flex justify-center">
          <Button asChild size="lg">
            <Link href="/workspace">
              Open Workspace
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      </section>

      <p className="mx-auto mt-16 max-w-2xl text-center text-xs text-muted-foreground">
        Phase 1 establishes the foundation only. The workspace collects an
        objective; planning, tool execution and results arrive in later phases.
      </p>
    </div>
  );
}
