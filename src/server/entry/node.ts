/**
 * Node runtime: Docker, any VPS, a Raspberry Pi, Render, Railway, Fly …
 * Stores data in a local SQLite file, or in Turso/libSQL when DATABASE_URL is set.
 */
import { serve } from "@hono/node-server";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage } from "node:http";
import { createApp, housekeeping } from "../app";
import { nodeSqliteAdapter } from "../adapters/node-sqlite";
import type { Db } from "../db";
import { geoFromHeaders, ipFromHeaders, type Platform } from "../platform";

const env = process.env;
const PORT = Number(env.PORT || 8787);
const TRUST_PROXY = env.TRUST_PROXY !== "0";
const here = fileURLToPath(new URL(".", import.meta.url));
const STATIC_DIR = resolve(env.STATIC_DIR || join(here, "../client"));
const altStatic = resolve("dist/client");

async function openDb(): Promise<Db> {
  if (env.DATABASE_URL && /^(libsql|https?|wss?):/.test(env.DATABASE_URL)) {
    const { createClient } = await import("@libsql/client");
    const { libsqlAdapter } = await import("../adapters/libsql");
    console.log("Waymark: using libSQL at", new URL(env.DATABASE_URL).host);
    return libsqlAdapter(createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN }));
  }
  const file = env.DATABASE_PATH || "./data/waymark.db";
  console.log("Waymark: using SQLite file", resolve(file));
  return nodeSqliteAdapter(file);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

async function serveFile(path: string): Promise<Response | null> {
  let rel = decodeURIComponent(path);
  if (rel.endsWith("/")) rel += "index.html";
  for (const root of [STATIC_DIR, altStatic]) {
    const full = normalize(join(root, rel));
    if (!full.startsWith(root)) return null;
    try {
      const st = await stat(full);
      if (!st.isFile()) continue;
      const body = await readFile(full);
      const immutable = rel.startsWith("/_/assets/");
      return new Response(body, {
        headers: {
          "content-type": MIME[extname(full)] || "application/octet-stream",
          "cache-control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=300",
        },
      });
    } catch {
      /* try next root */
    }
  }
  return null;
}

const db = await openDb();

const app = createApp((c) => {
  const incoming = (c.env as { incoming?: IncomingMessage } | undefined)?.incoming;
  const platform: Platform = {
    db,
    waitUntil: (p) => void p.catch((e) => console.error("background task failed", e)),
    asset: (path) => serveFile(path),
    clientIp: (req) => (TRUST_PROXY ? ipFromHeaders(req.headers) : null) || incoming?.socket.remoteAddress || null,
    geo: (req) => geoFromHeaders(req.headers),
    env: { SETUP_TOKEN: env.SETUP_TOKEN, DEV: env.WAYMARK_DEV },
  };
  return platform;
});

const run = () => housekeeping(db).catch((e) => console.error("housekeeping failed", e));
setTimeout(run, 10_000);
setInterval(run, 6 * 3600_000);

serve({ fetch: app.fetch, port: PORT, hostname: env.HOST || "0.0.0.0" }, (info) => {
  console.log(`Waymark is listening on http://localhost:${info.port} (admin at /_/)`);
});
