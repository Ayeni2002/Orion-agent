"use client";

import { FileText, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  findReportForResearch,
  readErrorMessage,
  readReport,
  readReportSummaries,
} from "@/lib/reports/view";
import type { ReportSummary } from "@/types/report";

/**
 * The way a report is made: from a finished research run, and nothing else.
 *
 * §17 asks for a report to be generatable from an actual research result, and
 * this component is the whole of that entry point. It takes a `researchId`, and
 * there is deliberately no other way to reach `POST /api/reports` from the
 * interface — no "new report" button on the reports page, no blank document to
 * fill in. A report whose research cannot be named is a report with no findings,
 * and the one thing this application must not offer is a way to produce one.
 *
 * **It asks before it offers.** On mount it reads `GET /api/reports` to see
 * whether this record already has one, and if it does the action becomes "View
 * report" rather than "Generate report". §22 asks the interface not to regenerate
 * a report that exists; the server would reuse the existing document anyway, so
 * this is not what prevents the work — it is what stops the interface *offering*
 * work that will not happen, which is the difference between a rule and an honest
 * button. The check is an optimisation and never a gate: if it fails, the button
 * still works, because a failed lookup is not a reason to refuse.
 *
 * **The model preference is a real one, not a setting-shaped decoration.** With it
 * unchecked the request carries `useModel: false`, and the report is built
 * entirely from recorded data with no inference call — reproducible, free, and
 * every sentence traceable to a source. That is a genuinely different document,
 * which is why it is offered rather than buried.
 *
 * Generation is synchronous, so there is no progress here and no percentage: while
 * the request is in flight the button says a report is being written, and when it
 * returns the report is complete and this navigates to it. §13 rules out invented
 * progress in as many words, and there is nothing to invent — there is one step.
 */
export function GenerateReportButton({
  researchId,
}: {
  researchId: string;
}) {
  const router = useRouter();
  const [existing, setExisting] = useState<ReportSummary | undefined>(undefined);
  const [isChecking, setIsChecking] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [useModel, setUseModel] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    async function findExisting() {
      try {
        const response = await fetch("/api/reports", {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload: unknown = await response.json();

        if (!response.ok) {
          return;
        }

        const summaries = readReportSummaries(payload);

        if (summaries !== undefined) {
          setExisting(findReportForResearch(summaries, researchId));
        }
      } catch {
        // A failed lookup is not a refusal. The button stays available and the
        // server reuses any existing report when the request arrives.
      } finally {
        if (!controller.signal.aborted) {
          setIsChecking(false);
        }
      }
    }

    void findExisting();

    return () => {
      controller.abort();
    };
  }, [researchId]);

  async function generate() {
    setIsGenerating(true);
    setError(undefined);

    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ researchId, useModel }),
      });

      const payload: unknown = await response.json();

      if (!response.ok) {
        setError(
          readErrorMessage(
            payload,
            "Orion could not generate a report from this research run.",
          ),
        );
        return;
      }

      const report = readReport(payload);

      if (report === undefined) {
        setError("Orion returned a report in a shape this page did not expect.");
        return;
      }

      router.push(`/reports/${report.id}`);
    } catch {
      setError(
        "Orion could not be reached. The report was not generated, and the research result is unchanged.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  if (existing !== undefined) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="outline" size="sm">
          <Link href={`/reports/${existing.id}`}>
            <FileText aria-hidden className="size-4" />
            View report
          </Link>
        </Button>
        <p className="text-xs text-muted-foreground">
          A report was already generated from this run. Opening it reuses it
          rather than generating a second one.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          onClick={() => void generate()}
          disabled={isGenerating || isChecking}
        >
          {isGenerating ? (
            <Loader2 aria-hidden className="size-4 animate-spin" />
          ) : (
            <RefreshCw aria-hidden className="size-4" />
          )}
          {isGenerating ? "Writing the report…" : "Generate report"}
        </Button>

        <p className="text-xs text-muted-foreground" aria-live="polite">
          {isGenerating
            ? "Reading the research record and assembling the document. This finishes in one step, so there is no partial report to show."
            : isChecking
              ? "Checking whether this run already has a report…"
              : "Turns this research result into a document you can read, print and return to."}
        </p>
      </div>

      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={useModel}
          onChange={(event) => {
            setUseModel(event.target.checked);
          }}
          disabled={isGenerating}
          className="mt-0.5 size-3.5 shrink-0 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
        <span>
          Let a model write the summary and analysis. Unchecked, the report is
          assembled entirely from the research record — no model is called, and
          every sentence is one the run already established.
        </span>
      </label>

      {error === undefined ? null : (
        <p
          role="alert"
          className="rounded-md border border-destructive/50 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  );
}
