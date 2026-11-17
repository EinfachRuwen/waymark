/**
 * A small OAuth 2.1 authorization server so AI assistants (Claude, ChatGPT,
 * Cursor, …) can connect to Waymark's MCP endpoint with the user's account.
 *
 * - Dynamic client registration (RFC 7591), public clients with PKCE (S256).
 * - The consent screen is the admin app (/_/authorize); people choose which
 *   permissions an app gets, never more than their own role allows.
 * - Each authorization becomes a row in api_keys with kind = 'oauth', so the
 *   rest of the API authenticates these apps exactly like API keys.
 * - Access tokens live one hour, refresh tokens 90 days and rotate on use.
 */
import { Hono } from "hono";
import { z } from "zod";
import { ALL_SCOPES, ROLE_SCOPES, type Scope } from "../shared/permissions";
import { type AppEnv, type Ctx, actorOf, audit, requireSession, throttle } from "./auth";
import type { Db } from "./db";
import { listDomains } from "./domains";
import { HttpError } from "./errors";
import { newId, randomString, sha256, timingSafeEqual } from "./lib/crypto";
import { body, parse } from "./routes/util";

const ACCESS_TTL = 3600_000;
const REFRESH_TTL = 90 * 864e5;
const CODE_TTL = 10 * 60_000;

/** What an app gets when it asks for nothing specific. */
export const DEFAULT_APP_SCOPES: Scope[] = ["links:read", "links:write", "analytics:read", "domains:read"];

export function originOf(c: Ctx) {
  const u = new URL(c.req.url);
  const proto = c.req.header("x-forwarded-proto") || u.protocol.replace(":", "");
  const host = c.req.header("x-forwarded-host") || c.req.header("host") || u.host;
  return `${proto}://${host}`;
}

export function protectedResourceMetadata(c: Ctx) {
  const origin = originOf(c);
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: ALL_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Waymark",
  };
}

export function authorizationServerMetadata(c: Ctx) {
  const origin = originOf(c);
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/_/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: ALL_SCOPES,
    service_documentation: "https://github.com/EinfachRuwen/waymark/blob/main/docs/MCP.md",
  };
}

interface ClientRow {
  id: string;
  name: string;
  redirect_uris: string;
  secret_hash: string | null;
  client_uri: string | null;
  logo_uri: string | null;
}

const BAD_REDIRECT = /^(javascript|data|vbscript|file|blob):/i;

function validRedirect(uri: string) {
  try {
    const u = new URL(uri);
    if (BAD_REDIRECT.test(u.protocol)) return false;
    if (u.hash) return false;
    // Plain http only for local callbacks (desktop apps, CLIs).
    if (u.protocol === "http:" && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function parseScopes(scope: string | null | undefined): Scope[] {
  const asked = (scope || "").split(/[\s,]+/).filter((s): s is Scope => (ALL_SCOPES as string[]).includes(s));
  return asked.length ? [...new Set(asked)] : DEFAULT_APP_SCOPES;
}

async function getClient(db: Db, id: string | undefined | null) {
  if (!id) return null;
  return db.first<ClientRow>("SELECT * FROM oauth_clients WHERE id = ?", [id]);
}

function tokenError(c: Ctx, error: string, description: string, status: 400 | 401 = 400) {
  return c.json({ error, error_description: description }, status, { "cache-control": "no-store" });
}

async function readForm(c: Ctx): Promise<Record<string, string>> {
  const ct = c.req.header("content-type") || "";
  if (ct.includes("application/json")) {
    const j = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, String(v ?? "")]));
  }
  const f = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, String(v ?? "")]));
}

/* ───────────── Public endpoints (mounted at /oauth) ───────────── */

export const oauthPublic = new Hono<AppEnv>();

oauthPublic.post("/register", async (c) => {
  const p = c.get("platform");
  const ip = p.clientIp(c.req.raw) || "unknown";
  if (!(await throttle(p.db, `oauth-register:${ip}`, 30, 3600_000))) {
    return c.json({ error: "slow_down", error_description: "Too many registrations from this address." }, 429);
  }
  const m = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!m) return c.json({ error: "invalid_client_metadata", error_description: "Send client metadata as JSON." }, 400);
  const uris = Array.isArray(m.redirect_uris) ? (m.redirect_uris as unknown[]).map(String) : [];
  if (!uris.length || uris.length > 10 || !uris.every(validRedirect)) {
    return c.json({ error: "invalid_redirect_uri", error_description: "Provide 1–10 redirect URIs: https, a custom app scheme, or http on localhost." }, 400);
  }
  const method = String(m.token_endpoint_auth_method || "none");
  const confidential = method === "client_secret_post" || method === "client_secret_basic";
  const id = newId("cli_");
  const secret = confidential ? `wcs_${randomString(40)}` : null;
  const name = String(m.client_name || "Unnamed app").slice(0, 80);
  const clean = (v: unknown) => (typeof v === "string" && /^https:\/\//.test(v) ? v.slice(0, 500) : null);
  await p.db.run("INSERT INTO oauth_clients (id, name, redirect_uris, secret_hash, client_uri, logo_uri, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [
    id,
    name,
    JSON.stringify(uris),
    secret ? await sha256(secret) : null,
    clean(m.client_uri),
    clean(m.logo_uri),
    Date.now(),
  ]);
  return c.json(
    {
      client_id: id,
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: confidential ? method : "none",
    },
    201,
  );
});

