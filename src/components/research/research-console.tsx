"use client";

import { useCallback, useEffect, useState } from "react";

import { ResearchCard } from "@/components/research/research-card";
import { ResearchForm } from "@/components/research/research-form";
import { ResearchPanel } from "@/components/research/research-panel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  ResearchCapabilities,
  ResearchRecord,
  ResearchSummary,
} from "@/types/research";

/**
 * The research console — the interactive half of the research page.
 *
 * Owns the state the form and the panel share and owns the requests that
 * produce it, the same division `WorkspaceConsole` makes. The form stays free of
 * transport concerns; the panel stays free of state.
 *
 * **No polling, no streaming, no simulated progress.** A research run finishes
 * inside the request that starts it, so the `POST` response *is* the finished
 * record. When it arrives, every value the panel shows is already final. The
 * submitting state is a real one — a request genuinely in flight — and the panel
 * says so in words rather than animating a bar the server never reported. §19
 * rules out fake progress and this is what obeying it looks like: the only
 * progress the UI can show is the event log of a run that has already finished.
 *
 * **Retrieval is reported before a question is asked.** The capabilities fetch
 * runs on mount, so a build with no search configured shows the alert and
 * disables the form instead of letting a user wait for a run that was always
 * going to report `search_not_configured`. That is §9's honesty requirement
 * applied where it is cheapest for the user.
 */

/** Reads the `error` field from an error response, falling back to a safe string. */
function readErrorMessage(payload: unknown): string {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const message = (payload as { error?: unknown }).error;

    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }

  return "The research could not be started.";
}

/** Reads the `research` field, or returns undefined if the body is not shaped as expected. */
function readRecord(payload: unknown): ResearchRecord | undefined {
  if (typeof payload === "object" && payload !== null && "research" in payload) {
    return (payload as { research?: ResearchRecord }).research;
  }

  return undefined;
}

function readSummaries(payload: unknown): ResearchSummary[] | undefined {
  if (typeof payload === "object" && payload !== null && "research" in payload) {
    const value = (payload as { research?: unknown }).research;
    return Array.isArray(value) ? (value as ResearchSummary[]) : undefined;
  }

  return undefined;
}

/**
 * What the console says about retrieval before a question is asked.
 *
 * Read from `/api/research/capabilities` rather than assumed, so the notice
 * cannot fall out of step with what a run will actually do. It names the
 * variables to set because the alternative — "search is not configured" with no
 * next step — leaves an operator with nothing to act on.
 */
function RetrievalNotice({ capabilities }: { capabilities: ResearchCapabilities }) {
  if (capabilities.searchConfigured) {
    return (
      <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Retrieval:</span>{" "}
        {capabilities.provider?.label ?? "configured"}. A research run may call{" "}
        <code className="font-mono text-xs">{capabilities.toolId}</code>, which
        holds{" "}
        {capabilities.grantedCapabilities.map((capability, index) => (
          <span key={capability}>
            {index === 0 ? null : ", "}
            <code className="font-mono text-xs">{capability}</code>
          </span>
        ))}{" "}
        for the duration of that run and nothing else. Every run is capped at{" "}
        {capabilities.limits.maxTasks} tasks,{" "}
        {capabilities.limits.maxSourcesPerTask} sources per task and{" "}
        {capabilities.limits.maxSourcesTotal} sources overall.
      </p>
    );
  }

  return (
    <div
      role="alert"
      className="space-y-2 rounded-md border border-amber-500/50 px-3 py-2 text-sm"
    >
      <p className="font-medium">Web search is not configured</p>

      <p className="text-muted-foreground">
        Research needs to retrieve sources, and this build has no retrieval
        provider. A run would stop before planning and report{" "}
        <code className="font-mono text-xs">search_not_configured</code> — so the
        form below is disabled rather than letting you wait for a result that was
        never going to arrive.
      </p>

      <p className="text-muted-foreground">
        To enable it, set{" "}
        <code className="font-mono text-xs">LLM_API_STYLE</code> to{" "}
        <code className="font-mono text-xs">openai</code> and point{" "}
        <code className="font-mono text-xs">LLM_ENDPOINT</code> at a service that
        provides search, along with{" "}
        <code className="font-mono text-xs">LLM_MODEL</code> and{" "}
        <code className="font-mono text-xs">LLM_API_KEY</code>.
      </p>

      {capabilities.configurationError === undefined ? null : (
        <p className="text-muted-foreground">
          Reported problem: {capabilities.configurationError}
        </p>
      )}
    </div>
  );
}

