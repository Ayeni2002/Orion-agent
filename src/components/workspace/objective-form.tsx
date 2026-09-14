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
 * Validation runs the same Zod schema the API validates against, so a
 * malformed objective is caught while it is being typed rather than after a
 * round trip. The server still validates — this is a courtesy to the user, not
 * a substitute for validating untrusted input at the boundary.
 *
 * The component does not perform the request itself. It validates, hands a
 * string to `onSubmit`, and renders whatever `isSubmitting` and `error` say.
 *
 * The project selector remains disabled. No projects persist yet, and an
 * enabled control that silently discarded the choice would be worse than one
 * that admits it is not ready.
 */

export interface ObjectiveFormProps {
  onSubmit: (objective: string) => void;
  isSubmitting: boolean;
  /** A failure from the transport or the server, shown next to the field. */
  error: string | null;
}

export function ObjectiveForm({
  onSubmit,
  isSubmitting,
  error,
}: ObjectiveFormProps) {
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const projectId = `${fieldId}-project`;

  const [objective, setObjective] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const shownError = validationError ?? error;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = objectiveSchema.safeParse({ objective });

    if (!parsed.success) {
      setValidationError(
        parsed.error.issues[0]?.message ?? "That objective is not valid.",
      );
      return;
    }

    setValidationError(null);
    onSubmit(parsed.data.objective);
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
          aria-invalid={shownError !== null}
          aria-describedby={shownError !== null ? errorId : undefined}
          className="min-h-40"
        />

        {shownError !== null ? (
          <p id={errorId} role="alert" className="text-sm text-destructive">
            {shownError}
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
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Running…" : "Start Agent"}
        </Button>

        <p className="text-xs text-muted-foreground">
          Orion plans the objective, runs each step and reports what happened.
          The run completes before the response returns, so there is nothing to
          wait for afterwards.
        </p>
      </div>
    </form>
  );
}
