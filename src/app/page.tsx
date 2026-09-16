import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { MarketingShell } from "@/components/layout/marketing-shell";
import { SplineHero } from "@/components/marketing/spline-hero";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <MarketingShell>
      {/*
        The hero copy lives here rather than inside `SplineHero` so this page
        keeps ownership of its own words; the component owns the layout and the
        3D only. The colours are fixed neutrals instead of theme tokens because
        the scene behind them is a permanently dark surface — `text-foreground`
        is near-black in light mode and would vanish into it.
      */}
      <SplineHero>
        <div className="mx-auto w-full max-w-3xl px-4 text-center sm:px-6">
          <h1 className="bg-gradient-to-b from-neutral-50 to-neutral-400 bg-clip-text text-5xl font-semibold tracking-tight text-transparent sm:text-7xl">
            ORION
          </h1>

          <p className="mt-4 text-lg font-medium text-neutral-200">
            Autonomous AI Research Agent
          </p>

          <p className="mt-6 text-base text-neutral-400">
            Orion is being built to turn complex goals into structured,
            researched, actionable results — understanding an objective, planning
            the work, selecting the right tools, and evaluating what comes back.
          </p>

          {/*
            `pointer-events-auto` on each button, not on the row: the row is
            wider than the two buttons and would leave a dead strip across the
            gap between them. See the pointer-events contract in `SplineHero`.

            Both buttons are styled explicitly rather than by variant, for the
            same reason the copy above is. `variant="default"` paints
            `--primary`, which in light mode is oklch(0.205 0 0) — a near-black
            button on a near-black hero. The tokens invert with the theme but
            this surface does not, so a token-based button is unreadable in one
            of the two modes whichever variant it picks.
          */}
          <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
            <Button
              asChild
              size="lg"
              className="pointer-events-auto bg-white text-neutral-900 hover:bg-neutral-200"
            >
              <Link href="/overview">
                Open Orion
                <ArrowRight aria-hidden />
              </Link>
            </Button>

            <Button
              asChild
              size="lg"
              variant="outline"
              className="pointer-events-auto border-white/20 bg-white/10 text-white backdrop-blur-sm hover:bg-white/20 hover:text-white"
            >
              <Link href="/workspace">Go to Workspace</Link>
            </Button>
          </div>
        </div>
      </SplineHero>

      {/*
        Below the fold, back on the ordinary page background — so this note and
        anything added later keep using the normal theme tokens.
      */}
      <div className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6">
        <p className="mx-auto max-w-2xl text-center text-xs text-muted-foreground">
          Orion plans the objective into steps, calls the tools it needs, and
          records what each step produced. The verdict is computed from those
          step outcomes — never written by the model.
        </p>
      </div>
    </MarketingShell>
  );
}
