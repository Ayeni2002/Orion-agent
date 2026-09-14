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
 * Validation is real — it runs the same Zod schema the run endpoint will use,
 * and it is the only part of this form that does anything. Submission does not
 * call a model, start a task or store anything, and the notice says so rather
 * than showing progress for work that is not happening.
 *
 * The project selector is present but disabled: there are no projects to select
 * because nothing persists yet, and an enabled control that silently discarded
 * the choice would be worse than one that admits it is not ready.
 */
export function ObjectiveForm() {
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const projectId = `${fieldId}-project`;

  const [objective, setObjective] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    const parsed = objectiveSchema.safeParse({ objective });

    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ?? "That objective is not valid.",
      );
      return;
    }

    setError(null);
    setNotice(
      "Objective validated. Orion's agent engine is not implemented yet, so nothing was planned, executed or stored — that arrives with the next phase.",
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
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
          className="min-h-40"
        />

        {error !== null ? (
          <p id={errorId} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <label htmlFor={projectId} className="text-sm font-medium">
          Project <span className="text-muted-foreground">(optional)</span>
        </label>

        <select
          id={projectId}
          name="project"
          disabled
          aria-describedby={`${projectId}-hint`}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">No projects available</option>
        </select>

        <p id={`${projectId}-hint`} className="text-xs text-muted-foreground">
          Projects cannot be assigned yet — creating one does not persist until a
          later phase.
        </p>
      </div>

      <div className="space-y-2">
        <Button type="submit">Start Agent</Button>

        <p className="text-xs text-muted-foreground">
          Agent execution is not implemented. This validates your objective and
          stops.
        </p>
      </div>

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
