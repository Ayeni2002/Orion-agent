"use client";

import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  OBJECTIVE_MAX_LENGTH,
  objectiveSchema,
} from "@/lib/validation/objective";

/**
 * Objective capture for the workspace.
 *
 * Phase 1 stops at validation. There is no planner, no tool runtime, no model
 * call and no persistence — submitting says so plainly rather than showing a
 * progress indicator for work that is not happening. The Zod schema is real
 * and shared, so the same rules will apply when the run endpoint exists.
 */
export function ObjectiveForm() {
  const fieldId = useId();
  const errorId = `${fieldId}-error`;

  const [objective, setObjective] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    const parsed = objectiveSchema.safeParse({ objective });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "That objective is not valid.");
      return;
    }

    setError(null);
    setNotice(
      "Objective captured. The agent engine is not implemented yet — Phase 1 establishes the foundation only, so nothing was sent or stored.",
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-4">
          <label htmlFor={fieldId} className="text-sm font-medium">
            Objective
          </label>
          <span className="text-xs tabular-nums text-muted-foreground">
            {objective.trim().length}/{OBJECTIVE_MAX_LENGTH}
          </span>
        </div>

        <Textarea
          id={fieldId}
          name="objective"
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
          placeholder="e.g. Compare the leading approaches to grid-scale storage and report the trade-offs."
          aria-invalid={error !== null}
          aria-describedby={error !== null ? errorId : undefined}
          className="min-h-32"
        />

        {error !== null ? (
          <p id={errorId} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      <Button type="submit">Start Agent</Button>

      <div aria-live="polite">
        {notice !== null ? (
          <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
            {notice}
          </p>
        ) : null}
      </div>
    </form>
  );
}
