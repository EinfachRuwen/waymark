import { Hono } from "hono";
import { z } from "zod";
import { ALL_SCOPES, ROLE_SCOPES, type Role, type Scope, WEBHOOK_EVENTS, type WebhookEvent } from "../../shared/permissions";
import { type AppEnv, type Ctx, type UserRow, actorOf, audit, requireRole, requireScope, requireSession, userView } from "../auth";
import { domainView, invalidateDomains, listDomains, normalizeHost } from "../domains";
import { HttpError, notFound } from "../errors";
import { newId, randomString, sha256 } from "../lib/crypto";
import { checkUrl } from "../links";
import { getSettings, publicSettings, saveSettings } from "../settings";
import { deliver, invalidateWebhooks } from "../webhooks";
import { body, intParam } from "./util";

const r = new Hono<AppEnv>();
const optionalUrl = z
  .string()
  .max(32_768)
  .nullish()
  .transform((v) => (v ? checkUrl(v) : null));

/* ───────────── Domains ───────────── */

r.get("/domains", requireScope("domains:read"), async (c) => {
  const { db } = c.get("platform");
  const a = actorOf(c);
  const counts = await db.all<{ domain_id: string; n: number }>("SELECT domain_id, COUNT(*) AS n FROM links GROUP BY 1");
  const rows = (await listDomains(db, true)).filter((d) => a.type !== "key" || !a.domainIds || a.domainIds.includes(d.id));
  return c.json({ data: rows.map((d) => domainView(d, counts.find((x) => x.domain_id === d.id)?.n ?? 0)) });
});

const domainSchema = z.object({
  hostname: z.string().min(3).max(253),
  is_default: z.boolean().optional(),
  root_redirect: optionalUrl,
  not_found_redirect: optionalUrl,
  slug_length: z.number().int().min(3).max(32).optional(),
  case_sensitive: z.boolean().optional(),
});

r.post("/domains", requireScope("domains:write"), async (c) => {
  const { db } = c.get("platform");
  const input = await body(c, domainSchema);
  const host = normalizeHost(input.hostname);
  if (!/^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$|^localhost(:\d+)?$/.test(host)) {
    throw new HttpError(422, "invalid_hostname", "Enter a hostname like go.example.com, without https:// or a path.");
  }
  if (await db.first("SELECT 1 FROM domains WHERE hostname = ?", [host])) throw new HttpError(409, "domain_exists", `${host} is already added.`);
  const id = newId("dom_");
  const first = !(await db.first("SELECT 1 FROM domains"));
  const stmts = [];
  if (input.is_default) stmts.push({ sql: "UPDATE domains SET is_default = 0", params: [] });
  stmts.push({
    sql: "INSERT INTO domains (id, hostname, is_default, root_redirect, not_found_redirect, slug_length, case_sensitive, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    params: [
      id,
      host,
      input.is_default || first ? 1 : 0,
      input.root_redirect ?? null,
      input.not_found_redirect ?? null,
      input.slug_length ?? 6,
      input.case_sensitive ? 1 : 0,
      Date.now(),
    ],
  });
  await db.batch(stmts);
  invalidateDomains();
  await audit(c, "domain.created", "domain", id, { hostname: host });
  const d = (await listDomains(db, true)).find((x) => x.id === id)!;
  return c.json(domainView(d, 0), 201);
});

