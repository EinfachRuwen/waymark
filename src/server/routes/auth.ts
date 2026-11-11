import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, type Ctx, type UserRow, actorOf, audit, clearThrottle, createSession, destroySession, requireSession, throttle, userView } from "../auth";
import { invalidateDomains, normalizeHost } from "../domains";
import { HttpError } from "../errors";
import { hashPassword, newId, randomString, sha256, timingSafeEqual, verifyPassword } from "../lib/crypto";
import { getSettings, publicSettings, saveSettings } from "../settings";
import { body } from "./util";

const r = new Hono<AppEnv>();

let dummy: Promise<string> | null = null;
/** Verifying against a dummy hash keeps response times equal for unknown emails. */
const dummyHash = () => (dummy ??= hashPassword(randomString(16)));

const password = z.string().min(10, "Use at least 10 characters.").max(200);

r.get("/auth/state", async (c) => {
  const { db, env } = c.get("platform");
  const count = await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM users");
  const a = c.get("actor");
  const s = await getSettings(db);
  return c.json({
    setup_required: !count?.n,
    setup_token_required: !count?.n && !!env.SETUP_TOKEN,
    instance_name: s.instance_name,
    user: a?.type === "user" ? { ...userView(a.user), scopes: [...a.scopes] } : null,
  });
});

r.post("/auth/setup", async (c) => {
  const { db, env } = c.get("platform");
  const input = await body(
    c,
    z.object({
      email: z.email(),
      name: z.string().trim().max(100).default(""),
      password,
      hostname: z.string().min(1).max(253),
      instance_name: z.string().trim().min(1).max(60).default("Waymark"),
      token: z.string().optional(),
    }),
  );
  const count = await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM users");
  if (count?.n) throw new HttpError(409, "already_set_up", "This Waymark already has an owner. Sign in instead.");
  if (env.SETUP_TOKEN && !timingSafeEqual(input.token ?? "", env.SETUP_TOKEN)) {
    throw new HttpError(403, "invalid_setup_token", "The setup token does not match SETUP_TOKEN.");
  }
  const now = Date.now();
  const id = newId("usr_");
  const host = normalizeHost(input.hostname);
  await db.batch([
    {
      sql: "INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'owner', ?)",
      params: [id, input.email.toLowerCase(), input.name, await hashPassword(input.password), now],
    },
    {
      sql: "INSERT OR IGNORE INTO domains (id, hostname, is_default, created_at) VALUES (?, ?, 1, ?)",
      params: [newId("dom_"), host, now],
    },
  ]);
  const s = await getSettings(db, true);
  await saveSettings(db, { instance_name: input.instance_name, ...(s.secret ? {} : { secret: randomString(48) }) });
  invalidateDomains();
  await createSession(c, id);
  return c.json({ ok: true });
});

r.post("/auth/login", async (c) => {
  const p = c.get("platform");
  const input = await body(c, z.object({ email: z.string().max(320), password: z.string().max(200) }));
  const ip = p.clientIp(c.req.raw) || "unknown";
  const tkey = `login:${ip}:${input.email.toLowerCase()}`;
  if (!(await throttle(p.db, tkey, 8, 15 * 60_000)) || !(await throttle(p.db, `login-ip:${ip}`, 40, 15 * 60_000))) {
    throw new HttpError(429, "too_many_attempts", "Too many sign-in attempts. Wait 15 minutes and try again.");
  }
  const user = await p.db.first<UserRow>("SELECT * FROM users WHERE email = ?", [input.email.trim().toLowerCase()]);
  const ok = await verifyPassword(input.password, user?.password_hash ?? (await dummyHash()));
  if (!user || !ok || user.disabled) {
    throw new HttpError(401, "invalid_credentials", "Email or password is wrong.");
  }
  await clearThrottle(p.db, tkey);
  await createSession(c, user.id);
  c.set("actor", { type: "user", user, scopes: new Set(), sessionId: "" });
  await audit(c, "auth.login", "user", user.id);
  return c.json({ ok: true });
});

