import type { Db } from "./db";

/**
 * Schema migrations, applied automatically on the first request (Workers) or on
 * startup (Node). Append new entries; never edit a shipped one.
 */
export const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: "initial",
    sql: `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','editor','viewer')),
  disabled INTEGER NOT NULL DEFAULT 0,
  invite_hash TEXT,
  invite_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scopes TEXT NOT NULL,
  domain_ids TEXT,
  expires_at INTEGER,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS domains (
  id TEXT PRIMARY KEY,
  hostname TEXT NOT NULL UNIQUE COLLATE NOCASE,
  is_default INTEGER NOT NULL DEFAULT 0,
  root_redirect TEXT,
  not_found_redirect TEXT,
  slug_length INTEGER NOT NULL DEFAULT 6,
  case_sensitive INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  slug_key TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  notes TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  redirect_type INTEGER NOT NULL DEFAULT 302,
  archived INTEGER NOT NULL DEFAULT 0,
  starts_at INTEGER,
  expires_at INTEGER,
  max_clicks INTEGER,
  expired_url TEXT,
  password_hash TEXT,
  cloak INTEGER NOT NULL DEFAULT 0,
  forward_query INTEGER NOT NULL DEFAULT 1,
  utm TEXT,
  rules TEXT,
  variants TEXT,
  og_title TEXT,
  og_description TEXT,
  og_image TEXT,
  clicks INTEGER NOT NULL DEFAULT 0,
  last_click_at INTEGER,
  created_by TEXT,
  created_via TEXT,
  external_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (domain_id, slug_key)
);
CREATE INDEX IF NOT EXISTS links_created ON links(created_at DESC);
CREATE INDEX IF NOT EXISTS links_url ON links(url);

CREATE TABLE IF NOT EXISTS tags (
  name TEXT PRIMARY KEY COLLATE NOCASE,
  color TEXT NOT NULL DEFAULT 'moss'
);

CREATE TABLE IF NOT EXISTS clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  visitor TEXT,
  country TEXT,
  region TEXT,
  city TEXT,
  referrer TEXT,
  browser TEXT,
  os TEXT,
  device TEXT,
  language TEXT,
  is_bot INTEGER NOT NULL DEFAULT 0,
  is_qr INTEGER NOT NULL DEFAULT 0,
  target TEXT
);
CREATE INDEX IF NOT EXISTS clicks_link_ts ON clicks(link_id, ts);
CREATE INDEX IF NOT EXISTS clicks_ts ON clicks(ts);

CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_status INTEGER,
  last_delivery_at INTEGER,
  failures INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  actor_label TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS audit_ts ON audit_log(ts DESC);

CREATE TABLE IF NOT EXISTS throttle (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
`,
  },
];

let applied: Promise<void> | null = null;

/** Idempotent; memoised per process / isolate so the hot path pays one read at most. */
export function ensureMigrated(db: Db): Promise<void> {
  if (!applied) {
    applied = migrate(db).catch((e) => {
      applied = null;
      throw e;
    });
  }
  return applied;
}

async function migrate(db: Db) {
  await db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
  const done = new Set((await db.all<{ id: number }>("SELECT id FROM schema_migrations")).map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await db.exec(m.sql);
    await db.run("INSERT OR IGNORE INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)", [m.id, m.name, Date.now()]);
  }
}
