/**
 * URL vetting for retrieved sources.
 *
 * Every URL in this system arrives from outside Orion — from a retrieval
 * service, which got it from the open web. So none of it is trusted, and this
 * module is the single place that decides whether a URL may enter the pipeline
 * at all.
 *
 * **What this protects against today, stated precisely, because §24 of the
 * Phase 5 brief raises SSRF and the honest answer is narrower than "we are
 * SSRF-proof".** Orion does not dereference a source URL. Nothing in this phase
 * fetches a URL that came back from retrieval; retrieval happens inside the
 * provider, and what returns is text and links, not a resource Orion then asks
 * for. So there is no request to steer today, and claiming this module prevents
 * SSRF would be claiming a defence against an attack that has no path.
 *
 * What it does prevent is real and immediate:
 *
 *   - **A dangerous scheme reaching a renderer.** `javascript:`, `data:` and
 *     `file:` URLs are stored on sources, returned from `/api/research`, and
 *     displayed in the workspace. A `javascript:` URL that survives to an anchor
 *     is script execution in the reader's session. Rejecting the scheme at the
 *     boundary is the control that matters, and it is the reason this runs
 *     before anything is recorded rather than at render time.
 *   - **Credentials smuggled in a URL.** `https://user:pass@host/` puts a secret
 *     in a field that gets logged, stored and rendered. It is refused, not
 *     stripped, because a URL carrying credentials is not the document it
 *     claims to be.
 *   - **Internal destinations being recorded as sources.** `http://localhost:3000/admin`
 *     is not a source. Recording one would put an internal hostname into a
 *     result a user reads and, in a future phase that does fetch, into a request
 *     Orion makes from inside the deployment network.
 *
 * That last point is why the guard is here rather than deferred: if a later
 * phase adds fetching, the check is already on the path every URL must take, and
 * the only change needed is to keep calling it. Deferring it until a fetcher
 * exists would mean writing it under time pressure next to the code it must
 * constrain.
 *
 * **The check runs after `new URL`, never before.** The WHATWG parser is what
 * normalises most of the evasions: `http://0x7f.1/`, `http://2130706433/` and
 * `http://127.1/` all become `127.0.0.1` under it. Matching raw strings against
 * a list of private ranges would miss every one of those; matching the parsed
 * host does not. Reversing the order would silently reintroduce all three.
 *
 * The parser does *not* do that for an IPv4-mapped IPv6 literal, and the
 * difference is worth stating because it is where this module used to be wrong.
 * `http://[::ffff:127.0.0.1]/` is serialised as `[::ffff:7f00:1]` — hex
 * hextets, no dotted quad — so decoding the embedded IPv4 address is this
 * module's job and not the parser's. `ipv4FromIpv6` does it.
 */

/** Why a URL was refused. A closed set, so a caller can switch on it exhaustively. */
export type SourceUrlRejection =
  | "malformed"
  | "unsupported_protocol"
  | "embedded_credentials"
  | "internal_host";

export interface AcceptedSourceUrl {
  /** The canonical form. Two URLs that canonicalise alike are the same source. */
  url: string;
  /** The host, lowercased, without a leading `www.`. */
  domain: string;
}

export type SourceUrlResult =
  | ({ ok: true } & AcceptedSourceUrl)
  | { ok: false; reason: SourceUrlRejection };

/**
 * Query parameters removed during canonicalisation.
 *
 * These are campaign and click-tracking parameters: they are appended by
 * whatever linked to a page and never change which document is served. Two URLs
 * differing only in these are the same source, and treating them as two is a
 * deduplication failure that shows up as a duplicated citation.
 *
 * The list is deliberately short and consists only of parameters whose meaning
 * is known. A general `utm_*` prefix match covers the standard family; anything
 * outside it is left alone, because a parameter this module does not recognise
 * might be load-bearing — `?page=2` and `?v=3` are different documents, and a
 * deduplicator that guessed otherwise would silently discard a real source.
 */
