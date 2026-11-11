import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { ROLE_SCOPES, type Role, type Scope } from "../shared/permissions";
import { randomString, sha256 } from "./lib/crypto";
import type { Platform } from "./platform";
import type { Db } from "./db";
import { HttpError } from "./errors";

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled: number;
  password_hash: string | null;
  created_at: number;
  last_login_at: number | null;
}

export interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  user_id: string;
  scopes: string;
  domain_ids: string | null;
  expires_at: number | null;
  revoked_at: number | null;
}

export type Actor =
  | { type: "user"; user: UserRow; scopes: Set<Scope>; sessionId: string }
  | { type: "key"; user: UserRow; key: KeyRow; scopes: Set<Scope>; domainIds: string[] | null };

export type AppEnv = { Variables: { platform: Platform; actor: Actor | null } };
export type Ctx = Context<AppEnv>;

export const SESSION_COOKIE = "wm_session";
const SESSION_DAYS = 30;

export async function createSession(c: Ctx, userId: string) {
  const { db, env } = c.get("platform");
  const token = randomString(48);
  const now = Date.now();
  await db.run("INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)", [
    await sha256(token),
    userId,
    now,
    now + SESSION_DAYS * 864e5,
    now,
    c.get("platform").clientIp(c.req.raw),
    (c.req.header("user-agent") || "").slice(0, 300),
  ]);
  await db.run("UPDATE users SET last_login_at = ? WHERE id = ?", [now, userId]);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.DEV !== "1",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function destroySession(c: Ctx) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.get("platform").db.run("DELETE FROM sessions WHERE id = ?", [await sha256(token)]);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

function effectiveScopes(role: Role, requested?: string[]): Set<Scope> {
  const allowed = new Set(ROLE_SCOPES[role]);
  if (!requested) return allowed;
  return new Set(requested.filter((s): s is Scope => allowed.has(s as Scope)));
}

/** Resolves the caller from an API key header or the session cookie. Never throws. */
export const loadActor: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("actor", null);
  const { db } = c.get("platform");
  const auth = c.req.header("authorization");
  const keyHeader = c.req.header("x-api-key");
  const raw = keyHeader || (auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null);

  if (raw) {
    const row = await db.first<KeyRow & { u_id: string }>(
      `SELECT k.*, u.id AS u_id FROM api_keys k JOIN users u ON u.id = k.user_id
       WHERE k.key_hash = ? AND k.revoked_at IS NULL AND u.disabled = 0`,
      [await sha256(raw)],
    );
    if (!row || (row.expires_at && row.expires_at < Date.now())) throw new HttpError(401, "invalid_api_key", "This API key is unknown, revoked or expired.");
    const user = await db.first<UserRow>("SELECT * FROM users WHERE id = ?", [row.user_id]);
    if (!user) throw new HttpError(401, "invalid_api_key", "The owner of this API key no longer exists.");
    c.set("actor", {
      type: "key",
      user,
      key: row,
      scopes: effectiveScopes(user.role, JSON.parse(row.scopes)),
      domainIds: row.domain_ids ? JSON.parse(row.domain_ids) : null,
    });
    // Coarse last-used timestamp; one write per key per minute at most.
    const p = c.get("platform");
    p.waitUntil(
      db.run("UPDATE api_keys SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)", [Date.now(), row.id, Date.now() - 60_000]),
    );
    return next();
  }

  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const id = await sha256(token);
    const row = await db.first<UserRow & { s_expires: number; s_seen: number }>(
      `SELECT u.*, s.expires_at AS s_expires, s.last_seen_at AS s_seen FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
      [id],
    );
    if (row && row.s_expires > Date.now() && !row.disabled) {
      c.set("actor", { type: "user", user: row, scopes: effectiveScopes(row.role), sessionId: id });
      if (Date.now() - row.s_seen > 5 * 60_000) {
        c.get("platform").waitUntil(db.run("UPDATE sessions SET last_seen_at = ? WHERE id = ?", [Date.now(), id]));
      }
      // Cookie-authenticated writes must carry our header. Browsers cannot add it
      // cross-site without a CORS preflight, which we never grant for cookies.
      if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && c.req.header("x-waymark") !== "1") {
        throw new HttpError(403, "csrf", "Missing X-Waymark header.");
      }
    }
  }
  return next();
};

export function actorOf(c: Ctx): Actor {
  const a = c.get("actor");
  if (!a) throw new HttpError(401, "unauthorized", "Sign in or send an API key.");
  return a;
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  actorOf(c);
  return next();
};

export function requireScope(...scopes: Scope[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const a = actorOf(c);
    for (const s of scopes) {
      if (!a.scopes.has(s)) throw new HttpError(403, "forbidden", `Missing permission: ${s}`);
    }
    return next();
  };
}

/** Actions that only signed-in people may take: settings, API keys, own account. */
export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const a = actorOf(c);
  if (a.type !== "user") throw new HttpError(403, "session_required", "This action is not available to API keys.");
  return next();
};

export function requireRole(...roles: Role[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const a = actorOf(c);
    if (a.type !== "user" || !roles.includes(a.user.role)) throw new HttpError(403, "forbidden", "Your role does not allow this.");
    return next();
  };
}

/** Domain restriction for API keys. */
export function canUseDomain(a: Actor, domainId: string) {
  return a.type !== "key" || !a.domainIds || a.domainIds.includes(domainId);
}

/** Fixed-window counter stored in the database. Returns false when over the limit. */
export async function throttle(db: Db, key: string, limit: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  const row = await db.first<{ count: number; window_start: number }>("SELECT count, window_start FROM throttle WHERE key = ?", [key]);
  if (!row || now - row.window_start > windowMs) {
    await db.run(
      "INSERT INTO throttle (key, count, window_start) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start",
      [key, now],
    );
    return true;
  }
  if (row.count >= limit) return false;
  await db.run("UPDATE throttle SET count = count + 1 WHERE key = ?", [key]);
  return true;
}

export async function clearThrottle(db: Db, key: string) {
  await db.run("DELETE FROM throttle WHERE key = ?", [key]);
}

export async function audit(c: Ctx, action: string, targetType: string | null, targetId: string | null, detail?: unknown) {
  const a = c.get("actor");
  const p = c.get("platform");
  const label = a ? (a.type === "key" ? `${a.key.name} (key, ${a.user.email})` : a.user.email) : "anonymous";
  p.waitUntil(
    p.db
      .run("INSERT INTO audit_log (ts, actor_type, actor_id, actor_label, action, target_type, target_id, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [
        Date.now(),
        a ? a.type : "system",
        a ? (a.type === "key" ? a.key.id : a.user.id) : null,
        label,
        action,
        targetType,
        targetId,
        detail === undefined ? null : JSON.stringify(detail).slice(0, 4000),
        p.clientIp(c.req.raw),
      ])
      .catch(() => {}),
  );
}

export function userView(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    disabled: !!u.disabled,
    created_at: u.created_at,
    last_login_at: u.last_login_at,
    pending_invite: !u.password_hash,
  };
}
