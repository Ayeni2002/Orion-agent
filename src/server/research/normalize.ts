import type { ResearchSource } from "@/types/research";

import { parseSourceUrl } from "./url-safety";

/**
 * Source normalisation and deduplication.
 *
 * §11 asks that every retrieval path produce one shape, and §14 asks that the
 * same document retrieved twice be one source. Both are here because they are
 * the same job seen from two sides: normalising is what makes two retrievals
 * comparable, and deduplicating is what comparing them is for.
 *
 * **What normalisation happens here, and what already happened.** The search
 * tool has done the per-source work by this point — vetting the URL, deriving
 * the domain from it, truncating the passage, stamping the provider. What is
 * left, and what only a run-level view can do, is decide whether two sources
 * from two different tasks are the same document. That is this module.
 *
 * **Why deduplication must produce aliases rather than merely dropping.**
 * Dropping a duplicate is easy; the difficulty is everything that already
 * points at it. A second task retrieves the same page, the model extracts a
 * finding from it and cites the duplicate's id — and if the duplicate is simply
 * discarded, that citation now names a source that is not in the result. §13
 * requires Finding → Evidence → Source → URL to be walkable, and a hop to a
 * nonexistent source is a chain that ends in nothing.
 *
 * So the alias map is the actual product of this module. `aliasBySourceId`
 * records, for every duplicate, which kept source now represents it, and
 * `resolveSourceIds` walks a finding's citations through it. A finding that
 * cited only duplicates keeps its `basis: "source"` and its evidence, pointing
 * at the one source that was kept — which is the truth: the text that supports
 * it is that document, and it was retrieved twice.
 *
 * **Aliases are single-hop by construction.** A duplicate always aliases to a
 * source that is in the accepted list, never to another duplicate, so resolving
 * never needs to follow a chain. `resolveSourceIds` still bounds its walk,
 * because "by construction" is a claim about code that a later edit can
 * invalidate and a bounded walk costs nothing.
 */

export interface NormalizeSourcesResult {
  /** Sources to add to the run, in the order they were first seen. */
  accepted: ResearchSource[];
  /**
   * Duplicate id → the id that now represents it. Never maps to another key.
   *
   * A `ReadonlyMap` because it is used transiently within a run and never
   * serialised: it is not part of `ResearchResult`, and making it a plain object
   * would suggest it crosses a boundary.
   */
  aliasBySourceId: ReadonlyMap<string, string>;
  /** How many incoming sources were already known. Reported, not hidden. */
  duplicateCount: number;
}

/**
 * The key two sources are compared on.
 *
 * Re-canonicalised defensively even though the search tool has already done it.
 * The cost is one URL parse per source, and what it buys is that deduplication
 * stays correct if a future retrieval path reaches this module without going
 * through the tool — which is exactly the kind of assumption that holds until
 * someone adds the second path.
 *
 * Falling back to the trimmed lowercase URL when the URL does not parse means a
 * malformed source compares equal only to an identical malformed one. Two
 * different broken URLs stay two sources, which is the conservative direction:
 * wrongly merging two sources loses one, wrongly keeping both is visible.
 */
function sourceKey(source: ResearchSource): string {
  const vetted = parseSourceUrl(source.url);

  return vetted.ok ? vetted.url : source.url.trim().toLowerCase();
}

/**
 * Merges incoming sources into the run, dropping documents already seen.
 *
 * `known` is the run's source list so far; `incoming` is what one task just
 * retrieved. Duplicates *within* `incoming` are collapsed too, which is the case
 * a retrieval service produces when the same page ranks for two of its own
 * sub-queries.
 *
 * Takes no limit, and that is deliberate. The run's `maxSourcesTotal` is enforced
 * by sizing each search call to the room remaining before the call is made — see
 * the research service — rather than by retrieving and then discarding. A limit
 * applied after retrieval would either throw away material that was already paid
 * for or, worse, leave findings citing sources that were dropped for being over
 * a ceiling nobody told the model about.
 */
export function normalizeSources(
  incoming: readonly ResearchSource[],
  known: readonly ResearchSource[],
): NormalizeSourcesResult {
  const accepted: ResearchSource[] = [];
  const aliasBySourceId = new Map<string, string>();

  // Canonical URL → the id that represents it. Seeded from the run so a
  // duplicate of a source found three tasks ago is recognised.
  const byUrl = new Map<string, string>();

  for (const source of known) {
    const key = sourceKey(source);

    if (!byUrl.has(key)) {
      byUrl.set(key, source.id);
    }
  }

  let duplicateCount = 0;

  for (const source of incoming) {
    const key = sourceKey(source);
    const existingId = byUrl.get(key);

    if (existingId !== undefined) {
      // The same document, already in the run. Recorded, not added.
      if (existingId !== source.id) {
        aliasBySourceId.set(source.id, existingId);
      }

      duplicateCount += 1;
      continue;
    }

    byUrl.set(key, source.id);
    accepted.push(source);
  }

  return { accepted, aliasBySourceId, duplicateCount };
}

/** How many alias hops are followed before giving up. See the module header. */
const MAX_ALIAS_HOPS = 8;

/**
 * Rewrites source ids through the alias map, dropping unresolvable ones.
 *
 * Deduplicates as it goes: a finding that cited the same document twice — once
 * directly and once through a duplicate — ends up citing it once, which is what
 * the reader would expect and what `ResearchFinding.sourceIds` promises.
 */
export function resolveSourceIds(
  sourceIds: readonly string[],
  aliasBySourceId: ReadonlyMap<string, string>,
): string[] {
  const resolved: string[] = [];

  for (const sourceId of sourceIds) {
    let current = sourceId;

    for (let hop = 0; hop < MAX_ALIAS_HOPS; hop += 1) {
      const next = aliasBySourceId.get(current);

      if (next === undefined || next === current) {
        break;
      }

      current = next;
    }

    if (!resolved.includes(current)) {
      resolved.push(current);
    }
  }

  return resolved;
}
