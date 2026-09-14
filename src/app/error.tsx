"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary.
 *
 * Renders a fixed message rather than `error.message`: in production that
 * string can carry internal detail, and Next already withholds it for
 * server-side errors. `error.digest` is the supported way to correlate what
 * the user saw with the server log.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-start gap-4 px-4 py-24 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        Something went wrong
      </h1>

      <p className="text-sm text-muted-foreground">
        An unexpected error occurred. Try again, and if it keeps happening the
        reference below will help trace it.
      </p>

      {error.digest ? (
        <p className="font-mono text-xs text-muted-foreground">
          Reference: {error.digest}
        </p>
      ) : null}

      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