async function checkClientSecret(c: Ctx, client: ClientRow, form: Record<string, string>) {
  if (!client.secret_hash) return true;
  let secret = form.client_secret;
  const basic = c.req.header("authorization");
  if (!secret && basic?.toLowerCase().startsWith("basic ")) {
    try {
      secret = decodeURIComponent(atob(basic.slice(6).trim()).split(":").slice(1).join(":"));
    } catch {
      secret = "";
    }
  }
  return !!secret && timingSafeEqual(await sha256(secret), client.secret_hash);
}

async function issueTokens(db: Db, grantId: string) {
  const access = `wmo_${randomString(40)}`;
  const refresh = `wmr_${randomString(48)}`;
  const now = Date.now();
  await db.run("UPDATE api_keys SET key_hash = ?, prefix = ?, expires_at = ?, refresh_hash = ?, refresh_expires_at = ? WHERE id = ?", [
    await sha256(access),
    access.slice(0, 9),
    now + ACCESS_TTL,
    await sha256(refresh),
    now + REFRESH_TTL,
    grantId,
  ]);
  return { access, refresh };
}

oauthPublic.post("/token", async (c) => {
  const { db } = c.get("platform");
  const form = await readForm(c);
  const basicId = (() => {
    const h = c.req.header("authorization");
    if (!h?.toLowerCase().startsWith("basic ")) return null;
    try {
      return decodeURIComponent(atob(h.slice(6).trim()).split(":")[0]);
    } catch {
      return null;
    }
  })();
  const client = await getClient(db, form.client_id || basicId);
  if (!client) return tokenError(c, "invalid_client", "Unknown client_id. Register the app again.", 401);
  if (!(await checkClientSecret(c, client, form))) return tokenError(c, "invalid_client", "Client authentication failed.", 401);

  if (form.grant_type === "authorization_code") {
    const codeHash = await sha256(form.code || "");
    const row = await db.first<{
      client_id: string;
      user_id: string;
      redirect_uri: string;
      scopes: string;
      domain_ids: string | null;
      code_challenge: string;
      expires_at: number;
    }>("SELECT * FROM oauth_codes WHERE code_hash = ?", [codeHash]);
    // Codes are single-use: delete before checking anything else.
    await db.run("DELETE FROM oauth_codes WHERE code_hash = ?", [codeHash]);
    if (!row || row.expires_at < Date.now() || row.client_id !== client.id)
      return tokenError(c, "invalid_grant", "The authorization code is invalid or expired.");
    if (row.redirect_uri !== form.redirect_uri) return tokenError(c, "invalid_grant", "redirect_uri does not match the authorization request.");
    const verifier = form.code_verifier || "";
    if (verifier.length < 43 || verifier.length > 128) return tokenError(c, "invalid_grant", "A PKCE code_verifier is required.");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    const challenge = btoa(String.fromCharCode(...digest))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    if (!timingSafeEqual(challenge, row.code_challenge)) return tokenError(c, "invalid_grant", "PKCE verification failed.");

    const grantId = newId("key_");
    await db.run(
      "INSERT INTO api_keys (id, name, prefix, key_hash, user_id, scopes, domain_ids, created_at, kind, client_id) VALUES (?, ?, '', ?, ?, ?, ?, ?, 'oauth', ?)",
      [grantId, client.name, `pending:${grantId}`, row.user_id, row.scopes, row.domain_ids, Date.now(), client.id],
    );
    const t = await issueTokens(db, grantId);
    await db.run("UPDATE oauth_clients SET last_used_at = ? WHERE id = ?", [Date.now(), client.id]);
    return c.json(
      {
        access_token: t.access,
        token_type: "Bearer",
        expires_in: ACCESS_TTL / 1000,
        refresh_token: t.refresh,
        scope: (JSON.parse(row.scopes) as string[]).join(" "),
      },
      200,
      { "cache-control": "no-store" },
    );
  }

  if (form.grant_type === "refresh_token") {
    const grant = await db.first<{ id: string; client_id: string; scopes: string; refresh_expires_at: number; revoked_at: number | null }>(
      "SELECT id, client_id, scopes, refresh_expires_at, revoked_at FROM api_keys WHERE refresh_hash = ? AND kind = 'oauth'",
      [await sha256(form.refresh_token || "")],
    );
    if (!grant || grant.revoked_at || grant.client_id !== client.id || grant.refresh_expires_at < Date.now()) {
      return tokenError(c, "invalid_grant", "The refresh token is invalid, expired or was revoked. Connect the app again.");
    }
    const t = await issueTokens(db, grant.id);
    return c.json(
      {
        access_token: t.access,
        token_type: "Bearer",
        expires_in: ACCESS_TTL / 1000,
        refresh_token: t.refresh,
        scope: (JSON.parse(grant.scopes) as string[]).join(" "),
      },
      200,
      { "cache-control": "no-store" },
    );
  }

  return tokenError(c, "unsupported_grant_type", "Use authorization_code or refresh_token.");
});

