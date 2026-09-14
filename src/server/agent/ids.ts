/**
 * Identifier generation for engine artefacts.
 *
 * Every id the engine mints goes through here so ids are recognisable in a log
 * at a glance (`step_3f2a…` rather than a bare UUID). The prefix is part of the
 * debugging surface, which is why it is required rather than optional.
 *
 * `crypto.randomUUID` is used rather than a counter: execution state outlives a
 * single request in the store, and a counter would collide across the
 * concurrent runs a server handles.
 */
export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

/** ISO 8601 timestamp. All engine timestamps are strings — see `src/types/agent.ts`. */
export function now(): string {
  return new Date().toISOString();
}
