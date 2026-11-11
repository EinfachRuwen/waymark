import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app";
import { nodeSqliteAdapter } from "../src/server/adapters/node-sqlite";
import { geoFromHeaders, ipFromHeaders, type Platform } from "../src/server/platform";

const db = nodeSqliteAdapter(":memory:");
const pending: Promise<unknown>[] = [];
const platform: Platform = {
  db,
  waitUntil: (p) => void pending.push(p),
  asset: async () => null,
  clientIp: (r) => ipFromHeaders(r.headers) ?? "127.0.0.1",
  geo: (r) => geoFromHeaders(r.headers),
  env: { DEV: "1" },
};
const app = createApp(() => platform);
const flush = async () => {
  await Promise.all(pending.splice(0));
};

let cookie = "";
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await app.request(`http://go.test${path}`, {
    method,
    headers: { "content-type": "application/json", "x-waymark": "1", cookie, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const set = res.headers.get("set-cookie");
  if (set?.startsWith("wm_session=")) cookie = set.split(";")[0];
  return res;
}
const json = async (r: Response) => r.json() as Promise<Record<string, any>>;

beforeAll(async () => {
  const r = await call("POST", "/api/v1/auth/setup", { email: "owner@test.dev", password: "correct horse battery", hostname: "go.test" });
  expect(r.status).toBe(200);
});

describe("setup & auth", () => {
  it("refuses a second setup", async () => {
    const r = await call("POST", "/api/v1/auth/setup", { email: "x@test.dev", password: "another password", hostname: "go.test" });
    expect(r.status).toBe(409);
  });

  it("requires the CSRF header for cookie writes", async () => {
    const r = await call("POST", "/api/v1/links", { url: "https://example.com" }, { "x-waymark": "0" });
    expect(r.status).toBe(403);
  });

  it("rejects wrong passwords", async () => {
    const saved = cookie;
    const r = await call("POST", "/api/v1/auth/login", { email: "owner@test.dev", password: "nope nope nope" });
    expect(r.status).toBe(401);
    cookie = saved;
  });
});

describe("links & redirects", () => {
  it("creates and follows a link with UTM and query forwarding", async () => {
    const r = await call("POST", "/api/v1/links", { url: "https://example.com/a?x=1", slug: "Hello", utm: { source: "wm" } });
    expect(r.status).toBe(201);
    const l = await json(r);
    expect(l.short_url).toBe("https://go.test/Hello");
    const go = await call("GET", "/hello?ref=abc", undefined, { "user-agent": "Mozilla/5.0 (Macintosh) Safari/605" });
    expect(go.status).toBe(302);
    expect(go.headers.get("location")).toBe("https://example.com/a?x=1&utm_source=wm&ref=abc");
    await flush();
    const again = await json(await call("GET", `/api/v1/links/${l.id}`));
    expect(again.clicks).toBe(1);
  });

  it("rejects duplicate and reserved slugs and bad schemes", async () => {
    expect((await call("POST", "/api/v1/links", { url: "https://example.com", slug: "hello" })).status).toBe(409);
    expect((await call("POST", "/api/v1/links", { url: "https://example.com", slug: "api" })).status).toBe(422);
    expect((await call("POST", "/api/v1/links", { url: "javascript:alert(1)" })).status).toBe(422);
  });

  it("routes by country and device rules", async () => {
    await call("POST", "/api/v1/links", {
      url: "https://example.com",
      slug: "geo",
      rules: [
        { type: "country", values: ["de"], url: "https://example.de" },
        { type: "os", values: ["ios"], url: "https://apps.apple.com/x" },
      ],
    });
    const de = await call("GET", "/geo", undefined, { "cf-ipcountry": "DE", "user-agent": "Mozilla/5.0 Chrome/120" });
    expect(de.headers.get("location")).toBe("https://example.de");
    const ios = await call("GET", "/geo", undefined, { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari" });
    expect(ios.headers.get("location")).toBe("https://apps.apple.com/x");
  });

  it("protects links with a password", async () => {
    await call("POST", "/api/v1/links", { url: "https://secret.example", slug: "locked", password: "opensesame" });
    const page = await call("GET", "/locked");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("password protected");
    const bad = await app.request("http://go.test/locked", { method: "POST", body: new URLSearchParams({ password: "wrong" }) });
    expect(bad.status).toBe(401);
    const ok = await app.request("http://go.test/locked", { method: "POST", body: new URLSearchParams({ password: "opensesame" }), redirect: "manual" });
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe("https://secret.example");
  });

  it("expires by click limit", async () => {
    await call("POST", "/api/v1/links", { url: "https://once.example", slug: "once", max_clicks: 1, expired_url: "https://gone.example" });
    expect((await call("GET", "/once", undefined, { "user-agent": "Mozilla/5.0 Firefox/120" })).headers.get("location")).toBe("https://once.example");
    await flush();
    expect((await call("GET", "/once", undefined, { "user-agent": "Mozilla/5.0 Firefox/120" })).headers.get("location")).toBe("https://gone.example");
  });

  it("serves Open Graph cards to preview bots", async () => {
    await call("POST", "/api/v1/links", { url: "https://example.com/og", slug: "card", og_title: "Hello card" });
    const r = await call("GET", "/card", undefined, { "user-agent": "Slackbot-LinkExpanding 1.0" });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('property="og:title" content="Hello card"');
  });

  it("does not count bots", async () => {
    const l = await json(await call("POST", "/api/v1/links", { url: "https://example.com/bots", slug: "bots" }));
    await call("GET", "/bots", undefined, { "user-agent": "curl/8.0" });
    await flush();
    expect((await json(await call("GET", `/api/v1/links/${l.id}`))).clicks).toBe(0);
  });

  it("answers 404 for unknown slugs", async () => {
    expect((await call("GET", "/does-not-exist")).status).toBe(404);
  });

  it("bulk creates and skips conflicts", async () => {
    const r = await json(await call("POST", "/api/v1/links/bulk", { links: [{ url: "https://a.example", slug: "hello" }, { url: "https://b.example", slug: "b1" }, { url: "nope" }] }));
    expect(r.created).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.failed).toBe(1);
  });
});

describe("api keys & scopes", () => {
  let key = "";
  it("creates a limited key", async () => {
    const r = await json(await call("POST", "/api/v1/api-keys", { name: "bot", scopes: ["links:write"] }));
    key = r.key;
    expect(key.startsWith("wm_")).toBe(true);
  });

  it("allows what the key may do and nothing else", async () => {
    const auth = { authorization: `Bearer ${key}`, cookie: "" };
    const created = await app.request("http://go.test/api/v1/links", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ url: "https://k.example" }) });
    expect(created.status).toBe(201);
    const list = await app.request("http://go.test/api/v1/links", { headers: auth });
    expect(list.status).toBe(403);
    const keys = await app.request("http://go.test/api/v1/api-keys", { headers: auth });
    expect(keys.status).toBe(403);
  });

  it("rejects unknown keys", async () => {
    const r = await app.request("http://go.test/api/v1/links", { headers: { authorization: "Bearer wm_nope" } });
    expect(r.status).toBe(401);
  });
});

describe("analytics", () => {
  it("aggregates clicks", async () => {
    const a = await json(await call("GET", "/api/v1/analytics"));
    expect(a.totals.clicks).toBeGreaterThan(0);
    expect(Array.isArray(a.series)).toBe(true);
    expect(a.hourly).toHaveLength(24);
  });
});

describe("team", () => {
  it("invites an editor who can accept and sign in", async () => {
    const owner = cookie;
    const u = await json(await call("POST", "/api/v1/users", { email: "ed@test.dev", role: "editor" }));
    const token = String(u.invite_url).split("/invite/")[1];
    cookie = "";
    const r = await call("POST", `/api/v1/auth/invite/${token}`, { password: "editor password 1" });
    expect(r.status).toBe(200);
    const me = await json(await call("GET", "/api/v1/me"));
    expect(me.user.role).toBe("editor");
    expect((await call("GET", "/api/v1/users")).status).toBe(403);
    cookie = owner;
  });
});
