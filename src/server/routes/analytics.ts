import { Hono } from "hono";
import { type AppEnv, type Ctx, actorOf, canUseDomain, requireScope } from "../auth";
import { listDomains } from "../domains";
import { notFound } from "../errors";
import { type LinkRow, shortUrl } from "../links";
import { csvEscape, intParam } from "./util";

const r = new Hono<AppEnv>();
const DAY = 864e5;

function range(q: Record<string, string>) {
  const to = q.to ? Number(q.to) || Date.parse(q.to) : Date.now();
  const from = q.from ? Number(q.from) || Date.parse(q.from) : to - 30 * DAY;
  return { from: Math.min(from, to), to };
}

async function scope(c: Ctx) {
  const a = actorOf(c);
  const { db } = c.get("platform");
  const q = c.req.query();
  const where: string[] = ["ts >= ?", "ts <= ?"];
  const { from, to } = range(q);
  const params: (string | number)[] = [from, to];
  if (q.link_id) {
    const l = await db.first<LinkRow>("SELECT * FROM links WHERE id = ?", [q.link_id]);
    if (!l || !canUseDomain(a, l.domain_id)) throw notFound("Link");
    where.push("link_id = ?");
    params.push(l.id);
  } else if (q.domain || q.tag || (a.type === "key" && a.domainIds)) {
    const sub: string[] = [];
    if (q.domain) {
      sub.push("domain_id = (SELECT id FROM domains WHERE id = ? OR hostname = ?)");
      params.push(q.domain, q.domain);
    }
    if (q.tag) {
      sub.push("EXISTS (SELECT 1 FROM json_each(links.tags) WHERE lower(value) = lower(?))");
      params.push(q.tag);
    }
    if (a.type === "key" && a.domainIds) {
      sub.push(`domain_id IN (${a.domainIds.map(() => "?").join(",") || "''"})`);
      params.push(...a.domainIds);
    }
    where.push(`link_id IN (SELECT id FROM links WHERE ${sub.join(" AND ")})`);
  }
  if (q.bots !== "1") where.push("is_bot = 0");
  return { where: where.join(" AND "), params, from, to };
}