r.patch("/domains/:id", requireScope("domains:write"), async (c) => {
  const { db } = c.get("platform");
  const id = c.req.param("id");
  const d = (await listDomains(db, true)).find((x) => x.id === id);
  if (!d) throw notFound("Domain");
  const input = await body(c, domainSchema.partial());
  const linkCount = (await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM links WHERE domain_id = ?", [id]))?.n ?? 0;
  if (input.case_sensitive !== undefined && !!input.case_sensitive !== !!d.case_sensitive && linkCount) {
    throw new HttpError(409, "domain_has_links", "Case sensitivity can only change while the domain has no links.");
  }
  if (input.is_default === false && d.is_default) throw new HttpError(422, "need_default", "Make another domain the default instead.");
  const host = input.hostname ? normalizeHost(input.hostname) : d.hostname;
  const stmts = [];
  if (input.is_default) stmts.push({ sql: "UPDATE domains SET is_default = 0", params: [] });
  stmts.push({
    sql: "UPDATE domains SET hostname = ?, is_default = ?, root_redirect = ?, not_found_redirect = ?, slug_length = ?, case_sensitive = ? WHERE id = ?",
    params: [
      host,
      input.is_default ? 1 : d.is_default,
      input.root_redirect !== undefined ? input.root_redirect : d.root_redirect,
      input.not_found_redirect !== undefined ? input.not_found_redirect : d.not_found_redirect,
      input.slug_length ?? d.slug_length,
      input.case_sensitive !== undefined ? (input.case_sensitive ? 1 : 0) : d.case_sensitive,
      id,
    ],
  });
  await db.batch(stmts);
  invalidateDomains();
  await audit(c, "domain.updated", "domain", id, input);
  return c.json(domainView((await listDomains(db, true)).find((x) => x.id === id)!, linkCount));
});

r.delete("/domains/:id", requireScope("domains:write"), async (c) => {
  const { db } = c.get("platform");
  const id = c.req.param("id");
  const d = (await listDomains(db, true)).find((x) => x.id === id);
  if (!d) throw notFound("Domain");
  const n = (await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM links WHERE domain_id = ?", [id]))?.n ?? 0;
  if (n) throw new HttpError(409, "domain_has_links", `${d.hostname} still has ${n} links. Move or delete them first.`);
  if (d.is_default && (await listDomains(db)).length > 1) throw new HttpError(409, "is_default", "Make another domain the default before removing this one.");
  await db.run("DELETE FROM domains WHERE id = ?", [id]);
  invalidateDomains();
  await audit(c, "domain.deleted", "domain", id, { hostname: d.hostname });
  return c.json({ ok: true });
});

/* ───────────── Tags ───────────── */

const TAG_COLORS = ["moss", "blaze", "sky", "ember", "slate", "heather"] as const;

r.get("/tags", requireScope("links:read"), async (c) => {
  const { db } = c.get("platform");
  const rows = await db.all<{ name: string; color: string; links: number }>(
    `SELECT t.name, t.color, (SELECT COUNT(*) FROM links l, json_each(l.tags) j WHERE lower(j.value) = lower(t.name)) AS links FROM tags t ORDER BY t.name COLLATE NOCASE`,
  );
  return c.json({ data: rows });
});

r.patch("/tags/:name", requireScope("links:write"), async (c) => {
  const { db } = c.get("platform");
  const name = c.req.param("name");
  const input = await body(c, z.object({ name: z.string().trim().min(1).max(48).optional(), color: z.enum(TAG_COLORS).optional() }));
  const tag = await db.first<{ name: string; color: string }>("SELECT * FROM tags WHERE name = ?", [name]);
  if (!tag) throw notFound("Tag");
  const stmts = [];
  if (input.name && input.name !== tag.name) {
    stmts.push(
      {
        sql: `UPDATE links SET tags = (SELECT json_group_array(CASE WHEN lower(value) = lower(?) THEN ? ELSE value END) FROM json_each(links.tags))
              WHERE EXISTS (SELECT 1 FROM json_each(links.tags) WHERE lower(value) = lower(?))`,
        params: [tag.name, input.name, tag.name],
      },
      { sql: "DELETE FROM tags WHERE name = ?", params: [tag.name] },
      {
        sql: "INSERT INTO tags (name, color) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET color = excluded.color",
        params: [input.name, input.color ?? tag.color],
      },
    );
  } else if (input.color) {
    stmts.push({ sql: "UPDATE tags SET color = ? WHERE name = ?", params: [input.color, tag.name] });
  }
  await db.batch(stmts);
  await audit(c, "tag.updated", "tag", tag.name, input);
  return c.json({ ok: true });
});

r.delete("/tags/:name", requireScope("links:write"), async (c) => {
  const { db } = c.get("platform");
  const name = c.req.param("name");
  await db.batch([
    {
      sql: `UPDATE links SET tags = (SELECT json_group_array(value) FROM json_each(links.tags) WHERE lower(value) != lower(?))
            WHERE EXISTS (SELECT 1 FROM json_each(links.tags) WHERE lower(value) = lower(?))`,
      params: [name, name],
    },
    { sql: "DELETE FROM tags WHERE name = ?", params: [name] },
  ]);
  await audit(c, "tag.deleted", "tag", name);
  return c.json({ ok: true });
});

/* ───────────── Team ───────────── */

r.get("/users", requireScope("users:read"), async (c) => {
  const rows = await c.get("platform").db.all<UserRow>("SELECT * FROM users ORDER BY created_at");
  return c.json({ data: rows.map(userView) });
});

const roleEnum = z.enum(["owner", "admin", "editor", "viewer"]);

function assertCanAssign(actorRole: Role, role: Role) {
  if (role === "owner" && actorRole !== "owner") throw new HttpError(403, "forbidden", "Only owners can make someone an owner.");
}

async function makeInvite(c: Ctx, userId: string) {
  const token = randomString(40);
  await c.get("platform").db.run("UPDATE users SET invite_hash = ?, invite_expires_at = ? WHERE id = ?", [await sha256(token), Date.now() + 7 * 864e5, userId]);
  const origin = new URL(c.req.url).origin;
  return `${origin}/_/invite/${token}`;
}

r.post("/users", requireScope("users:write"), async (c) => {
  const a = actorOf(c);
  const { db } = c.get("platform");
  const input = await body(c, z.object({ email: z.email(), name: z.string().trim().max(100).default(""), role: roleEnum.default("editor") }));
  assertCanAssign(a.user.role, input.role);
  if (await db.first("SELECT 1 FROM users WHERE email = ?", [input.email.toLowerCase()]))
    throw new HttpError(409, "email_taken", "Someone with this email is already on the team.");
  const id = newId("usr_");
  await db.run("INSERT INTO users (id, email, name, role, created_at) VALUES (?, ?, ?, ?, ?)", [
    id,
    input.email.toLowerCase(),
    input.name,
    input.role,
    Date.now(),
  ]);
  const invite_url = await makeInvite(c, id);
  await audit(c, "user.invited", "user", id, { email: input.email, role: input.role });
  const u = await db.first<UserRow>("SELECT * FROM users WHERE id = ?", [id]);
  return c.json({ ...userView(u!), invite_url }, 201);
});

r.patch("/users/:id", requireScope("users:write"), async (c) => {
  const a = actorOf(c);
  const { db } = c.get("platform");
  const id = c.req.param("id");
  const u = await db.first<UserRow>("SELECT * FROM users WHERE id = ?", [id]);
  if (!u) throw notFound("User");
  const input = await body(c, z.object({ name: z.string().trim().max(100).optional(), role: roleEnum.optional(), disabled: z.boolean().optional() }));
  if (u.role === "owner" && a.user.role !== "owner") throw new HttpError(403, "forbidden", "Only owners can change another owner.");
  if (input.role) assertCanAssign(a.user.role, input.role);
  if (id === a.user.id && (input.role || input.disabled)) throw new HttpError(422, "self_change", "You cannot change your own role or disable yourself.");
  if (u.role === "owner" && ((input.role && input.role !== "owner") || input.disabled)) {
    const owners = (await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND disabled = 0"))?.n ?? 0;
    if (owners <= 1) throw new HttpError(422, "last_owner", "Waymark needs at least one active owner.");
  }
  await db.run("UPDATE users SET name = COALESCE(?, name), role = COALESCE(?, role), disabled = COALESCE(?, disabled) WHERE id = ?", [
    input.name ?? null,
    input.role ?? null,
    input.disabled === undefined ? null : input.disabled ? 1 : 0,
    id,
  ]);
  if (input.disabled) await db.run("DELETE FROM sessions WHERE user_id = ?", [id]);
  await audit(c, "user.updated", "user", id, input);
  return c.json(userView((await db.first<UserRow>("SELECT * FROM users WHERE id = ?", [id]))!));
});

r.post("/users/:id/invite", requireScope("users:write"), async (c) => {
  const a = actorOf(c);
  const { db } = c.get("platform");
  const u = await db.first<UserRow>("SELECT * FROM users WHERE id = ?", [c.req.param("id")]);
  if (!u) throw notFound("User");
  if (u.role === "owner" && a.user.role !== "owner") throw new HttpError(403, "forbidden", "Only owners can reset an owner.");
  const invite_url = await makeInvite(c, u.id);
  await audit(c, "user.reset_link", "user", u.id);
  return c.json({ invite_url });
});

r.delete("/users/:id", requireScope("users:write"), async (c) => {
  const a = actorOf(c);
  const { db } = c.get("platform");
  const id = c.req.param("id");
  const u = await db.first<UserRow>("SELECT * FROM users WHERE id = ?", [id]);
  if (!u) throw notFound("User");
  if (id === a.user.id) throw new HttpError(422, "self_delete", "You cannot remove yourself.");
  if (u.role === "owner" && a.user.role !== "owner") throw new HttpError(403, "forbidden", "Only owners can remove an owner.");
  await db.batch([
    { sql: "DELETE FROM sessions WHERE user_id = ?", params: [id] },
    { sql: "DELETE FROM api_keys WHERE user_id = ?", params: [id] },
    { sql: "DELETE FROM users WHERE id = ?", params: [id] },
  ]);
  await audit(c, "user.deleted", "user", id, { email: u.email });
  return c.json({ ok: true });
});

/* ───────────── API keys ───────────── */

r.get("/api-keys", requireSession, async (c) => {
  const a = actorOf(c);
  const all = a.user.role === "owner" || a.user.role === "admin";
  const rows = await c.get("platform").db.all<Record<string, unknown>>(
    `SELECT k.id, k.name, k.prefix, k.scopes, k.domain_ids, k.expires_at, k.last_used_at, k.created_at, k.revoked_at, k.user_id, u.email AS user_email
     FROM api_keys k JOIN users u ON u.id = k.user_id ${all ? "" : "WHERE k.user_id = ?"} ORDER BY k.revoked_at IS NOT NULL, k.created_at DESC`,
    all ? [] : [a.user.id],
  );
  return c.json({
    data: rows.map((k) => ({ ...k, scopes: JSON.parse(k.scopes as string), domain_ids: k.domain_ids ? JSON.parse(k.domain_ids as string) : null })),
  });
});

r.post("/api-keys", requireSession, async (c) => {
  const a = actorOf(c);
  const { db } = c.get("platform");
  const input = await body(
    c,
    z.object({
      name: z.string().trim().min(1).max(80),
      scopes: z.array(z.enum(ALL_SCOPES as [Scope, ...Scope[]])).min(1),
      domain_ids: z.array(z.string()).min(1).nullish(),
      expires_at: z.number().nullish(),
    }),
  );
  const allowed = new Set(ROLE_SCOPES[a.user.role]);
  const denied = input.scopes.filter((s) => !allowed.has(s));
  if (denied.length) throw new HttpError(403, "scope_exceeds_role", `Your role cannot grant: ${denied.join(", ")}`);
  if (input.domain_ids) {
    const known = (await listDomains(db)).map((d) => d.id);
    if (input.domain_ids.some((d) => !known.includes(d))) throw new HttpError(422, "unknown_domain", "One of the selected domains does not exist.");
  }
  const secret = `wm_${randomString(40)}`;
  const id = newId("key_");
  await db.run("INSERT INTO api_keys (id, name, prefix, key_hash, user_id, scopes, domain_ids, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [
    id,
    input.name,
    secret.slice(0, 9),
    await sha256(secret),
    a.user.id,
    JSON.stringify(input.scopes),
    input.domain_ids ? JSON.stringify(input.domain_ids) : null,
    input.expires_at ?? null,
    Date.now(),
  ]);
  await audit(c, "api_key.created", "api_key", id, { name: input.name, scopes: input.scopes });
  return c.json({ id, name: input.name, key: secret, prefix: secret.slice(0, 9), scopes: input.scopes }, 201);
});

r.delete("/api-keys/:id", requireSession, async (c) => {
  const a = actorOf(c);
  const { db } = c.get("platform");
  const k = await db.first<{ id: string; user_id: string; name: string }>("SELECT id, user_id, name FROM api_keys WHERE id = ?", [c.req.param("id")]);
  if (!k || (k.user_id !== a.user.id && a.user.role !== "owner" && a.user.role !== "admin")) throw notFound("API key");
  await db.run("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", [Date.now(), k.id]);
  await audit(c, "api_key.revoked", "api_key", k.id, { name: k.name });
  return c.json({ ok: true });
});

/* ───────────── Webhooks ───────────── */

const eventEnum = z.enum(Object.keys(WEBHOOK_EVENTS) as [WebhookEvent, ...WebhookEvent[]]);

r.get("/webhooks", requireScope("webhooks:write"), async (c) => {
  const rows = await c.get("platform").db.all<Record<string, unknown>>("SELECT * FROM webhooks ORDER BY created_at DESC");
  return c.json({ data: rows.map((w) => ({ ...w, events: JSON.parse(w.events as string), active: !!w.active })) });
});

r.post("/webhooks", requireScope("webhooks:write"), async (c) => {
  const { db } = c.get("platform");
  const input = await body(c, z.object({ url: z.string().max(2048), events: z.array(eventEnum).min(1) }));
  const url = checkUrl(input.url);
  if (!url.startsWith("https://") && !url.startsWith("http://")) throw new HttpError(422, "invalid_url", "Webhooks need an http(s) URL.");
  const id = newId("whk_");
  const secret = `whsec_${randomString(32)}`;
  await db.run("INSERT INTO webhooks (id, url, secret, events, created_at) VALUES (?, ?, ?, ?, ?)", [
    id,
    url,
    secret,
    JSON.stringify(input.events),
    Date.now(),
  ]);
  invalidateWebhooks();
  await audit(c, "webhook.created", "webhook", id, { url, events: input.events });
  return c.json({ id, url, secret, events: input.events, active: true }, 201);
});

r.patch("/webhooks/:id", requireScope("webhooks:write"), async (c) => {
  const { db } = c.get("platform");
  const input = await body(c, z.object({ url: z.string().max(2048).optional(), events: z.array(eventEnum).min(1).optional(), active: z.boolean().optional() }));
  const res = await db.run(
    "UPDATE webhooks SET url = COALESCE(?, url), events = COALESCE(?, events), active = COALESCE(?, active), failures = CASE WHEN ? = 1 THEN 0 ELSE failures END WHERE id = ?",
    [
      input.url ? checkUrl(input.url) : null,
      input.events ? JSON.stringify(input.events) : null,
      input.active === undefined ? null : input.active ? 1 : 0,
      input.active ? 1 : 0,
      c.req.param("id"),
    ],
  );
  if (!res.changes) throw notFound("Webhook");
  invalidateWebhooks();
  await audit(c, "webhook.updated", "webhook", c.req.param("id"), input);
  return c.json({ ok: true });
});

r.delete("/webhooks/:id", requireScope("webhooks:write"), async (c) => {
  await c.get("platform").db.run("DELETE FROM webhooks WHERE id = ?", [c.req.param("id")]);
  invalidateWebhooks();
  await audit(c, "webhook.deleted", "webhook", c.req.param("id"));
  return c.json({ ok: true });
});

r.post("/webhooks/:id/test", requireScope("webhooks:write"), async (c) => {
  const { db } = c.get("platform");
  const h = await db.first<{ id: string; url: string; secret: string; events: string }>("SELECT * FROM webhooks WHERE id = ?", [c.req.param("id")]);
  if (!h) throw notFound("Webhook");
  const status = await deliver(db, h, "ping", { message: "Test delivery from Waymark." });
  return c.json({ ok: status >= 200 && status < 300, status });
});

/* ───────────── Settings & audit ───────────── */

r.get("/settings", requireSession, async (c) => {
  return c.json(publicSettings(await getSettings(c.get("platform").db, true)));
});

r.patch("/settings", requireSession, requireRole("owner", "admin"), async (c) => {
  const { db } = c.get("platform");
  const input = await body(
    c,
    z.object({
      instance_name: z.string().trim().min(1).max(60).optional(),
      click_retention_days: z.number().int().min(0).max(3650).optional(),
      track_clicks: z.boolean().optional(),
      count_bots: z.boolean().optional(),
      default_redirect: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]).optional(),
      public_shorten: z.boolean().optional(),
      public_shorten_domain: z.string().nullish(),
      public_rate_limit: z.number().int().min(1).max(10000).optional(),
      cors_origins: z.string().max(2000).optional(),
    }),
  );
  await saveSettings(db, input as never);
  await audit(c, "settings.updated", "settings", null, input);
  return c.json(publicSettings(await getSettings(db, true)));
});

r.get("/audit", requireScope("audit:read"), async (c) => {
  const { db } = c.get("platform");
  const limit = intParam(c.req.query("limit"), 50, 1, 200);
  const before = c.req.query("before");
  const action = c.req.query("action");
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (before) {
    where.push("id < ?");
    params.push(Number(before));
  }
  if (action) {
    where.push("action LIKE ?");
    params.push(`${action}%`);
  }
  const rows = await db.all<Record<string, unknown>>(`SELECT * FROM audit_log ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`, [
    ...params,
    limit,
  ]);
  return c.json({ data: rows.map((x) => ({ ...x, detail: x.detail ? JSON.parse(x.detail as string) : null })) });
});

export default r;
