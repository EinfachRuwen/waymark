import { getCookie, setCookie } from "hono/cookie";
import type { Ctx } from "./auth";
import { domainForHost, slugKey } from "./domains";
import { hmac, sha256, verifyPassword } from "./lib/crypto";
import { parseUa, type UaInfo } from "./lib/ua";
import type { LinkRow, Rule, Utm, Variant } from "./links";
import { cloakPage, expiredPage, notFoundPage, passwordPage, previewPage, rootPage } from "./pages";
import type { Geo } from "./platform";
import { getSettings } from "./settings";
import { emit } from "./webhooks";

const NO_STORE = { "cache-control": "private, no-store, max-age=0", "x-robots-tag": "noindex" };

function html(body: string, status = 200, extra: Record<string, string> = {}) {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...NO_STORE, ...extra } });
}

function redirect(location: string, status: number) {
  return new Response(null, { status, headers: { location, ...NO_STORE } });
}

export async function handleRedirect(c: Ctx): Promise<Response> {
  const p = c.get("platform");
  const { db } = p;
  const reqUrl = new URL(c.req.url);
  let path: string;
  try {
    path = decodeURIComponent(reqUrl.pathname.slice(1)).replace(/\/+$/, "");
  } catch {
    path = reqUrl.pathname.slice(1);
  }
  const domain = await domainForHost(db, c.req.header("host"));
  const lang = (c.req.header("accept-language") || "").split(",")[0]?.split(/[-;]/)[0]?.trim().toLowerCase() || null;
  const pl = lang === "de" ? "de" : "en";

  if (!domain) {
    // Fresh install: nothing configured yet.
    return redirect("/_/", 302);
  }
  const settings = await getSettings(db);

  if (!path) {
    if (domain.root_redirect) return redirect(domain.root_redirect, 302);
    return html(rootPage(settings.instance_name, pl));
  }

  const link = await db.first<LinkRow>("SELECT * FROM links WHERE domain_id = ? AND slug_key = ?", [domain.id, slugKey(domain, path)]);
  const now = Date.now();

  if (!link || link.archived || (link.starts_at && link.starts_at > now)) {
    if (domain.not_found_redirect) return redirect(domain.not_found_redirect, 302);
    return html(notFoundPage(domain.hostname, path, pl), 404);
  }

  if ((link.expires_at && link.expires_at <= now) || (link.max_clicks && link.clicks >= link.max_clicks)) {
    if (link.expired_url) return redirect(link.expired_url, 302);
    return html(expiredPage(domain.hostname, link.slug, pl), 410);
  }

  const ua = parseUa(c.req.header("user-agent"));
  const geo = p.geo(c.req.raw);
  let passwordJustEntered = false;

  if (link.password_hash) {
    const cookieName = `wm_pw_${link.id}`;
    const expected = await hmac(settings.secret, `${link.id}:${link.password_hash.slice(-24)}`);
    if (getCookie(c, cookieName) !== expected) {
      if (c.req.method === "POST") {
        const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
        const ok = await verifyPassword(String(form.password ?? ""), link.password_hash);
        if (!ok) return html(passwordPage(domain.hostname, link.slug, true, pl), 401);
        setCookie(c, cookieName, expected, {
          httpOnly: true,
          secure: p.env.DEV !== "1",
          sameSite: "Lax",
          path: "/" + link.slug.split("/").map(encodeURIComponent).join("/"),
          maxAge: 86400,
        });
        passwordJustEntered = true;
      } else {
        return html(passwordPage(domain.hostname, link.slug, false, pl));
      }
    }
  }

  // Social previews get the custom Open Graph card instead of the redirect.
  if (ua.preview && !link.password_hash && (link.og_title || link.og_image || link.og_description)) {
    return html(previewPage(link.url, { title: link.og_title, description: link.og_description, image: link.og_image }));
  }

  const picked = pickTarget(link, ua, geo, lang);
  const isQr = reqUrl.searchParams.has("qr");
  const target = buildTarget(picked.url, link, reqUrl.searchParams);

  if (settings.track_clicks && (!ua.bot || settings.count_bots)) {
    p.waitUntil(recordClick(c, link, settings.secret, ua, geo, lang, isQr, picked.label).catch((e) => console.error("click log failed", e)));
  }

  const headers = new Headers(NO_STORE);
  if (link.cloak) return html(cloakPage(target, link.title), 200, Object.fromEntries(headers));
  const status = passwordJustEntered ? 303 : link.redirect_type || settings.default_redirect || 302;
  return redirect(target, status);
}

