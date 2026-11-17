import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app";
import { nodeSqliteAdapter } from "../src/server/adapters/node-sqlite";
import { geoFromHeaders, ipFromHeaders, type Platform } from "../src/server/platform";

const db = nodeSqliteAdapter(":memory:");
const platform: Platform = {
  db,
  waitUntil: () => {},
  asset: async () => null,
  clientIp: (r) => ipFromHeaders(r.headers) ?? "127.0.0.1",
  geo: (r) => geoFromHeaders(r.headers),
  env: { DEV: "1" },
};
const app = createApp(() => platform);
const O = "http://go.test";
let cookie = "";

const req = (path: string, init: RequestInit = {}) => app.request(O + path, { redirect: "manual", ...init });
const asUser = (path: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
  req(path, { method, headers: { cookie, "content-type": "application/json", "x-waymark": "1" }, body: body === undefined ? undefined : JSON.stringify(body) });

async function pkce() {
  const verifier = "v".repeat(20) + Math.random().toString(36).slice(2).padEnd(30, "x");
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const challenge = btoa(String.fromCharCode(...d))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { verifier, challenge };
}

let clientId = "";
let access = "";
let refresh = "";
const redirect = "https://claude.ai/api/mcp/auth_callback";

const rpc = (method: string, params: unknown = {}, token = access, id: number | null = 1) =>
  req("/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method, params }),
  });

beforeAll(async () => {
  const r = await asUser("/api/v1/auth/setup", { email: "owner@test.dev", password: "correct horse battery", hostname: "go.test" });
  cookie = r.headers.get("set-cookie")!.split(";")[0];
});

describe("discovery", () => {
  it("answers 401 with resource metadata", async () => {
    const r = await req("/mcp", { method: "POST", body: "{}" });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain(`resource_metadata="${O}/.well-known/oauth-protected-resource"`);
  });
  it("publishes OAuth metadata", async () => {
    const pr = await (await req("/.well-known/oauth-protected-resource")).json<any>();
    expect(pr.authorization_servers).toEqual([O]);
    const as = await (await req("/.well-known/oauth-authorization-server")).json<any>();
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.registration_endpoint).toBe(`${O}/oauth/register`);
  });
});

describe("oauth flow", () => {
  it("registers a client", async () => {
    const r = await req("/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Claude", redirect_uris: [redirect] }),
    });
    expect(r.status).toBe(201);
    clientId = (await r.json<any>()).client_id;
  });

  it("rejects unsafe redirect URIs", async () => {
    const r = await req("/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "x", redirect_uris: ["http://evil.example/cb"] }),
    });
    expect(r.status).toBe(400);
  });

  it("authorizes with PKCE, narrows scopes and issues tokens", async () => {
    const { verifier, challenge } = await pkce();
    const q = {
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirect,
      state: "xyz",
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: "links:read links:write analytics:read links:delete",
    };
    const info = await (await asUser(`/api/v1/oauth/request?${new URLSearchParams(q)}`)).json<any>();
    expect(info.client.name).toBe("Claude");
    expect(info.requested).toContain("links:delete");
    const a = await (await asUser("/api/v1/oauth/authorize", { ...q, approve: true, scopes: ["links:read", "links:write", "analytics:read"] })).json<any>();
    const back = new URL(a.redirect_to);
    expect(back.searchParams.get("state")).toBe("xyz");
    const code = back.searchParams.get("code")!;

    const bad = await req("/oauth/token", {
      method: "POST",
      body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: redirect, code_verifier: "w".repeat(50) }),
    });
    expect(bad.status).toBe(400);
    // The code was burned by the failed attempt: single use.
    const again = await req("/oauth/token", {
      method: "POST",
      body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: redirect, code_verifier: verifier }),
    });
    expect(again.status).toBe(400);

    const a2 = await (await asUser("/api/v1/oauth/authorize", { ...q, approve: true, scopes: ["links:read", "links:write", "analytics:read"] })).json<any>();
    const code2 = new URL(a2.redirect_to).searchParams.get("code")!;
    const t = await req("/oauth/token", {
      method: "POST",
      body: new URLSearchParams({ grant_type: "authorization_code", code: code2, client_id: clientId, redirect_uri: redirect, code_verifier: verifier }),
    });
    expect(t.status).toBe(200);
    const tok = await t.json<any>();
    expect(tok.scope).toBe("links:read links:write analytics:read");
    access = tok.access_token;
    refresh = tok.refresh_token;
  });

  it("denies with access_denied", async () => {
    const { challenge } = await pkce();
    const q = { response_type: "code", client_id: clientId, redirect_uri: redirect, state: "s", code_challenge: challenge, code_challenge_method: "S256" };
    const a = await (await asUser("/api/v1/oauth/authorize", { ...q, approve: false })).json<any>();
    expect(new URL(a.redirect_to).searchParams.get("error")).toBe("access_denied");
  });
});