r.post("/auth/logout", async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

async function inviteUser(c: Ctx, token: string) {
  const u = await c.get("platform").db.first<UserRow & { invite_expires_at: number }>("SELECT * FROM users WHERE invite_hash = ?", [await sha256(token)]);
  if (!u || !u.invite_expires_at || u.invite_expires_at < Date.now()) {
    throw new HttpError(410, "invite_invalid", "This invite link is invalid or has expired. Ask an admin for a new one.");
  }
  return u;
}

r.get("/auth/invite/:token", async (c) => {
  const u = await inviteUser(c, c.req.param("token"));
  return c.json({ email: u.email, name: u.name, role: u.role, reset: !!u.password_hash });
});

r.post("/auth/invite/:token", async (c) => {
  const u = await inviteUser(c, c.req.param("token"));
  const input = await body(c, z.object({ password, name: z.string().trim().max(100).optional() }));
  const { db } = c.get("platform");
  await db.run("UPDATE users SET password_hash = ?, name = COALESCE(?, name), invite_hash = NULL, invite_expires_at = NULL WHERE id = ?", [
    await hashPassword(input.password),
    input.name || null,
    u.id,
  ]);
  await db.run("DELETE FROM sessions WHERE user_id = ?", [u.id]);
  await createSession(c, u.id);
  return c.json({ ok: true });
});

r.get("/me", async (c) => {
  const a = actorOf(c);
  const s = await getSettings(c.get("platform").db);
  return c.json({
    user: userView(a.user),
    via: a.type,
    scopes: [...a.scopes],
    settings: publicSettings(s),
  });
});

r.patch("/me", requireSession, async (c) => {
  const a = actorOf(c);
  const input = await body(c, z.object({ name: z.string().trim().max(100).optional(), email: z.email().optional() }));
  const { db } = c.get("platform");
  if (input.email) {
    const taken = await db.first<{ id: string }>("SELECT id FROM users WHERE email = ? AND id != ?", [input.email.toLowerCase(), a.user.id]);
    if (taken) throw new HttpError(409, "email_taken", "Another account uses this email.");
  }
  await db.run("UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email) WHERE id = ?", [
    input.name ?? null,
    input.email?.toLowerCase() ?? null,
    a.user.id,
  ]);
  return c.json({ ok: true });
});

r.post("/me/password", requireSession, async (c) => {
  const a = actorOf(c);
  if (a.type !== "user") throw new HttpError(403, "session_required", "Sign in to change your password.");
  const input = await body(c, z.object({ current: z.string(), next: password }));
  const { db } = c.get("platform");
  if (!(await verifyPassword(input.current, a.user.password_hash))) throw new HttpError(422, "wrong_password", "Your current password is not right.");
  await db.run("UPDATE users SET password_hash = ? WHERE id = ?", [await hashPassword(input.next), a.user.id]);
  await db.run("DELETE FROM sessions WHERE user_id = ? AND id != ?", [a.user.id, a.sessionId]);
  await audit(c, "user.password_changed", "user", a.user.id);
  return c.json({ ok: true });
});

r.get("/me/sessions", requireSession, async (c) => {
  const a = actorOf(c);
  const rows = await c
    .get("platform")
    .db.all<{
      id: string;
      created_at: number;
      last_seen_at: number;
      ip: string | null;
      user_agent: string | null;
    }>("SELECT id, created_at, last_seen_at, ip, user_agent FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC", [a.user.id, Date.now()]);
  return c.json({ data: rows.map((s) => ({ ...s, current: a.type === "user" && s.id === a.sessionId })) });
});

r.delete("/me/sessions/:id", requireSession, async (c) => {
  const a = actorOf(c);
  await c.get("platform").db.run("DELETE FROM sessions WHERE id = ? AND user_id = ?", [c.req.param("id"), a.user.id]);
  return c.json({ ok: true });
});

export default r;
