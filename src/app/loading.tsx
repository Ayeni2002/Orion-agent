/**
 * Route-level loading state.
 *
 * Deliberately plain — Phase 1 has no data fetching whose shape would justify
 * a bespoke skeleton. Later phases should replace this with per-route
 * `loading.tsx` files that mirror the layout they are standing in for.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6">
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 text-sm text-muted-foreground"
      >
        <span
          aria-hidden
          className="size-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"
        />
        Loading…
      </div>
    </div>
  );
}
