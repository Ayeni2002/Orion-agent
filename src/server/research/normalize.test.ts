import { describe, expect, it } from "vitest";

import { sourceFixture } from "./provider/stub-provider";
import { normalizeSources, resolveSourceIds } from "./normalize";

/**
 * Normalisation and deduplication, §11 and §14.
 *
 * The subject here is not "does it remove duplicates" — that is the easy half.
 * It is the alias map, which is what stops deduplication from breaking §13's
 * chain: a finding that cited a document the run had already seen must still
 * resolve to a source that is in the result. The tests below check the alias
 * property from both ends, because a deduplicator that dropped duplicates
 * cleanly would pass a naive count test and leave dangling citations behind.
 */

const URL_A = "https://example.org/a";
const URL_B = "https://example.org/b";

describe("normalizeSources", () => {
  describe("with nothing known yet", () => {
    it("accepts everything and records no duplicates", () => {
      const incoming = [sourceFixture(URL_A), sourceFixture(URL_B)];
      const result = normalizeSources(incoming, []);

      expect(result.accepted.map((source) => source.url)).toStrictEqual([
        URL_A,
        URL_B,
      ]);
      expect(result.duplicateCount).toBe(0);
      expect([...result.aliasBySourceId]).toStrictEqual([]);
    });

    it("accepts nothing when nothing was retrieved", () => {
      const result = normalizeSources([], []);

      expect(result.accepted).toStrictEqual([]);
      expect(result.duplicateCount).toBe(0);
    });
  });

  describe("within one task's results", () => {
    it("collapses the same URL returned twice", () => {
      const first = sourceFixture(URL_A);
      const second = sourceFixture(URL_A);

      const result = normalizeSources([first, second], []);

      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0]?.id).toBe(first.id);
      expect(result.duplicateCount).toBe(1);
    });

    it("aliases the duplicate to the one it kept", () => {
      const first = sourceFixture(URL_A);
      const second = sourceFixture(URL_A);

      const result = normalizeSources([first, second], []);

      expect(result.aliasBySourceId.get(second.id)).toBe(first.id);
    });

    it("keeps the first of the two, so rank order is what decides", () => {
      const first = sourceFixture(URL_A, { title: "First" });
      const second = sourceFixture(URL_A, { title: "Second" });

      const result = normalizeSources([first, second], []);

      expect(result.accepted[0]?.title).toBe("First");
    });
  });

  describe("across tasks", () => {
    it("recognises a document a previous task already retrieved", () => {
      const known = sourceFixture(URL_A);
      const incoming = sourceFixture(URL_A);

      const result = normalizeSources([incoming], [known]);

      expect(result.accepted).toStrictEqual([]);
      expect(result.duplicateCount).toBe(1);
      expect(result.aliasBySourceId.get(incoming.id)).toBe(known.id);
    });

    it("still accepts genuinely new documents alongside a duplicate", () => {
      const known = sourceFixture(URL_A);
      const repeat = sourceFixture(URL_A);
      const fresh = sourceFixture(URL_B);

      const result = normalizeSources([repeat, fresh], [known]);

      expect(result.accepted.map((source) => source.url)).toStrictEqual([URL_B]);
      expect(result.duplicateCount).toBe(1);
    });

    it("seeds from the run without aliasing the known sources themselves", () => {
      const known = sourceFixture(URL_A);
      const result = normalizeSources([], [known]);

      // A source already in the run is not a duplicate of itself.
      expect(result.duplicateCount).toBe(0);
      expect([...result.aliasBySourceId]).toStrictEqual([]);
    });
  });

  describe("what counts as the same document", () => {
    it("ignores a tracking parameter", () => {
      const known = sourceFixture(URL_A);
      const incoming = sourceFixture(`${URL_A}?utm_source=newsletter`);

      expect(normalizeSources([incoming], [known]).duplicateCount).toBe(1);
    });

    it("ignores a fragment", () => {
      const known = sourceFixture(URL_A);
      const incoming = sourceFixture(`${URL_A}#results`);

      expect(normalizeSources([incoming], [known]).duplicateCount).toBe(1);
    });

    it("ignores parameter order", () => {
      const known = sourceFixture("https://example.org/s?a=1&b=2");
      const incoming = sourceFixture("https://example.org/s?b=2&a=1");

      expect(normalizeSources([incoming], [known]).duplicateCount).toBe(1);
    });

    it("treats a different path as a different document", () => {
      const known = sourceFixture(URL_A);
      const incoming = sourceFixture("https://example.org/a/part-two");

      expect(normalizeSources([incoming], [known]).duplicateCount).toBe(0);
    });

    it("treats a parameter it does not know as significant", () => {
      const known = sourceFixture("https://example.org/list?page=1");
      const incoming = sourceFixture("https://example.org/list?page=2");

      // Merging these would silently discard a real source.
      expect(normalizeSources([incoming], [known]).duplicateCount).toBe(0);
    });

    it("treats a different host as a different document", () => {
      const known = sourceFixture("https://example.org/a");
      const incoming = sourceFixture("https://mirror.example.org/a");

      expect(normalizeSources([incoming], [known]).duplicateCount).toBe(0);
    });

    it("compares two malformed URLs equal only when they are identical", () => {
      const known = sourceFixture(URL_A);
      const broken = { ...known, url: "not a url" };

      // Falls back to the trimmed lowercase string, so this compares to itself
      // and not to the well-formed source it was derived from.
      expect(normalizeSources([broken], [known]).duplicateCount).toBe(0);
      expect(normalizeSources([{ ...broken }], [broken]).duplicateCount).toBe(1);
    });
  });

  describe("the alias map's invariant", () => {
    it("never maps a duplicate to another duplicate", () => {
      const first = sourceFixture(URL_A);
      const second = sourceFixture(URL_A);
      const third = sourceFixture(URL_A);

      const result = normalizeSources([first, second, third], []);
      const keptIds = new Set(result.accepted.map((source) => source.id));

      // Every alias target is a source that is actually in the accepted list,
      // which is what makes resolving a single hop sufficient.
      for (const target of result.aliasBySourceId.values()) {
        expect(keptIds.has(target)).toBe(true);
      }
    });

    it("maps both duplicates to the same kept source", () => {
      const first = sourceFixture(URL_A);
      const second = sourceFixture(URL_A);
      const third = sourceFixture(URL_A);

      const result = normalizeSources([first, second, third], []);

      expect(result.aliasBySourceId.get(second.id)).toBe(first.id);
      expect(result.aliasBySourceId.get(third.id)).toBe(first.id);
      expect(result.duplicateCount).toBe(2);
    });

    it("does not alias a source to itself", () => {
      const only = sourceFixture(URL_A);
      const result = normalizeSources([only], [only]);

      expect(result.aliasBySourceId.has(only.id)).toBe(false);
    });
  });
});

