"use client";

import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  QUESTION_MAX_LENGTH,
  researchRequestSchema,
} from "@/lib/validation/research";

/**
 * Research question capture.
 *
 * Validation runs the same Zod schema the API validates against, so a malformed
 * question is caught while it is being typed rather than after a round trip. The
 * server still validates — this is a courtesy to the user, not a substitute for
 * validating untrusted input at the boundary.
 *
 * The component does not perform the request itself. It validates, hands a
 * string to `onSubmit`, and renders whatever `isSubmitting` and `error` say.
 * Same division as the workspace's objective form, for the same reason: the
 * form stays free of transport concerns.
 *
 * **Why the button can be disabled, and why that is not a fake control.**
 * `canRetrieve` is read from `/api/research/capabilities`, so a build with no
 * retrieval configured shows a disabled button beside an alert naming the
 * variables to set. The alternative — enabling it and letting every run fail
 * with `search_not_configured` — would spend a request to tell the user
 * something the page already knew before they typed. The disabled state is never
 * silent: the alert above the form is the explanation.
 *
 * While the capabilities request is still in flight the form is *enabled*, so
 * the button does not flash disabled and back. Absent information is not the
 * same as bad news.
 */

export interface ResearchFormProps {
  onSubmit: (question: string) => void;
  isSubmitting: boolean;
  /** A failure from the transport or the server, shown next to the field. */
  error: string | null;
  /** False only once capabilities have been read and reported no retrieval. */
  canRetrieve: boolean;
}

export function ResearchForm({
  onSubmit,
  isSubmitting,
  error,
  canRetrieve,
}: ResearchFormProps) {
  const fieldId = useId();
  const errorId = `${fieldId}-error`;

  const [question, setQuestion] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const shownError = validationError ?? error;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = researchRequestSchema.safeParse({ question });

    if (!parsed.success) {
      setValidationError(
        parsed.error.issues[0]?.message ?? "That question is not valid.",
      );
      return;
    }

    setValidationError(null);
    onSubmit(parsed.data.question);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-4">
          <label htmlFor={fieldId} className="text-sm font-medium">
            Question
          </label>
          <span className="text-xs tabular-nums text-muted-foreground">
            {question.trim().length}/{QUESTION_MAX_LENGTH}
          </span>
        </div>

        <Textarea
          id={fieldId}
          name="question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="e.g. What do the published evaluations say about retrieval-augmented generation for long-document question answering?"
          aria-invalid={shownError !== null}
          aria-describedby={shownError !== null ? errorId : undefined}
          className="min-h-32"
        />

        {shownError !== null ? (
          <p id={errorId} role="alert" className="text-sm text-destructive">
            {shownError}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Button type="submit" disabled={isSubmitting || !canRetrieve}>
          {isSubmitting ? "Researching…" : "Research this"}
        </Button>

        <p className="text-xs text-muted-foreground">
          Orion breaks the question into retrieval tasks, searches for each one,
          and reports what the sources it found actually say — quoting them, so
          every claim can be checked against the text it came from.
        </p>
      </div>
    </form>
  );
}
