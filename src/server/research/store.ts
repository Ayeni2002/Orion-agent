import type { ResearchRecord } from "@/types/research";

/**
 * Process-local research store.
 *
 * The same deliberate departure `agent/runtime/store.ts` records, for the same
 * reason and with the same consequences: the persistence phase has not been
 * built, so a stored record is visible only from the process that produced it,
 * does not survive a restart, and is not shared between instances. A read that
 * misses is reported as not found rather than reconstructed, because
 * reconstructing one would mean inventing research nobody carried out.
 *
 * A second store rather than a shared one, because a `ResearchRecord` and an
 * `AgentExecution` are different entities with different lifetimes and different
 * list projections. Forcing them into one map would mean a union type at every
 * read, and the first read to pick the wrong branch would be a bug in the
 * workspace rather than in a query. What is *not* duplicated is the state
 * machinery: a research run tracks its progress through the Phase 3
 * `ExecutionStateBuilder` and logs its events through the Phase 3 `EventLog`.
 * This file is a container, not a second state system.
 */

/**
 * Upper bound on retained records.
 *
 * Lower than the execution store's fifty, because a research record is much
 * larger: it carries every retrieved passage, not just step outputs. An
 * unbounded Map in a long-lived process is a memory leak with a friendly name,
 * and the size of the entries is what sets how many are safe.
 */
export const MAX_RETAINED_RESEARCH = 20;

const records = new Map<string, ResearchRecord>();

export function saveResearch(record: ResearchRecord): void {
  // Delete before setting so a re-saved record moves to the end of the Map's
  // insertion order, exactly as the execution store does — otherwise a record
  // that was just updated would still be evicted first for having been written
  // earliest.
  records.delete(record.id);
  records.set(record.id, record);

  while (records.size > MAX_RETAINED_RESEARCH) {
    const oldest = records.keys().next();

    if (oldest.done === true) {
      break;
    }

    records.delete(oldest.value);
  }
}

export function getResearch(id: string): ResearchRecord | undefined {
  return records.get(id);
}

/** Most recently written first — the order the workspace lists them in. */
export function listResearch(): ResearchRecord[] {
  return [...records.values()].reverse();
}

/** Test-only. Keeps cases independent of each other's runs. */
export function clearResearch(): void {
  records.clear();
}