describe("resolveSourceIds", () => {
  it("returns the ids unchanged when there is nothing to resolve", () => {
    expect(resolveSourceIds(["a", "b"], new Map())).toStrictEqual(["a", "b"]);
  });

  it("rewrites a duplicate to the source that was kept", () => {
    const aliases = new Map([["duplicate", "kept"]]);

    expect(resolveSourceIds(["duplicate"], aliases)).toStrictEqual(["kept"]);
  });

  it("leaves an id with no alias alone rather than dropping it", () => {
    const aliases = new Map([["duplicate", "kept"]]);

    // A citation the run cannot resolve is still a citation; silently removing
    // it would turn a dangling reference into a missing one.
    expect(resolveSourceIds(["original", "duplicate"], aliases)).toStrictEqual([
      "original",
      "kept",
    ]);
  });

  it("collapses two citations of the same document into one", () => {
    const aliases = new Map([["duplicate", "kept"]]);

    // One direct citation and one through a duplicate is one source supporting
    // the finding, not two.
    expect(resolveSourceIds(["kept", "duplicate"], aliases)).toStrictEqual(["kept"]);
  });

  it("returns an empty list for an empty list", () => {
    expect(resolveSourceIds([], new Map())).toStrictEqual([]);
  });

  it("stops on a self-referencing alias instead of looping", () => {
    expect(resolveSourceIds(["a"], new Map([["a", "a"]]))).toStrictEqual(["a"]);
  });

  it("terminates on an alias cycle rather than hanging", () => {
    // Not reachable through `normalizeSources`, whose aliases are single-hop by
    // construction. Asserted anyway: the walk is bounded precisely so that a
    // later edit which breaks that construction degrades into a wrong answer
    // rather than an infinite loop.
    const aliases = new Map([
      ["a", "b"],
      ["b", "a"],
    ]);

    expect(resolveSourceIds(["a"], aliases)).toHaveLength(1);
  });

  it("preserves the order it was given", () => {
    const aliases = new Map([["second", "two"]]);

    expect(resolveSourceIds(["first", "second", "third"], aliases)).toStrictEqual([
      "first",
      "two",
      "third",
    ]);
  });
});
