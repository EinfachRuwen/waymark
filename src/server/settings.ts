import type { Db } from "./db";

export interface Settings {
  instance_name: string;
  /** Server secret for signing cookies and hashing visitors. Never leaves the server. */
  secret: string;
  click_retention_days: number;
  track_clicks: boolean;
  count_bots: boolean;
  default_redirect: 301 | 302 | 307 | 308;
  public_shorten: boolean;
  public_shorten_domain: string | null;
  public_rate_limit: number;
  /** Allowed origins for browser calls to the API with a key (CORS). "*" allows all. */
  cors_origins: string;
}

export const DEFAULT_SETTINGS: Settings = {
  instance_name: "Waymark",
  secret: "",
  click_retention_days: 365,
  track_clicks: true,
  count_bots: false,
  default_redirect: 302,
  public_shorten: false,
  public_shorten_domain: null,
  public_rate_limit: 20,
  cors_origins: "",
};

let cache: { at: number; value: Settings } | null = null;
const TTL = 20_000;

export async function getSettings(db: Db, fresh = false): Promise<Settings> {
  if (!fresh && cache && Date.now() - cache.at < TTL) return cache.value;
  const rows = await db.all<{ key: string; value: string }>("SELECT key, value FROM settings");
  const value = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const r of rows) {
    try {
      value[r.key] = JSON.parse(r.value);
    } catch {
      /* ignore malformed */
    }
  }
  cache = { at: Date.now(), value: value as unknown as Settings };
  return cache.value;
}

export async function saveSettings(db: Db, patch: Partial<Settings>) {
  const entries = Object.entries(patch).filter(([k]) => k in DEFAULT_SETTINGS);
  await db.batch(
    entries.map(([k, v]) => ({
      sql: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      params: [k, JSON.stringify(v)],
    })),
  );
  cache = null;
}

export function publicSettings(s: Settings) {
  const { secret: _secret, ...rest } = s;
  return rest;
}

export function invalidateSettings() {
  cache = null;
}