describe("mcp", () => {
  it("initializes and lists only permitted tools", async () => {
    const init = await (await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } })).json<any>();
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect((await rpc("notifications/initialized", {}, access, null)).status).toBe(202);
    const tools = (await (await rpc("tools/list")).json<any>()).result.tools.map((t: { name: string }) => t.name);
    expect(tools).toContain("create_link");
    expect(tools).toContain("get_link_stats");
    expect(tools).not.toContain("delete_link");
  });

  it("creates, finds, updates and reads stats through tools", async () => {
    const created = (
      await (await rpc("tools/call", { name: "create_link", arguments: { url: "https://example.com/mcp", slug: "from-ai", tags: ["ai"] } })).json<any>()
    ).result;
    expect(created.isError).toBeUndefined();
    expect(created.structuredContent.short_url).toBe("https://go.test/from-ai");
    await req("/from-ai", { headers: { "user-agent": "Mozilla/5.0 Firefox/120" } });
    const found = (await (await rpc("tools/call", { name: "search_links", arguments: { query: "from" } })).json<any>()).result.structuredContent;
    expect(found.total).toBe(1);
    const upd = (await (await rpc("tools/call", { name: "update_link", arguments: { link: "go.test/from-ai", title: "Made by AI" } })).json<any>()).result
      .structuredContent;
    expect(upd.title).toBe("Made by AI");
    const s = (await (await rpc("tools/call", { name: "get_link_stats", arguments: { link: "https://go.test/from-ai", range: "7d" } })).json<any>()).result;
    expect(s.isError).toBeUndefined();
    expect(s.structuredContent.totals).toBeDefined();
  });

  it("refuses tools outside the granted scopes", async () => {
    const r = (await (await rpc("tools/call", { name: "delete_link", arguments: { link: "from-ai" } })).json<any>()).result;
    expect(r.isError).toBe(true);
  });

  it("reports tool errors without failing the request", async () => {
    const r = (await (await rpc("tools/call", { name: "create_link", arguments: { url: "javascript:alert(1)" } })).json<any>()).result;
    expect(r.isError).toBe(true);
  });

  it("works with a plain API key too", async () => {
    const k = await (await asUser("/api/v1/api-keys", { name: "cursor", scopes: ["links:read"] })).json<any>();
    const tools = (await (await rpc("tools/list", {}, k.key)).json<any>()).result.tools.map((t: { name: string }) => t.name);
    expect(tools).toEqual(["search_links", "get_link", "check_slug", "list_tags"]);
  });
});

describe("refresh & revoke", () => {
  it("rotates refresh tokens", async () => {
    const r = await req("/oauth/token", {
      method: "POST",
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId }),
    });
    expect(r.status).toBe(200);
    const t = await r.json<any>();
    expect((await rpc("ping", {}, access)).status).toBe(401);
    expect((await rpc("ping", {}, t.access_token)).status).toBe(200);
    const reuse = await req("/oauth/token", {
      method: "POST",
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId }),
    });
    expect(reuse.status).toBe(400);
    access = t.access_token;
    refresh = t.refresh_token;
  });

  it("shows the connection and revokes it", async () => {
    const keys = (await (await asUser("/api/v1/api-keys")).json<any>()).data;
    const app1 = keys.find((k: { kind: string }) => k.kind === "oauth");
    expect(app1.name).toBe("Claude");
    await asUser(`/api/v1/api-keys/${app1.id}`, undefined, "DELETE");
    expect((await rpc("ping", {}, access)).status).toBe(401);
    const r = await req("/oauth/token", {
      method: "POST",
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId }),
    });
    expect(r.status).toBe(400);
  });
});
