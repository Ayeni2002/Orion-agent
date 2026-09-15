import { describe, expect, it } from "vitest";

import { parseSourceUrl } from "./url-safety";

/**
 * The URL guard, tested against the evasions it exists to stop.
 *
 * §24 of the Phase 5 brief raises SSRF, and the honest scope of this module is
 * stated in its header: Orion does not dereference a source URL in this phase,
 * so this is not an SSRF defence today. What it *is* is the single gate every
 * URL must pass before it is recorded, returned over HTTP or rendered as a link,
 * and the tests below are grouped by which of those three outcomes each rule
 * protects.
 *
 * The address tests are the ones worth reading closely. A deny list matched
 * against raw strings would miss every one of the alternate encodings below —
 * `http://2130706433/` is `127.0.0.1` to a resolver and an opaque string to a
 * regex. They pass because the check runs on the *parsed* host, and the tests
 * that assert it are what would fail if someone later moved the check above the
 * `new URL` call.
 */

describe("parseSourceUrl", () => {
  describe("URLs that are accepted", () => {
    it("accepts an ordinary https URL and reports its domain", () => {
      expect(parseSourceUrl("https://example.org/report")).toStrictEqual({
        ok: true,
        url: "https://example.org/report",
        domain: "example.org",
      });
    });

    it("accepts http, which most of the open web still is", () => {
      expect(parseSourceUrl("http://example.org/").ok).toBe(true);
    });

    it("lowercases the host and strips a leading www", () => {
      const result = parseSourceUrl("https://WWW.Example.ORG/x");

      expect(result.ok && result.domain).toBe("example.org");
    });

    it("keeps a subdomain, because it is part of the domain", () => {
      const result = parseSourceUrl("https://blog.example.org/x");

      expect(result.ok && result.domain).toBe("blog.example.org");
    });

    it("normalises an empty path to a slash", () => {
      const result = parseSourceUrl("https://example.org");

      expect(result.ok && result.url).toBe("https://example.org/");
    });

    it("drops a default port", () => {
      const result = parseSourceUrl("https://example.org:443/x");

      expect(result.ok && result.url).toBe("https://example.org/x");
    });

    it("drops the fragment, which names a position and not a document", () => {
      const result = parseSourceUrl("https://example.org/x#section-3");

      expect(result.ok && result.url).toBe("https://example.org/x");
    });
  });

  describe("canonicalisation, which is what deduplication keys on", () => {
    it("strips the utm_ family", () => {
      const result = parseSourceUrl(
        "https://example.org/page?utm_source=news&utm_campaign=spring",
      );

      expect(result.ok && result.url).toBe("https://example.org/page");
    });

    it("strips the tracking parameters named outside that family", () => {
      const result = parseSourceUrl("https://example.org/page?fbclid=abc123");

      expect(result.ok && result.url).toBe("https://example.org/page");
    });

    it("sorts the parameters it keeps, so order is not a difference", () => {
      const left = parseSourceUrl("https://example.org/s?b=2&a=1");
      const right = parseSourceUrl("https://example.org/s?a=1&b=2");

      expect(left.ok && left.url).toBe(right.ok && right.url);
    });

    it("keeps a parameter it does not recognise, because it may load content", () => {
      // `?page=2` is a different document. A deduplicator that guessed otherwise
      // would silently discard a real source.
      const result = parseSourceUrl("https://example.org/list?page=2");

      expect(result.ok && result.url).toBe("https://example.org/list?page=2");
    });

    it("treats two URLs differing only in tracking as one source", () => {
      const plain = parseSourceUrl("https://example.org/page");
      const tracked = parseSourceUrl("https://example.org/page?utm_medium=email");

      expect(plain.ok && tracked.ok && plain.url === tracked.url).toBe(true);
    });
  });

  describe("dangerous schemes, which must not reach a renderer", () => {
    it.each([
      ["javascript:", "javascript:alert(1)"],
      ["data:", "data:text/html,<script>alert(1)</script>"],
      ["file:", "file:///etc/passwd"],
      ["ftp:", "ftp://example.org/pub"],
    ])("rejects %s", (_label, url) => {
      expect(parseSourceUrl(url)).toStrictEqual({
        ok: false,
        reason: "unsupported_protocol",
      });
    });

    it("rejects a scheme obfuscated with embedded characters", () => {
      // The parser folds these to `javascript:` before the scheme is inspected,
      // which is why the check is on `parsed.protocol` and not on the raw text.
      expect(parseSourceUrl("java\tscript:alert(1)")).toStrictEqual({
        ok: false,
        reason: "unsupported_protocol",
      });
    });

    it("rejects a mixed-case scheme", () => {
      expect(parseSourceUrl("JavaScript:alert(1)").ok).toBe(false);
    });

    it("rejects a relative URL, which has no scheme to check", () => {
      expect(parseSourceUrl("/admin").ok).toBe(false);
    });
  });

  describe("credentials smuggled in a URL", () => {
    it("rejects a URL with a username and password", () => {
      expect(parseSourceUrl("https://user:pass@example.org/x")).toStrictEqual({
        ok: false,
        reason: "embedded_credentials",
      });
    });

    it("rejects a URL with only a username", () => {
      expect(parseSourceUrl("https://user@example.org/x")).toStrictEqual({
        ok: false,
        reason: "embedded_credentials",
      });
    });

    it("refuses rather than stripping, because the URL is not what it claims", () => {
      // Stripping would produce a working link to the wrong thing and hide that
      // a credential was in the field at all.
      const result = parseSourceUrl("https://user:pass@example.org/x");

      expect(result.ok).toBe(false);
    });
  });

  describe("internal destinations", () => {
    it.each([
      ["loopback", "http://127.0.0.1:3000/admin"],
      ["private 10/8", "http://10.0.0.5/internal"],
      ["private 192.168/16", "http://192.168.1.1/router"],
      ["private 172.16/12", "http://172.16.0.1/x"],
      ["link-local", "http://169.254.169.254/latest/meta-data/"],
      ["this-network", "http://0.0.0.0/"],
      ["carrier-grade NAT", "http://100.64.0.1/x"],
      ["IPv6 loopback", "http://[::1]:8080/x"],
      ["IPv6 unique-local", "http://[fd00::1]/x"],
      ["IPv6 link-local", "http://[fe80::1]/x"],
    ])("rejects %s", (_label, url) => {
      expect(parseSourceUrl(url)).toStrictEqual({
        ok: false,
        reason: "internal_host",
      });
    });

    it("rejects the cloud metadata address, which is the one with a payload", () => {
      expect(parseSourceUrl("http://169.254.169.254/latest/meta-data/")).toStrictEqual(
        { ok: false, reason: "internal_host" },
      );
    });

    it.each([
      ["a decimal integer", "http://2130706433/"],
      ["a hexadecimal integer", "http://0x7f.1/"],
      ["a short form", "http://127.1/"],
      ["an IPv4-mapped IPv6 address", "http://[::ffff:127.0.0.1]/"],
      ["an IPv4-compatible IPv6 address", "http://[::127.0.0.1]/"],
      ["a private address, mapped", "http://[::ffff:10.0.0.5]/"],
      ["the metadata address, mapped", "http://[::ffff:169.254.169.254]/"],
    ])("rejects an internal address written as %s", (_label, url) => {
      // Every one of these resolves to a private or loopback address, and none
      // of them contains the corresponding dotted quad as text — so a raw-text
      // deny list would pass all of them.
      expect(parseSourceUrl(url)).toStrictEqual({
        ok: false,
        reason: "internal_host",
      });
    });

    it.each([
      ["localhost", "http://localhost:3000/x"],
      ["a single-label name", "http://intranet/wiki"],
      ["an mDNS name", "http://printer.local/x"],
      ["a reserved internal name", "http://api.internal/x"],
    ])("rejects %s", (_label, url) => {
      expect(parseSourceUrl(url)).toStrictEqual({
        ok: false,
        reason: "internal_host",
      });
    });

    it("accepts a public IPv4 address", () => {
      expect(parseSourceUrl("http://93.184.216.34/x").ok).toBe(true);
    });

    it("accepts a public IPv6 literal", () => {
      // The IPv4 rules must not see this one: it contains no dot, and the
      // single-label rule would otherwise call it a private name.
      expect(parseSourceUrl("http://[2606:2800:220:1:248:1893:25c8:1946]/x").ok).toBe(
        true,
      );
    });
  });

  describe("malformed input", () => {
    it("rejects an empty string", () => {
      expect(parseSourceUrl("")).toStrictEqual({ ok: false, reason: "malformed" });
    });

    it("rejects a whitespace-only string", () => {
      expect(parseSourceUrl("   ")).toStrictEqual({
        ok: false,
        reason: "malformed",
      });
    });

    it("rejects text that is not a URL", () => {
      expect(parseSourceUrl("not a url at all").ok).toBe(false);
    });

    it("trims surrounding whitespace before parsing", () => {
      const result = parseSourceUrl("  https://example.org/x  ");

      expect(result.ok && result.url).toBe("https://example.org/x");
    });
  });

  describe("the return contract", () => {
    it("reports a reason rather than throwing, so one bad link cannot fail a run", () => {
      // Called with a value no provider should produce, and it still returns.
      expect(() => parseSourceUrl(undefined as unknown as string)).not.toThrow();
    });

    it("never returns a url alongside a rejection", () => {
      const result = parseSourceUrl("javascript:alert(1)");

      expect(result.ok).toBe(false);
      expect("url" in result).toBe(false);
    });
  });
});