r.get("/analytics", requireScope("analytics:read"), async (c) => {
  const { db } = c.get("platform");
  const { where, params, from, to } = await scope(c);
  const span = to - from;
  const bucket = span <= 2 * DAY ? 3600_000 : DAY;
  // Client timezone offset in minutes (as returned by Date#getTimezoneOffset, negated).
  const tz = intParam(c.req.query("tz"), 0, -840, 840) * 60_000;
  const limit = intParam(c.req.query("limit"), 10, 1, 100);

  const group = (col: string) =>
    db.all<{ key: string | null; clicks: number }>(
      `SELECT ${col} AS key, COUNT(*) AS clicks FROM clicks WHERE ${where} GROUP BY 1 ORDER BY 2 DESC LIMIT ${limit}`,
      params,
    );

  const [totals, series, countries, cities, referrers, browsers, os, devices, languages, targets, top, hours] = await Promise.all([
    db.first<{ clicks: number; visitors: number; qr: number }>(
      `SELECT COUNT(*) AS clicks, COUNT(DISTINCT visitor) AS visitors, COALESCE(SUM(is_qr), 0) AS qr FROM clicks WHERE ${where}`,
      params,
    ),
    db.all<{ t: number; clicks: number; visitors: number }>(
      `SELECT ((ts + ${tz}) / ${bucket}) * ${bucket} - ${tz} AS t, COUNT(*) AS clicks, COUNT(DISTINCT visitor) AS visitors
       FROM clicks WHERE ${where} GROUP BY 1 ORDER BY 1`,
      params,
    ),
    group("country"),
    db.all<{ key: string | null; country: string | null; clicks: number }>(
      `SELECT city AS key, country, COUNT(*) AS clicks FROM clicks WHERE ${where} AND city IS NOT NULL GROUP BY 1, 2 ORDER BY 3 DESC LIMIT ${limit}`,
      params,
    ),
    group("referrer"),
    group("browser"),
    group("os"),
    group("device"),
    group("language"),
    group("target"),
    c.req.query("link_id")
      ? Promise.resolve([])
      : db.all<{ link_id: string; clicks: number }>(
          `SELECT link_id, COUNT(*) AS clicks FROM clicks WHERE ${where} GROUP BY 1 ORDER BY 2 DESC LIMIT ${limit}`,
          params,
        ),
    db.all<{ h: number; clicks: number }>(
      `SELECT ((ts + ${tz}) / 3600000) % 24 AS h, COUNT(*) AS clicks FROM clicks WHERE ${where} GROUP BY 1`,
      params,
    ),
  ]);

  // Zero-fill the series so charts can draw continuous ground.
  const filled: { t: number; clicks: number; visitors: number }[] = [];
  const byT = new Map(series.map((s) => [Number(s.t), s]));
  const start = Math.floor((from + tz) / bucket) * bucket - tz;
  for (let t = start; t <= to && filled.length < 2000; t += bucket) {
    const s = byT.get(t);
    filled.push({ t, clicks: s?.clicks ?? 0, visitors: s?.visitors ?? 0 });
  }

  let topLinks: unknown[] = [];
  if (top.length) {
    const ids = top.map((t) => t.link_id);
    const rows = await db.all<LinkRow>(`SELECT * FROM links WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
    const domains = await listDomains(db);
    topLinks = top.map((t) => {
      const l = rows.find((x) => x.id === t.link_id);
      const d = l && domains.find((x) => x.id === l.domain_id);
      return { id: t.link_id, clicks: t.clicks, slug: l?.slug ?? null, title: l?.title ?? null, url: l?.url ?? null, short_url: d && l ? shortUrl(d, l.slug) : null };
    });
  }

  const hourly = Array.from({ length: 24 }, (_, h) => hours.find((x) => Number(x.h) === h)?.clicks ?? 0);

  return c.json({
    from,
    to,
    bucket: bucket === DAY ? "day" : "hour",
    totals: { clicks: totals?.clicks ?? 0, visitors: totals?.visitors ?? 0, qr: totals?.qr ?? 0 },
    series: filled,
    hourly,
    countries,
    cities,
    referrers,
    browsers,
    os,
    devices,
    languages,
    targets,
    top_links: topLinks,
  });
});

r.get("/analytics/clicks", requireScope("analytics:read"), async (c) => {
  const { db } = c.get("platform");
  const { where, params } = await scope(c);
  const limit = intParam(c.req.query("limit"), 50, 1, 500);
  const before = c.req.query("before");
  const rows = await db.all(
    `SELECT id, link_id, ts, country, region, city, referrer, browser, os, device, language, is_bot, is_qr, target
     FROM clicks WHERE ${where} ${before ? "AND id < ?" : ""} ORDER BY id DESC LIMIT ?`,
    [...params, ...(before ? [Number(before)] : []), limit],
  );
  return c.json({ data: rows });
});

r.get("/analytics/export.csv", requireScope("analytics:read"), async (c) => {
  const { db } = c.get("platform");
  const { where, params } = await scope(c);
  const rows = await db.all<Record<string, unknown>>(
    `SELECT c.ts, l.slug, c.country, c.region, c.city, c.referrer, c.browser, c.os, c.device, c.language, c.is_bot, c.is_qr, c.target
     FROM clicks c LEFT JOIN links l ON l.id = c.link_id WHERE ${where.replace(/\bts\b/g, "c.ts").replace(/\blink_id\b/g, "c.link_id").replace(/\bis_bot\b/g, "c.is_bot")}
     ORDER BY c.ts DESC LIMIT 100000`,
    params,
  );
  const cols = ["time", "slug", "country", "region", "city", "referrer", "browser", "os", "device", "language", "bot", "qr", "target"];
  const lines = [cols.join(",")];
  for (const r of rows) {
    lines.push(
      [new Date(Number(r.ts)).toISOString(), r.slug, r.country, r.region, r.city, r.referrer, r.browser, r.os, r.device, r.language, r.is_bot, r.is_qr, r.target]
        .map(csvEscape)
        .join(","),
    );
  }
  return c.body(lines.join("\n"), 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="waymark-clicks.csv"' });
});

export default r;
