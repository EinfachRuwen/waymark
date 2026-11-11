import { describe, expect, it } from "vitest";
import { parseUa } from "../src/server/lib/ua";
import { buildTarget } from "../src/server/redirect";
import { checkSlug } from "../src/server/links";
import { mapShortioLink } from "../src/server/routes/transfer";
import { detectMapping, mapRows, parseCsv } from "../src/web/lib/csv";
import { hashPassword, verifyPassword } from "../src/server/lib/crypto";

describe("user agents", () => {
  it("classifies common clients", () => {
    expect(parseUa("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Mobile/15E148 Safari/604.1")).toMatchObject({
      os: "iOS",
      device: "mobile",
      browser: "Safari",
      bot: false,
    });
    expect(parseUa("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36")).toMatchObject({
      os: "Android",
      device: "mobile",
      browser: "Chrome",
    });
    expect(parseUa("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120")).toMatchObject({
      os: "Windows",
      browser: "Edge",
      device: "desktop",
    });
    expect(parseUa("facebookexternalhit/1.1")).toMatchObject({ bot: true, preview: true });
    expect(parseUa("curl/8.4.0").bot).toBe(true);
    expect(parseUa("").bot).toBe(true);
  });
});

describe("targets", () => {
  it("adds UTM without overriding existing params", () => {
    const t = buildTarget(
      "https://x.dev/?utm_source=keep",
      { utm: JSON.stringify({ source: "wm", medium: "mail" }), forward_query: 1 },
      new URLSearchParams("qr&a=1"),
    );
    expect(t).toBe("https://x.dev/?utm_source=keep&utm_medium=mail&a=1");
  });
  it("leaves app links alone", () => {
    expect(buildTarget("spotify:track:1", { utm: JSON.stringify({ source: "wm" }), forward_query: 1 }, new URLSearchParams("a=1"))).toBe("spotify:track:1");
  });
});

describe("slugs", () => {
  it("accepts paths and unicode, rejects reserved", () => {
    expect(checkSlug("/summer/2026/")).toBe("summer/2026");
    expect(checkSlug("grüße")).toBe("grüße");
    expect(() => checkSlug("api/x")).toThrow();
    expect(() => checkSlug("-x")).toThrow();
    expect(() => checkSlug("a b")).toThrow();
  });
});

describe("short.io mapping", () => {
  it("maps the fields Waymark understands", () => {
    const m = mapShortioLink({
      idString: "lnk_1",
      path: "promo",
      originalURL: "https://example.com",
      title: "Promo",
      tags: ["a"],
      cloaking: true,
      redirectType: "301",
      iphoneURL: "https://apps.apple.com/1",
      utmSource: "x",
      clicksLimit: 10,
      createdAt: "2024-01-02T03:04:05.000Z",
    });
    expect(m).toMatchObject({ url: "https://example.com", slug: "promo", cloak: true, redirect_type: 301, max_clicks: 10, external_id: "shortio:lnk_1" });
    expect(m.rules?.[0]).toMatchObject({ type: "os", values: ["ios", "ipados"] });
    expect(m.utm).toMatchObject({ source: "x" });
    expect(m.created_at).toBe(Date.parse("2024-01-02T03:04:05.000Z"));
  });
});

describe("csv", () => {
  it("parses quotes, semicolons and maps Bitly exports", () => {
    const rows = parseCsv('bitlink;long_url;title;tags\n"bit.ly/abc";"https://example.com/?a=1;b";"A ""quoted"" title";x|y\n');
    expect(rows[1][1]).toBe("https://example.com/?a=1;b");
    const mapped = mapRows(rows.slice(1), detectMapping(rows[0]), { keepClicks: true, useDomainColumn: false });
    expect(mapped[0]).toMatchObject({ url: "https://example.com/?a=1;b", slug: "abc", title: 'A "quoted" title', tags: ["x", "y"] });
  });
});

describe("passwords", () => {
  it("hashes and verifies", async () => {
    const h = await hashPassword("s3cret-pass", 1000);
    expect(await verifyPassword("s3cret-pass", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
});
