import { Hono } from "hono";
import { renderSVG } from "uqr";
import { z } from "zod";
import { type Actor, type AppEnv, type Ctx, actorOf, audit, canUseDomain, requireScope } from "../auth";
import type { Params } from "../db";
import { type DomainRow, listDomains, resolveDomain, slugKey } from "../domains";
import { HttpError, notFound } from "../errors";
import { checkSlug, createLink, type LinkRow, linkInput, linkPatch, linkView, shortUrl, updateLink } from "../links";
import { emit } from "../webhooks";
import { body, intParam, parse } from "./util";

const r = new Hono<AppEnv>();

async function domainFor(c: Ctx, ref: string | undefined): Promise<DomainRow> {
  const d = await resolveDomain(c.get("platform").db, ref);
  if (!d) throw new HttpError(422, "unknown_domain", ref ? `Domain ${ref} is not set up in Waymark.` : "Add a domain first.");
  if (!canUseDomain(actorOf(c), d.id)) throw new HttpError(403, "domain_forbidden", `This API key cannot use ${d.hostname}.`);
  return d;
}

async function loadLink(c: Ctx, id: string): Promise<LinkRow> {
  const l = await c.get("platform").db.first<LinkRow>("SELECT * FROM links WHERE id = ?", [id]);
  if (!l || !canUseDomain(actorOf(c), l.domain_id)) throw notFound("Link");
  return l;
}

function via(a: Actor) {
  return a.type === "key" ? `api:${a.key.name}` : "app";
}

function notify(c: Ctx, event: "link.created" | "link.updated" | "link.deleted", data: unknown) {
  const p = c.get("platform");
  p.waitUntil(emit(p.db, event, data).catch(() => {}));
}

