import { Hono } from "hono";
import { type AppEnv, type Ctx, loadActor } from "./auth";
import { HttpError } from "./errors";
import { ensureMigrated } from "./migrations";
import type { Platform } from "./platform";
import { handleRedirect } from "./redirect";
import { getSettings } from "./settings";
import analytics from "./routes/analytics";
import admin from "./routes/admin";
import auth from "./routes/auth";
import links from "./routes/links";
import transfer, { publicShorten } from "./routes/transfer";
import type { Db } from "./db";

const SPA_HEADERS = {
  "content-security-policy":
    "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "cache-control": "no-cache",
};

export function createApp(getPlatform: (c: Ctx) => Platform) {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    const p = getPlatform(c);
    c.set("platform", p);
    await ensureMigrated(p.db);
    await next();
  });

  app.onError((err, c) => {
    const isApi = c.req.path.startsWith("/api/");
    if (err instanceof HttpError) {
      if (isApi) return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
      return c.text(err.message, err.status);
    }
    console.error(err);
    if (isApi) return c.json({ error: { code: "internal", message: "Something went wrong on the server." } }, 500);
    return c.text("Internal error", 500);
  });

  app.get("/api/health", (c) => c.json({ ok: true, service: "waymark" }));

  const api = new Hono<AppEnv>();

  // CORS for API-key clients on other origins. Cookies are never accepted cross-origin.
  api.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    const s = await getSettings(c.get("platform").db);
    const allowed = s.cors_origins
      .split(/[\s,]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    const isPublic = c.req.path.endsWith("/public/shorten") && s.public_shorten;
    const ok = origin && (isPublic || allowed.includes("*") || allowed.includes(origin));
    if (c.req.method === "OPTIONS") {
      if (!ok) return c.body(null, 204);
      return c.body(null, 204, {
        "access-control-allow-origin": origin!,
        "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "access-control-allow-headers": "authorization, x-api-key, content-type",
        "access-control-max-age": "86400",
        vary: "origin",
      });
    }
    await next();
    if (ok) {
      c.res.headers.set("access-control-allow-origin", origin!);
      c.res.headers.append("vary", "origin");
    }
  });

  api.post("/public/shorten", (c) => publicShorten(c));
  api.use("*", loadActor);
  api.route("/", auth);
  api.route("/", links);
  api.route("/", analytics);
  api.route("/", admin);
  api.route("/", transfer);
  api.all("*", () => {
    throw new HttpError(404, "not_found", "No such API endpoint.");
  });
  app.route("/api/v1", api);
  app.all("/api/*", () => {
    throw new HttpError(404, "not_found", "No such API endpoint. The API lives under /api/v1.");
  });

  // Admin single-page app. Files are served by the platform; unknown paths get index.html.
  app.get("/_", (c) => c.redirect("/_/", 301));
  app.get("/_/*", async (c) => {
    const p = c.get("platform");
    const path = c.req.path;
    if (/\.[a-z0-9]+$/i.test(path)) {
      const file = await p.asset(path, c.req.raw);
      if (file && file.status !== 404) return file;
      return c.text("Not found", 404);
    }
    const index = await p.asset("/_/", c.req.raw);
    if (!index || index.status === 404) {
      return c.text("The admin UI is not built. Run `npm run build:web`.", 503);
    }
    const res = new Response(index.body, { status: 200, headers: index.headers });
    for (const [k, v] of Object.entries(SPA_HEADERS)) res.headers.set(k, v);
    res.headers.set("content-type", "text/html; charset=utf-8");
    return res;
  });

  app.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /_/\nDisallow: /api/\n"));
  app.get("/favicon.ico", (c) => c.redirect("/_/favicon.svg", 301));

  app.on(["GET", "HEAD", "POST"], "*", (c) => handleRedirect(c));

  return app;
}

/** Daily housekeeping. Runs from the Workers cron trigger or a Node timer. */
export async function housekeeping(db: Db) {
  await ensureMigrated(db);
  const s = await getSettings(db, true);
  const now = Date.now();
  if (s.click_retention_days > 0) {
    await db.run("DELETE FROM clicks WHERE ts < ?", [now - s.click_retention_days * 864e5]);
  }
  await db.run("DELETE FROM sessions WHERE expires_at < ?", [now]);
  await db.run("DELETE FROM throttle WHERE window_start < ?", [now - 864e5]);
  await db.run("DELETE FROM audit_log WHERE ts < ?", [now - 730 * 864e5]);
}
