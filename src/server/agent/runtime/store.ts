import type { AgentExecution } from "@/types/agent";

/**
 * Process-local execution store.
 *
 * **This knowingly departs from `docs/ARCHITECTURE.md` §10**, which says nothing
 * that must survive a request may live in process memory. The reason is that
 * there is nowhere else to put it: the persistence phase has not been built, and
 * Phase 3 is scoped to the engine, not to storage. The alternative was to build
 * a database, which is a different phase's work.
 *
 * The consequence, stated plainly so no one is surprised by it: a stored
 * execution is visible only from the process that ran it. It does not survive a
 * restart, it is not shared between instances, and on a serverless platform a
 * later request may well land somewhere that has never heard of the execution it
 * is asking about. Reads that miss are reported as not found rather than
 * reconstructed, because reconstructing them would mean inventing a result.
 *
 * Execution itself does not depend on this store: a run completes inside the
 * request that started it and returns its full state, events and result in the
 * response. The store exists so a caller can look a recent run up again. Losing
 * it degrades convenience, not correctness.
 *
 * Replacing this with a real repository is the intended fix, and the surface is
 * deliberately small enough to swap: three functions, no callers reaching past
 * them, and no engine module importing this file.
 */

/**
 * Upper bound on retained executions.
 *
 * An unbounded Map in a long-lived server process is a memory leak with a
 * friendly name. Fifty is far more than the workspace UI needs and small enough
 * that the worst case is bounded. Oldest-first eviction is fine here because the
 * store is a convenience cache, not a system of record.
 */
export const MAX_RETAINED_EXECUTIONS = 50;

const executions = new Map<string, AgentExecution>();

export function saveExecution(execution: AgentExecution): void {
  // Delete before setting so that re-saving moves the entry to the end of the
  // Map's insertion order. Without this, an execution that was just updated
  // would still be evicted first if it happened to be written earliest.
  executions.delete(execution.id);
  executions.set(execution.id, execution);

  while (executions.size > MAX_RETAINED_EXECUTIONS) {
    const oldest = executions.keys().next();

    if (oldest.done === true) {
      break;
    }

    executions.delete(oldest.value);
  }
}

export function getExecution(id: string): AgentExecution | undefined {
  return executions.get(id);
}

/** Most recently written first — the order the workspace lists them in. */
export function listExecutions(): AgentExecution[] {
  return [...executions.values()].reverse();
}

/** Test-only. Keeps cases independent of each other's runs. */
export function clearExecutions(): void {
  executions.clear();
}
