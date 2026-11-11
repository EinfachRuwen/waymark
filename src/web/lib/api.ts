import type { Role, Scope } from "../../shared/permissions";
import { tError } from "./i18n";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; raw?: boolean } = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers: { "x-waymark": "1", ...(opts.body !== undefined ? { "content-type": "application/json" } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  });
  if (!res.ok) {
    let code = "http_" + res.status;
    let message = `Request failed (${res.status}).`;
    try {
      const j = await res.json();
      code = j.error?.code ?? code;
      message = j.error?.message ?? message;
    } catch {
      /* not json */
    }
    if (res.status === 401 && code === "unauthorized") window.dispatchEvent(new Event("waymark:signed-out"));
    throw new ApiError(res.status, code, tError(message));
  }
  if (opts.raw) return res as unknown as T;
  const ct = res.headers.get("content-type") || "";
  return (ct.includes("json") ? res.json() : res.text()) as Promise<T>;
}

export const get = <T>(p: string) => api<T>(p);
export const post = <T>(p: string, body: unknown = {}) => api<T>(p, { method: "POST", body });
export const patch = <T>(p: string, body: unknown) => api<T>(p, { method: "PATCH", body });
export const del = <T>(p: string) => api<T>(p, { method: "DELETE" });

/* ───────── Types mirrored from the server ───────── */

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled: boolean;
  created_at: number;
  last_login_at: number | null;
  pending_invite: boolean;
}

export interface Settings {
  instance_name: string;
  click_retention_days: number;
  track_clicks: boolean;
  count_bots: boolean;
  default_redirect: 301 | 302 | 307 | 308;
  public_shorten: boolean;
  public_shorten_domain: string | null;
  public_rate_limit: number;
  cors_origins: string;
}

export interface Me {
  user: User;
  via: "user" | "key";
  scopes: Scope[];
  settings: Settings;
}

export interface Domain {
  id: string;
  hostname: string;
  is_default: boolean;
  root_redirect: string | null;
  not_found_redirect: string | null;
  slug_length: number;
  case_sensitive: boolean;
  created_at: number;
  links?: number;
}

export interface Rule {
  type: "country" | "device" | "os" | "language";
  values: string[];
  url: string;
}

export interface Link {
  id: string;
  domain: string | null;
  domain_id: string;
  slug: string;
  short_url: string | null;
  url: string;
  title: string | null;
  notes: string | null;
  tags: string[];
  redirect_type: 301 | 302 | 307 | 308 | null;
  status: "active" | "archived" | "expired" | "scheduled";
  archived: boolean;
  starts_at: number | null;
  expires_at: number | null;
  max_clicks: number | null;
  expired_url: string | null;
  has_password: boolean;
  cloak: boolean;
  forward_query: boolean;
  utm: Partial<Record<"source" | "medium" | "campaign" | "term" | "content", string>> | null;
  rules: Rule[];
  variants: { url: string; weight: number }[];
  og_title: string | null;
  og_description: string | null;
  og_image: string | null;
  clicks: number;
  last_click_at: number | null;
  created_by: string | null;
  created_via: string | null;
  external_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface Tag {
  name: string;
  color: string;
  links: number;
}

export interface Stat {
  key: string | null;
  clicks: number;
}

export interface Analytics {
  from: number;
  to: number;
  bucket: "day" | "hour";
  totals: { clicks: number; visitors: number; qr: number };
  series: { t: number; clicks: number; visitors: number }[];
  hourly: number[];
  countries: Stat[];
  cities: (Stat & { country: string | null })[];
  referrers: Stat[];
  browsers: Stat[];
  os: Stat[];
  devices: Stat[];
  languages: Stat[];
  targets: Stat[];
  top_links: { id: string; clicks: number; slug: string | null; title: string | null; url: string | null; short_url: string | null }[];
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  domain_ids: string[] | null;
  expires_at: number | null;
  last_used_at: number | null;
  created_at: number;
  revoked_at: number | null;
  user_id: string;
  user_email: string;
}

export interface Webhook {
  id: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  created_at: number;
  last_status: number | null;
  last_delivery_at: number | null;
  failures: number;
}

export interface AuditEntry {
  id: number;
  ts: number;
  actor_type: string;
  actor_label: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: unknown;
  ip: string | null;
}