const TRACKING_PARAMETERS = ["fbclid", "gclid", "mc_cid", "mc_eid", "ref_src"];

function isTrackingParameter(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_PARAMETERS.includes(lower);
}

/**
 * Whether a hostname names a destination inside a private network.
 *
 * Covers loopback, link-local, the private IPv4 blocks, carrier-grade NAT,
 * benchmarking and IETF-reserved ranges, IPv6 loopback and unique-local, and
 * single-label hostnames such as `localhost`, `intranet` or `wiki` — which have
 * no public DNS meaning and resolve internally by convention.
 *
 * **Not an exhaustive implementation of the special-purpose address
 * registries**, and it does not claim to be. It is a deny list of the ranges
 * that matter in practice, and the property it has is the useful one: it fails
 * closed on anything it recognises and is checked on every URL rather than on
 * the URLs someone remembered to check. An address range it does not list is a
 * gap, and the gap is recorded here rather than papered over.
 */
function isInternalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();

  if (isInternalIpv6(host)) {
    return true;
  }

  const bare = host.replace(/^\[|\]$/g, "");

  // A public IPv6 literal is not internal just because it contains no dot, so
  // the dot rules below must not see one. `isInternalIpv6` has already decided
  // the IPv6 question by this point, and its answer was no.
  if (bare.includes(":")) {
    return false;
  }

  // A single label with no dot is not a public name. `localhost` is the common
  // case; `intranet`, `wiki` and `api` are the same shape.
  if (!bare.includes(".")) {
    return true;
  }

  // `.local` is mDNS, `.internal` and `.home.arpa` are the reserved internal
  // names. `.localhost` is reserved by RFC 6761 in every form.
  if (
    bare.endsWith(".local") ||
    bare.endsWith(".internal") ||
    bare.endsWith(".home.arpa") ||
    bare.endsWith(".localhost")
  ) {
    return true;
  }

  return isInternalIpv4(bare);
}

function isInternalIpv6(hostname: string): boolean {
  if (!hostname.includes(":")) {
    return false;
  }

  const bare = hostname.replace(/^\[|\]$/g, "");

  if (bare === "::" || bare === "::1") {
    return true;
  }

  // fc00::/7 unique-local, fe80::/10 link-local. Matched on the leading hextet,
  // which is exact for these two ranges.
  if (/^f[cd][0-9a-f]{0,2}:/.test(bare) || /^fe[89ab][0-9a-f]?:/.test(bare)) {
    return true;
  }

  // An IPv4-mapped address such as ::ffff:127.0.0.1 is loopback wearing a
  // different hat, so the IPv4 rules are applied to the address it embeds.
  //
  // Two paths, and the second is not redundant. The URL parser serialises an
  // IPv4-mapped literal into hex hextets, so `[::ffff:127.0.0.1]` arrives here
  // as `::ffff:7f00:1` — with no dotted quad anywhere in it. `ipv4FromIpv6`
  // decodes that; the dotted match behind it covers any form that does keep the
  // quad spelled out. Looking only for the dotted form, which is what this
  // function used to do, silently accepted the loopback-mapped address.
  const embedded = ipv4FromIpv6(bare);

  if (embedded !== undefined) {
    return isInternalIpv4(embedded);
  }

  const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(bare);
  return dotted?.[1] === undefined ? false : isInternalIpv4(dotted[1]);
}

/** The eight hextets of an IPv6 literal, or undefined if it is not one. */
function expandHextets(address: string): number[] | undefined {
  const halves = address.split("::");

  if (halves.length > 2) {
    return undefined;
  }

  const parse = (part: string): number[] | undefined => {
    if (part.length === 0) {
      return [];
    }

    const values: number[] = [];

    for (const group of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) {
        return undefined;
      }

      values.push(Number.parseInt(group, 16));
    }

    return values;
  };

  const head = parse(halves[0] ?? "");
  const tail = halves.length === 2 ? parse(halves[1] ?? "") : [];

  if (head === undefined || tail === undefined) {
    return undefined;
  }

  if (halves.length === 1) {
    return head.length === 8 ? head : undefined;
  }

  // `::` stands for at least one zero hextet, which is what makes `::` and
  // `::1` distinct from a full eight-group address.
  const missing = 8 - head.length - tail.length;

  if (missing < 1) {
    return undefined;
  }

  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

