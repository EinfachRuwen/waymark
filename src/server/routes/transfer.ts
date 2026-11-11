import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, type Ctx, actorOf, audit, canUseDomain, requireRole, requireScope, requireSession, throttle } from "../auth";
import { invalidateDomains, listDomains, resolveDomain } from "../domains";
import { HttpError } from "../errors";
import { createLink, type LinkInput, type LinkRow, linkView, shortUrl } from "../links";
import { getSettings, invalidateSettings } from "../settings";
import { body, csvEscape } from "./util";

const r = new Hono<AppEnv>();

/* ───────────── Short.io import ─────────────
 * The browser drives the import page by page. Each request makes exactly one
 * call to Short.io, which keeps us inside the Workers subrequest and CPU limits
 * no matter how many links an account has. */

const SHORTIO = "https://api.short.io";

async function shortio(apiKey: string, path: string) {
  const res = await fetch(SHORTIO + path, { headers: { authorization: apiKey, accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 401 || res.status === 403)
    throw new HttpError(422, "shortio_auth", "Short.io rejected the API key. Use a secret key from Short.io → Integrations & API.");
  if (!res.ok) throw new HttpError(502, "shortio_error", `Short.io answered ${res.status}. Try again in a moment.`);
  return res.json() as Promise<unknown>;
}

r.post("/import/shortio/domains", requireScope("links:write"), async (c) => {
  const { api_key } = await body(c, z.object({ api_key: z.string().min(8).max(200) }));
  const data = (await shortio(api_key, "/api/domains")) as { id: number; hostname: string; linksCount?: number }[];
  return c.json({ data: (Array.isArray(data) ? data : []).map((d) => ({ id: String(d.id), hostname: d.hostname, links: d.linksCount ?? null })) });
});

interface ShortioLink {
  idString?: string;
  id?: string | number;
  path?: string;
  originalURL?: string;
  title?: string | null;
  tags?: string[];
  createdAt?: string;
  expiresAt?: number | string | null;
  expiredURL?: string | null;
  cloaking?: boolean;
  redirectType?: number | string | null;
  archived?: boolean;
  clicksLimit?: number | null;
  iphoneURL?: string | null;
  androidURL?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
}

export function mapShortioLink(l: ShortioLink): LinkInput & { created_at?: number } {
  const rules: NonNullable<LinkInput["rules"]> = [];
  if (l.iphoneURL) rules.push({ type: "os", values: ["ios", "ipados"], url: l.iphoneURL });
  if (l.androidURL) rules.push({ type: "os", values: ["android"], url: l.androidURL });
  const rt = Number(l.redirectType);
  const exp = l.expiresAt ? (typeof l.expiresAt === "number" ? l.expiresAt : Date.parse(l.expiresAt)) : null;
  const utm = {
    source: l.utmSource || undefined,
    medium: l.utmMedium || undefined,
    campaign: l.utmCampaign || undefined,
    term: l.utmTerm || undefined,
    content: l.utmContent || undefined,
  };
  return {
    url: l.originalURL || "",
    slug: l.path || undefined,
    title: l.title || null,
    tags: (l.tags || []).filter((t) => typeof t === "string" && t.trim()).slice(0, 30),
    expires_at: exp && Number.isFinite(exp) ? exp : null,
    expired_url: l.expiredURL || null,
    cloak: !!l.cloaking,
    redirect_type: [301, 302, 307, 308].includes(rt) ? (rt as 301) : undefined,
    archived: !!l.archived,
    max_clicks: l.clicksLimit && l.clicksLimit > 0 ? l.clicksLimit : null,
    rules: rules.length ? rules : null,
    utm: Object.values(utm).some(Boolean) ? utm : null,
    external_id: `shortio:${l.idString ?? l.id ?? ""}`,
    created_at: l.createdAt ? Date.parse(l.createdAt) || undefined : undefined,
  };
}

r.post("/import/shortio/links", requireScope("links:write"), async (c) => {
  const a = actorOf(c);
  const { db } = c.get("platform");
  const input = await body(
    c,
    z.object({
      api_key: z.string().min(8).max(200),
      shortio_domain_id: z.string().regex(/^\d+$/),
      domain: z.string(),
      page_token: z.string().max(500).nullish(),
      on_conflict: z.enum(["skip", "overwrite"]).default("skip"),
    }),
  );
  const d = await resolveDomain(db, input.domain);
  if (!d || !canUseDomain(a, d.id)) throw new HttpError(422, "unknown_domain", "Pick a Waymark domain to import into.");
  const qs = new URLSearchParams({ domain_id: input.shortio_domain_id, limit: "150" });
  if (input.page_token) qs.set("pageToken", input.page_token);
  const page = (await shortio(input.api_key, `/api/links?${qs}`)) as { links?: ShortioLink[]; count?: number; nextPageToken?: string | null };
  const out = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [] as { slug?: string; message: string }[],
    total: page.count ?? null,
    next_page_token: page.nextPageToken || null,
  };
  for (const raw of page.links || []) {
    const item = mapShortioLink(raw);
    try {
      const res = await createLink(db, item, {
        domain: d,
        userId: a.user.id,
        via: "import:shortio",
        onConflict: input.on_conflict,
        createdAt: item.created_at,
      });
      out[res.status]++;
    } catch (e) {
      out.failed++;
      if (out.errors.length < 100) out.errors.push({ slug: item.slug ?? undefined, message: (e as Error).message });
    }
  }
  await audit(c, "import.shortio_page", "domain", d.id, { created: out.created, updated: out.updated, skipped: out.skipped, failed: out.failed });
  return c.json(out);
});

/* ───────────── Export ───────────── */

r.get("/export/links.csv", requireScope("links:read"), async (c) => {
  const a = actorOf(c);
  const { db } = c.get("platform");
  const domains = await listDomains(db);
  const rows = (await db.all<LinkRow>("SELECT * FROM links ORDER BY created_at")).filter((l) => canUseDomain(a, l.domain_id));
  const cols = ["short_url", "domain", "slug", "url", "title", "tags", "clicks", "created_at", "expires_at", "max_clicks", "archived", "notes"];
  const lines = [cols.join(",")];
  for (const l of rows) {
    const v = linkView(l, domains);
    lines.push(
      [
        v.short_url,
        v.domain,
        v.slug,
        v.url,
        v.title,
        v.tags.join("|"),
        v.clicks,
        new Date(v.created_at).toISOString(),
        v.expires_at ? new Date(v.expires_at).toISOString() : "",
        v.max_clicks ?? "",
        v.archived ? 1 : 0,
        v.notes,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return c.body(lines.join("\n"), 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="waymark-links.csv"' });
});

/** Complete backup of links, domains and tags. Passwords stay hashed. */
r.get("/export/backup.json", requireSession, requireRole("owner", "admin"), async (c) => {
  const { db } = c.get("platform");
  const [domains, links, tags] = await Promise.all([db.all("SELECT * FROM domains"), db.all("SELECT * FROM links"), db.all("SELECT * FROM tags")]);
  await audit(c, "export.backup", null, null, { links: links.length });
  return c.body(JSON.stringify({ format: "waymark-backup", version: 1, exported_at: new Date().toISOString(), domains, links, tags }), 200, {
    "content-type": "application/json",
    "content-disposition": `attachment; filename="waymark-backup-${new Date().toISOString().slice(0, 10)}.json"`,
  });
});

r.post("/import/backup", requireSession, requireRole("owner", "admin"), async (c) => {
  const { db } = c.get("platform");
  const data = (await c.req.json().catch(() => null)) as {
    format?: string;
    domains?: Record<string, unknown>[];
    links?: Record<string, unknown>[];
    tags?: Record<string, unknown>[];
  } | null;
  if (!data || data.format !== "waymark-backup") throw new HttpError(422, "invalid_backup", "This file is not a Waymark backup.");
  const insert = (table: string, row: Record<string, unknown>) => {
    const keys = Object.keys(row).filter((k) => /^[a-z_]+$/.test(k));
    return {
      sql: `INSERT OR IGNORE INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
      params: keys.map((k) => row[k] as string | number | null),
    };
  };
  const existing = await listDomains(db, true);
  const domainMap = new Map<string, string>();
  const stmts = [];
  for (const d of data.domains ?? []) {
    const same = existing.find((x) => x.hostname === String(d.hostname).toLowerCase());
    if (same) domainMap.set(String(d.id), same.id);
    else {
      domainMap.set(String(d.id), String(d.id));
      stmts.push(insert("domains", { ...d, is_default: existing.length ? 0 : d.is_default }));
    }
  }
  for (const t of data.tags ?? []) stmts.push(insert("tags", t));
  let count = 0;
  for (const l of data.links ?? []) {
    const dom = domainMap.get(String(l.domain_id));
    if (!dom) continue;
    stmts.push(insert("links", { ...l, domain_id: dom }));
    count++;
  }
  for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90));
  invalidateDomains();
  invalidateSettings();
  await audit(c, "import.backup", null, null, { links: count });
  return c.json({ ok: true, links: count });
});

/* ───────────── Public shortening (off by default) ───────────── */

export async function publicShorten(c: Ctx) {
  const p = c.get("platform");
  const s = await getSettings(p.db);
  if (!s.public_shorten) throw new HttpError(404, "not_found", "Public shortening is turned off.");
  const ip = p.clientIp(c.req.raw) || "unknown";
  if (!(await throttle(p.db, `public:${ip}`, s.public_rate_limit, 3600_000))) {
    throw new HttpError(429, "rate_limited", "Too many links from your address. Try again in an hour.");
  }
  const { url } = await body(c, z.object({ url: z.string().min(1).max(4096) }));
  const d = await resolveDomain(p.db, s.public_shorten_domain);
  if (!d) throw new HttpError(500, "no_domain", "No domain is configured.");
  const { row } = await createLink(p.db, { url }, { domain: d, userId: null, via: "public" });
  return c.json({ short_url: shortUrl(d, row.slug), url: row.url }, 201);
}

export default r;