oauthPublic.post("/revoke", async (c) => {
  const { db } = c.get("platform");
  const form = await readForm(c);
  const h = await sha256(form.token || "");
  await db.run("UPDATE api_keys SET revoked_at = ? WHERE kind = 'oauth' AND revoked_at IS NULL AND (key_hash = ? OR refresh_hash = ?)", [Date.now(), h, h]);
  return c.body(null, 200);
});

/* ───────────── Consent (session only, mounted under /api/v1) ───────────── */

export const oauthConsent = new Hono<AppEnv>();

const requestSchema = z.object({
  response_type: z.string(),
  client_id: z.string(),
  redirect_uri: z.string(),
  state: z.string().max(2000).optional(),
  code_challenge: z.string().optional(),
  code_challenge_method: z.string().optional(),
  scope: z.string().max(2000).optional(),
  resource: z.string().max(2000).optional(),
});

async function validateRequest(c: Ctx, q: z.infer<typeof requestSchema>) {
  const client = await getClient(c.get("platform").db, q.client_id);
  if (!client) throw new HttpError(400, "unknown_client", "This app is not registered with this Waymark. Start the connection again from the app.");
  if (!(JSON.parse(client.redirect_uris) as string[]).includes(q.redirect_uri)) {
    throw new HttpError(400, "invalid_redirect", "The app asked to return to an address it did not register.");
  }
  if (q.response_type !== "code") throw new HttpError(400, "unsupported_response_type", "Only the authorization code flow is supported.");
  if (!q.code_challenge || q.code_challenge_method !== "S256") throw new HttpError(400, "pkce_required", "The app must use PKCE with S256.");
  return client;
}

oauthConsent.get("/oauth/request", requireSession, async (c) => {
  const a = actorOf(c);
  const q = parse(requestSchema, c.req.query());
  const client = await validateRequest(c, q);
  const allowed = ROLE_SCOPES[a.user.role];
  const requested = parseScopes(q.scope).filter((s) => allowed.includes(s));
  const domains = await listDomains(c.get("platform").db);
  let redirectHost = q.redirect_uri;
  try {
    const u = new URL(q.redirect_uri);
    redirectHost = u.protocol === "https:" || u.protocol === "http:" ? u.host : u.protocol.replace(":", "");
  } catch {
    /* keep raw */
  }
  return c.json({
    client: { id: client.id, name: client.name, client_uri: client.client_uri, logo_uri: client.logo_uri, redirect_host: redirectHost },
    requested,
    allowed,
    domains: domains.map((d) => ({ id: d.id, hostname: d.hostname })),
  });
});

oauthConsent.post("/oauth/authorize", requireSession, async (c) => {
  const a = actorOf(c);
  const { db } = c.get("platform");
  const input = await body(
    c,
    requestSchema.extend({
      approve: z.boolean(),
      scopes: z.array(z.string()).optional(),
      domain_ids: z.array(z.string()).nullish(),
    }),
  );
  const client = await validateRequest(c, input);
  const back = new URL(input.redirect_uri);
  if (input.state) back.searchParams.set("state", input.state);
  back.searchParams.set("iss", originOf(c));
  if (!input.approve) {
    back.searchParams.set("error", "access_denied");
    return c.json({ redirect_to: back.toString() });
  }
  const allowed = new Set(ROLE_SCOPES[a.user.role]);
  const scopes = (input.scopes ?? parseScopes(input.scope)).filter((s): s is Scope => allowed.has(s as Scope));
  if (!scopes.length) throw new HttpError(422, "no_scopes", "Choose at least one permission.");
  const code = randomString(48);
  await db.run(
    "INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, scopes, domain_ids, code_challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      await sha256(code),
      client.id,
      a.user.id,
      input.redirect_uri,
      JSON.stringify(scopes),
      input.domain_ids?.length ? JSON.stringify(input.domain_ids) : null,
      input.code_challenge!,
      Date.now() + CODE_TTL,
    ],
  );
  await audit(c, "app.connected", "oauth_client", client.id, { name: client.name, scopes });
  back.searchParams.set("code", code);
  return c.json({ redirect_to: back.toString() });
});

export async function cleanupOAuth(db: Db) {
  const now = Date.now();
  await db.run("DELETE FROM oauth_codes WHERE expires_at < ?", [now]);
  // Registrations that never led to a connection are dropped after a week.
  await db.run(
    "DELETE FROM oauth_clients WHERE created_at < ? AND last_used_at IS NULL AND NOT EXISTS (SELECT 1 FROM api_keys k WHERE k.client_id = oauth_clients.id)",
    [now - 7 * 864e5],
  );
}
