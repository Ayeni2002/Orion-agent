"use client";

import { useCallback, useEffect, useState } from "react";

import type { AgentExecution, EngineCapabilities } from "@/types/agent";

import { ExecutionPanel } from "./execution-panel";
import { ObjectiveForm } from "./objective-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * The workspace's interactive half.
 *
 * Owns the one piece of state the form and the panel share — the execution —
 * and owns the request that produces it. Splitting it this way keeps the form
 * free of transport concerns and the panel free of state, so each can be read
 * on its own terms.
 *
 * There is no polling and no streaming. A run completes inside the request that
 * starts it, so the `POST` response *is* the finished execution: when it
 * arrives, everything the panel shows is already final. A spinner is shown for
 * the duration of that request and then removed, rather than animating a
 * progress bar the server never reported.
 */

/** Reads the `error` field from an error response, falling back to a safe string. */
function readErrorMessage(payload: unknown): string {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const message = (payload as { error?: unknown }).error;

    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }

  return "The execution could not be started.";
}

/** Reads the `execution` field, or returns undefined if the body is not shaped as expected. */
function readExecution(payload: unknown): AgentExecution | undefined {
  if (typeof payload === "object" && payload !== null && "execution" in payload) {
    return (payload as { execution?: AgentExecution }).execution;
  }

  return undefined;
}

export function WorkspaceConsole() {
  const [execution, setExecution] = useState<AgentExecution | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<EngineCapabilities | null>(
    null,
  );

  // Fetched once, in the browser. Deliberately not read during the server
  // render: a static build would bake in the build machine's environment, which
  // can differ from the one the app actually runs in.
  useEffect(() => {
    let active = true;

    async function loadCapabilities() {
      try {
        const response = await fetch("/api/agent/capabilities");

        if (!response.ok) {
          return;
        }

        const payload: unknown = await response.json();

        if (
          active &&
          typeof payload === "object" &&
          payload !== null &&
          "registeredTools" in payload
        ) {
          setCapabilities(payload as EngineCapabilities);
        }
      } catch {
        // The notice is an optimisation, not a requirement. If it cannot be
        // fetched, the workspace still works and the engine still reports the
        // same facts per execution.
      }
    }

    void loadCapabilities();

    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = useCallback(async (objective: string) => {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/agent/executions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objective }),
      });

      const payload: unknown = await response.json();

      if (!response.ok) {
        setError(readErrorMessage(payload));
        return;
      }

      const started = readExecution(payload);

      if (started === undefined) {
        setError("The server returned a response Orion did not understand.");
        return;
      }

      setExecution(started);
    } catch {
      // A network failure, or a body that was not JSON. The engine itself
      // reports its own failures inside a 201 response, so reaching here means
      // the request never completed — which is worth saying plainly instead of
      // leaving the previous execution on screen as though it were current.
      setError(
        "Orion could not be reached. Check your connection and try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  const configurationError = capabilities?.configurationError;

  // Read through the optional chain once, rather than relying on the JSX
  // conditions below to narrow `capabilities` for each other.
  const hasNoTools =
    capabilities !== null &&
    configurationError === undefined &&
    capabilities.registeredTools.length === 0;

  return (
    <div className="space-y-6">
      {configurationError === undefined ? null : (
        <p
          role="alert"
          className="rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive"
        >
          The model provider is misconfigured, so every run will fail:{" "}
          {configurationError}
        </p>
      )}

      {hasNoTools ? (
        <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          No tools are registered in this build. Orion will plan and run
          reasoning steps, but any step needing an external capability — web
          search, for instance — will be reported as unavailable rather than
          carried out.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Objective</CardTitle>
            <CardDescription>
              Be specific about what you want to know and what a useful answer
              would contain.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <ObjectiveForm
              onSubmit={handleSubmit}
              isSubmitting={isSubmitting}
              error={error}
            />
          </CardContent>
        </Card>

        <ExecutionPanel execution={execution} isSubmitting={isSubmitting} />
      </div>
    </div>
  );
}