/**
 * The IPv4 address an IPv6 literal embeds, for the forms that embed one.
 *
 * `::ffff:a.b.c.d` is IPv4-mapped and `::a.b.c.d` is IPv4-compatible; both mean
 * "this address is that IPv4 address". Recognised by the leading six hextets
 * being zero, with the fifth allowed to be `ffff`. Everything else — including
 * a public IPv6 address, whose leading hextets are not zero — returns
 * undefined, so the caller falls through rather than being told a public
 * address is internal.
 */
function ipv4FromIpv6(address: string): string | undefined {
  const groups = expandHextets(address);

  if (groups === undefined || groups.length !== 8) {
    return undefined;
  }

  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0] = groups;

  const embedsIpv4 =
    a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && (f === 0 || f === 0xffff);

  if (!embedsIpv4) {
    return undefined;
  }

  return `${g >> 8}.${g & 0xff}.${h >> 8}.${h & 0xff}`;
}

function isInternalIpv4(hostname: string): boolean {
  const parts = hostname.split(".");

  if (parts.length !== 4) {
    return false;
  }

  const octets = parts.map((part) => Number(part));

  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  const [a = -1, b = -1] = octets;

  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT

  return false;
}

/**
 * Vets and canonicalises a URL that arrived from retrieval.
 *
 * Returns a value rather than throwing: a rejected URL is an ordinary outcome
 * when reading the open web, and one bad link among twenty should drop that link
 * and leave the other nineteen alone. A throw here would make a single hostile
 * URL capable of failing an entire research run.
 *
 * **The parameter is `unknown`, and that is the contract rather than a
 * convenience.** This is the one function in Orion that accepts a value from
 * outside the process and returns a verdict on it, so its job is to be total:
 * every input gets a `SourceUrlResult` back, and no input makes it throw. It
 * used to take a `string` and call `.trim()` on it unguarded, which meant a
 * provider returning `{ url: null }` — the kind of thing a replacement adapter
 * does by accident — would raise a `TypeError` inside a tool and fail a run
 * with a message about nothing. The call sites all pass strings today, so that
 * path is closed by their care rather than by this function's; a boundary that
 * relies on its callers being careful is not a boundary. Widening the input
 * costs nothing: the output type is unchanged, and nothing downstream can see
 * the difference.
 *
 * Canonicalisation, in order: lowercase the host, drop a default port, drop
 * tracking parameters, sort the remaining parameters, drop the fragment, and
 * normalise an empty path to `/`. Sorting matters for deduplication —
 * `?a=1&b=2` and `?b=2&a=1` are the same document, and without it they survive
 * as two sources. The fragment is dropped because `#section-3` names a position
 * within a document, not a different document.
 */
export function parseSourceUrl(raw: unknown): SourceUrlResult {
  if (typeof raw !== "string") {
    return { ok: false, reason: "malformed" };
  }

  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return { ok: false, reason: "malformed" };
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  // Checked on the parsed protocol, so `JavaScript:` and `java\tscript:` — which
  // the parser folds to the same scheme — are refused identically.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "unsupported_protocol" };
  }

  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return { ok: false, reason: "embedded_credentials" };
  }

  if (isInternalHost(parsed.hostname)) {
    return { ok: false, reason: "internal_host" };
  }

  const kept = [...parsed.searchParams.entries()]
    .filter(([name]) => !isTrackingParameter(name))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

  const search = new URLSearchParams(kept).toString();

  const canonical = `${parsed.protocol}//${parsed.host}${parsed.pathname}${
    search.length === 0 ? "" : `?${search}`
  }`;

  return {
    ok: true,
    url: canonical,
    domain: parsed.hostname.toLowerCase().replace(/^www\./, ""),
  };
}