r.get("/links", requireScope("links:read"), async (c) => {
  const { db } = c.get("platform");
  const a = actorOf(c);
  const q = c.req.query();
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (q.q) {
    where.push("(slug LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')");
    const like = `%${q.q.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
    params.push(like, like, like, like);
  }
  if (q.domain) {
    const d = await resolveDomain(db, q.domain);
    where.push("domain_id = ?");
    params.push(d?.id ?? "none");
  }
  if (a.type === "key" && a.domainIds) {
    where.push(`domain_id IN (${a.domainIds.map(() => "?").join(",") || "''"})`);
    params.push(...a.domainIds);
  }
  if (q.tag) {
    where.push("EXISTS (SELECT 1 FROM json_each(links.tags) WHERE lower(value) = lower(?))");
    params.push(q.tag);
  }
  const now = Date.now();
  switch (q.status) {
    case "archived":
      where.push("archived = 1");
      break;
    case "expired":
      where.push("archived = 0 AND ((expires_at IS NOT NULL AND expires_at <= ?) OR (max_clicks IS NOT NULL AND clicks >= max_clicks))");
      params.push(now);
      break;
    case "protected":
      where.push("archived = 0 AND password_hash IS NOT NULL");
      break;
    case "all":
      break;
    case "any":
      where.push("archived = 0");
      break;
    default:
      where.push("archived = 0 AND (expires_at IS NULL OR expires_at > ?) AND (max_clicks IS NULL OR clicks < max_clicks)");
      params.push(now);
  }
  if (q.external_id) {
    where.push("external_id = ?");
    params.push(q.external_id);
  }
  if (q.url) {
    where.push("url = ?");
    params.push(q.url);
  }

  const sorts: Record<string, string> = { created: "created_at", clicks: "clicks", last_click: "last_click_at", slug: "slug_key", updated: "updated_at" };
  const sort = sorts[q.sort ?? "created"] ?? "created_at";
  const order = q.order === "asc" ? "ASC" : "DESC";
  const limit = intParam(q.limit, 50, 1, 200);
  const offset = intParam(q.offset, 0, 0, 1e9);
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [rows, total] = await Promise.all([
    db.all<LinkRow>(`SELECT * FROM links ${w} ORDER BY ${sort} ${order} NULLS LAST, id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]),
    db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM links ${w}`, params),
  ]);
  const domains = await listDomains(db);
  return c.json({ data: rows.map((l) => linkView(l, domains)), total: total?.n ?? 0, limit, offset });
});

r.get("/links/check-slug", requireScope("links:read"), async (c) => {
  const d = await domainFor(c, c.req.query("domain"));
  let slug: string;
  try {
    slug = checkSlug(c.req.query("slug") ?? "");
  } catch (e) {
    return c.json({ available: false, reason: (e as Error).message });
  }
  const taken = await c.get("platform").db.first("SELECT 1 FROM links WHERE domain_id = ? AND slug_key = ?", [d.id, slugKey(d, slug)]);
  return c.json({ available: !taken, reason: taken ? `${d.hostname}/${slug} is taken.` : null });
});

const createSchema = linkInput.extend({
  /** Return an existing link for the same URL on the same domain instead of creating a duplicate. */
  reuse: z.boolean().optional(),
});

r.post("/links", requireScope("links:write"), async (c) => {
  const a = actorOf(c);
  const { db } = c.get("platform");
  const input = await body(c, createSchema);
  const d = await domainFor(c, input.domain);
  if (input.reuse && !input.slug) {
    const existing = await db.first<LinkRow>("SELECT * FROM links WHERE domain_id = ? AND url = ? AND archived = 0 ORDER BY created_at LIMIT 1", [
      d.id,
      input.url.trim(),
    ]);
    if (existing) return c.json(linkView(existing, await listDomains(db)), 200);
  }
  const { row } = await createLink(db, input, { domain: d, userId: a.user.id, via: via(a) });
  const view = linkView(row, await listDomains(db));
  await audit(c, "link.created", "link", row.id, { short_url: view.short_url, url: row.url });
  notify(c, "link.created", view);
  return c.json(view, 201);
});

const bulkItem = linkInput.extend({ created_at: z.number().optional(), clicks: z.number().int().min(0).optional() });

r.post("/links/bulk", requireScope("links:write"), async (c) => {
  const a = actorOf(c);
  const { db } = c.get("platform");
  const input = await body(
    c,
    z.object({
      links: z.array(z.unknown()).min(1).max(500),
      domain: z.string().optional(),
      on_conflict: z.enum(["fail", "skip", "overwrite"]).default("skip"),
      source: z.string().max(40).optional(),
    }),
  );
  const fallback = await domainFor(c, input.domain);
  const result = { created: 0, updated: 0, skipped: 0, failed: 0, errors: [] as { index: number; slug?: string; message: string }[], data: [] as unknown[] };
  for (let i = 0; i < input.links.length; i++) {
    try {
      const item = parse(bulkItem, input.links[i]);
      const d = item.domain ? await domainFor(c, item.domain) : fallback;
      const res = await createLink(db, item, {
        domain: d,
        userId: a.user.id,
        via: input.source ? `import:${input.source}` : via(a),
        onConflict: input.on_conflict,
        createdAt: item.created_at,
        clicks: item.clicks,
      });
      result[res.status]++;
      if (res.status !== "skipped") result.data.push({ index: i, id: res.row.id, short_url: shortUrl(d, res.row.slug) });
    } catch (e) {
      result.failed++;
      const slug = (input.links[i] as { slug?: string })?.slug;
      if (result.errors.length < 200) result.errors.push({ index: i, slug, message: (e as Error).message });
    }
  }
  await audit(c, "link.bulk_created", null, null, {
    created: result.created,
    updated: result.updated,
    skipped: result.skipped,
    failed: result.failed,
    source: input.source,
  });
  return c.json(result);
});

r.post("/links/actions", async (c) => {
  const a = actorOf(c);
  const { db } = c.get("platform");
  const input = await body(
    c,
    z.object({
      ids: z.array(z.string()).min(1).max(500),
      action: z.enum(["archive", "unarchive", "delete", "add_tags", "remove_tags", "reset_clicks"]),
      tags: z.array(z.string().trim().min(1).max(48)).max(30).optional(),
    }),
  );
  const need = input.action === "delete" || input.action === "reset_clicks" ? "links:delete" : "links:write";
  if (!a.scopes.has(need)) throw new HttpError(403, "forbidden", `Missing permission: ${need}`);
  const rows = (await db.all<LinkRow>(`SELECT * FROM links WHERE id IN (${input.ids.map(() => "?").join(",")})`, input.ids)).filter((l) =>
    canUseDomain(a, l.domain_id),
  );
  const now = Date.now();
  const stmts: { sql: string; params: Params }[] = [];
  for (const l of rows) {
    switch (input.action) {
      case "archive":
      case "unarchive":
        stmts.push({ sql: "UPDATE links SET archived = ?, updated_at = ? WHERE id = ?", params: [input.action === "archive" ? 1 : 0, now, l.id] });
        break;
      case "delete":
        stmts.push({ sql: "DELETE FROM clicks WHERE link_id = ?", params: [l.id] }, { sql: "DELETE FROM links WHERE id = ?", params: [l.id] });
        break;
      case "reset_clicks":
        stmts.push(
          { sql: "DELETE FROM clicks WHERE link_id = ?", params: [l.id] },
          { sql: "UPDATE links SET clicks = 0, last_click_at = NULL WHERE id = ?", params: [l.id] },
        );
        break;
      case "add_tags":
      case "remove_tags": {
        const cur = JSON.parse(l.tags) as string[];
        const t = (input.tags ?? []).map((x) => x.toLowerCase());
        const next =
          input.action === "add_tags"
            ? [...cur, ...(input.tags ?? []).filter((x) => !cur.some((y) => y.toLowerCase() === x.toLowerCase()))]
            : cur.filter((x) => !t.includes(x.toLowerCase()));
        stmts.push({ sql: "UPDATE links SET tags = ?, updated_at = ? WHERE id = ?", params: [JSON.stringify(next), now, l.id] });
      }
    }
  }
  if (input.action === "add_tags" && input.tags?.length) {
    for (const t of input.tags) stmts.push({ sql: "INSERT OR IGNORE INTO tags (name) VALUES (?)", params: [t] });
  }
  // D1 caps statements per batch; chunk to stay well under it.
  for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90));
  await audit(c, `link.bulk_${input.action}`, "link", null, { count: rows.length, tags: input.tags });
  return c.json({ ok: true, affected: rows.length });
});

r.get("/links/:id", requireScope("links:read"), async (c) => {
  const l = await loadLink(c, c.req.param("id"));
  return c.json(linkView(l, await listDomains(c.get("platform").db)));
});

r.patch("/links/:id", requireScope("links:write"), async (c) => {
  const { db } = c.get("platform");
  const l = await loadLink(c, c.req.param("id"));
  const input = await body(c, linkPatch);
  const d = input.domain ? await domainFor(c, input.domain) : undefined;
  const row = await updateLink(db, l, input, d);
  const view = linkView(row, await listDomains(db));
  const changed = Object.keys(input).filter((k) => k !== "password");
  await audit(c, "link.updated", "link", l.id, { fields: input.password !== undefined ? [...changed, "password"] : changed });
  notify(c, "link.updated", view);
  return c.json(view);
});

r.delete("/links/:id", requireScope("links:delete"), async (c) => {
  const { db } = c.get("platform");
  const l = await loadLink(c, c.req.param("id"));
  const view = linkView(l, await listDomains(db));
  await db.batch([
    { sql: "DELETE FROM clicks WHERE link_id = ?", params: [l.id] },
    { sql: "DELETE FROM links WHERE id = ?", params: [l.id] },
  ]);
  await audit(c, "link.deleted", "link", l.id, { short_url: view.short_url, url: l.url });
  notify(c, "link.deleted", view);
  return c.json({ ok: true });
});

r.get("/links/:id/qr", requireScope("links:read"), async (c) => {
  const l = await loadLink(c, c.req.param("id"));
  const d = (await listDomains(c.get("platform").db)).find((x) => x.id === l.domain_id)!;
  const fg = /^[0-9a-f]{6}$/i.test(c.req.query("fg") ?? "") ? `#${c.req.query("fg")}` : "#000000";
  const bg = /^[0-9a-f]{6}$/i.test(c.req.query("bg") ?? "") ? `#${c.req.query("bg")}` : "#ffffff";
  const track = c.req.query("track") !== "0";
  const svg = renderSVG(shortUrl(d, l.slug) + (track ? "?qr" : ""), { ecc: "M", border: 2, pixelSize: 10, blackColor: fg, whiteColor: bg });
  return c.body(svg, 200, { "content-type": "image/svg+xml", "content-disposition": `inline; filename="${l.slug.replace(/[^\w-]/g, "_")}.svg"` });
});

r.post("/links/:id/check", requireScope("links:read"), async (c) => {
  const l = await loadLink(c, c.req.param("id"));
  const started = Date.now();
  try {
    const res = await fetch(l.url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(8000), headers: { "user-agent": "Waymark-LinkCheck/1" } });
    await res.body?.cancel().catch(() => {});
    return c.json({ ok: res.status < 400, status: res.status, location: res.headers.get("location"), ms: Date.now() - started });
  } catch (e) {
    return c.json({
      ok: false,
      status: 0,
      error: (e as Error).name === "TimeoutError" ? "Timed out after 8 seconds." : "Could not connect.",
      ms: Date.now() - started,
    });
  }
});

export default r;