function pickTarget(link: LinkRow, ua: UaInfo, geo: Geo, lang: string | null): { url: string; label: string } {
  if (link.rules) {
    const rules = JSON.parse(link.rules) as Rule[];
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      const v = r.type === "country" ? geo.country?.toUpperCase() : r.type === "device" ? ua.device : r.type === "os" ? ua.os.toLowerCase() : lang;
      if (v && r.values.includes(v)) return { url: r.url, label: `rule:${i}` };
    }
  }
  if (link.variants) {
    const vs = JSON.parse(link.variants) as Variant[];
    const used = vs.reduce((s, v) => s + v.weight, 0);
    const mainWeight = Math.max(0, 100 - used);
    let roll = Math.random() * (used + mainWeight);
    if (roll < mainWeight) return { url: link.url, label: "main" };
    roll -= mainWeight;
    for (let i = 0; i < vs.length; i++) {
      if (roll < vs[i].weight) return { url: vs[i].url, label: `variant:${i}` };
      roll -= vs[i].weight;
    }
  }
  return { url: link.url, label: "main" };
}

export function buildTarget(url: string, link: Pick<LinkRow, "utm" | "forward_query">, incoming: URLSearchParams): string {
  const utm = link.utm ? (JSON.parse(link.utm) as Utm) : null;
  const forward = link.forward_query ? [...incoming.entries()].filter(([k]) => k !== "qr") : [];
  if (!utm && !forward.length) return url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (!/^https?:$/.test(u.protocol)) return url;
  if (utm) {
    for (const [k, v] of Object.entries(utm)) if (v && !u.searchParams.has(`utm_${k}`)) u.searchParams.set(`utm_${k}`, v);
  }
  for (const [k, v] of forward) u.searchParams.set(k, v);
  return u.toString();
}

async function recordClick(c: Ctx, link: LinkRow, secret: string, ua: UaInfo, geo: Geo, lang: string | null, isQr: boolean, target: string) {
  const p = c.get("platform");
  const now = Date.now();
  const ip = p.clientIp(c.req.raw) || "";
  const day = new Date(now).toISOString().slice(0, 10);
  // Daily-rotating, salted visitor hash: counts unique visitors, stores no IP.
  const visitor = (await sha256(`${secret}|${day}|${ip}|${c.req.header("user-agent") || ""}`)).slice(0, 16);
  let referrer: string | null = null;
  const ref = c.req.header("referer");
  if (ref) {
    try {
      referrer = new URL(ref).hostname.replace(/^www\./, "") || null;
    } catch {
      referrer = null;
    }
  }
  await p.db.batch([
    {
      sql: `INSERT INTO clicks (link_id, ts, visitor, country, region, city, referrer, browser, os, device, language, is_bot, is_qr, target)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        link.id,
        now,
        visitor,
        geo.country ?? null,
        geo.region ?? null,
        geo.city ?? null,
        referrer,
        ua.browser,
        ua.os,
        ua.device,
        lang,
        ua.bot,
        isQr,
        target,
      ],
    },
    { sql: "UPDATE links SET clicks = clicks + 1, last_click_at = ? WHERE id = ?", params: [now, link.id] },
  ]);
  if (!ua.bot) {
    await emit(p.db, "link.clicked", {
      link_id: link.id,
      slug: link.slug,
      country: geo.country ?? null,
      device: ua.device,
      referrer,
      qr: isQr,
      target,
    });
  }
}