export function ResearchConsole() {
  const [record, setRecord] = useState<ResearchRecord | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<ResearchCapabilities | null>(
    null,
  );
  const [recent, setRecent] = useState<readonly ResearchSummary[]>([]);

  const loadRecent = useCallback(async () => {
    try {
      const response = await fetch("/api/research");

      if (!response.ok) {
        return;
      }

      const summaries = readSummaries(await response.json());

      if (summaries !== undefined) {
        setRecent(summaries);
      }
    } catch {
      // The recent list is informational. Its absence must not stop a question
      // from being asked.
    }
  }, []);

  // Fetched once, in the browser. Deliberately not read during the server
  // render: a static build would bake in the build machine's environment, which
  // can differ from the one the app actually runs in.
  useEffect(() => {
    let active = true;

    async function loadCapabilities() {
      try {
        const response = await fetch("/api/research/capabilities");

        if (!response.ok) {
          return;
        }

        const payload: unknown = await response.json();

        if (
          active &&
          typeof payload === "object" &&
          payload !== null &&
          "searchConfigured" in payload
        ) {
          setCapabilities(payload as ResearchCapabilities);
        }
      } catch {
        // The notice is an optimisation, not a requirement. If it cannot be
        // fetched the form stays enabled and the engine still reports the same
        // fact per run.
      }
    }

    void loadCapabilities();
    void loadRecent();

    return () => {
      active = false;
    };
  }, [loadRecent]);

  const handleSubmit = useCallback(
    async (question: string) => {
      setIsSubmitting(true);
      setError(null);

      try {
        const response = await fetch("/api/research", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question }),
        });

        const payload: unknown = await response.json();

        if (!response.ok) {
          setError(readErrorMessage(payload));
          return;
        }

        const started = readRecord(payload);

        if (started === undefined) {
          setError("The server returned a response Orion did not understand.");
          return;
        }

        setRecord(started);
        await loadRecent();
      } catch {
        // A network failure, or a body that was not JSON. The engine reports its
        // own failures inside a 201 response, so reaching here means the request
        // never completed — worth saying plainly rather than leaving the
        // previous record on screen as though it were current.
        setError(
          "Orion could not be reached. Check your connection and try again.",
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [loadRecent],
  );

  // Disabled only once capabilities have been read and reported no retrieval.
  // Before that the answer is unknown, and unknown is not the same as no.
  const canRetrieve = capabilities === null || capabilities.searchConfigured;

  return (
    <div className="space-y-6">
      {capabilities === null ? null : (
        <RetrievalNotice capabilities={capabilities} />
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Question</CardTitle>
            <CardDescription>
              Ask something the sources can answer. Orion reports what they say,
              not what it thinks.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <ResearchForm
              onSubmit={handleSubmit}
              isSubmitting={isSubmitting}
              error={error}
              canRetrieve={canRetrieve}
            />
          </CardContent>
        </Card>

        <ResearchPanel record={record} isSubmitting={isSubmitting} />
      </div>

      <section aria-labelledby="recent-research" className="space-y-3">
        <h2 id="recent-research" className="text-sm font-medium tracking-tight">
          Recent research
        </h2>

        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing has been researched in this session yet.
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {recent.map((item) => (
              <li key={item.id}>
                <ResearchCard
                  title={item.question}
                  source={`${item.provider.label} · ${item.sourceCount} source(s) · ${item.findingCount} finding(s)`}
                  {...(item.summary === undefined ? {} : { summary: item.summary })}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
