import type { Db } from "./db";

export interface DomainRow {
  id: string;
  hostname: string;
  is_default: number;
  root_redirect: string | null;
  not_found_redirect: string | null;
  slug_length: number;
  case_sensitive: number;
  created_at: number;
}

let cache: { at: number; rows: DomainRow[] } | null = null;

export async function listDomains(db: Db, fresh = false): Promise<DomainRow[]> {
  if (!fresh && cache && Date.now() - cache.at < 20_000) return cache.rows;
  const rows = await db.all<DomainRow>("SELECT * FROM domains ORDER BY is_default DESC, hostname");
  cache = { at: Date.now(), rows };
  return rows;
}

export function invalidateDomains() {
  cache = null;
}

export function normalizeHost(h: string) {
  const host = h.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  // Keep the port for local development so generated short URLs work.
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return host;
  return host.replace(/:\d+$/, "");
}

/** The domain a request arrived on, falling back to the default domain (e.g. on *.workers.dev). */
export async function domainForHost(db: Db, host: string | undefined): Promise<DomainRow | null> {
  const rows = await listDomains(db);
  const h = normalizeHost(host || "");
  return rows.find((d) => d.hostname === h) || rows.find((d) => d.is_default) || rows[0] || null;
}

export async function resolveDomain(db: Db, ref: string | undefined | null): Promise<DomainRow | null> {
  const rows = await listDomains(db);
  if (!ref) return rows.find((d) => d.is_default) || rows[0] || null;
  const h = normalizeHost(ref);
  return rows.find((d) => d.id === ref || d.hostname === h) || null;
}

export function slugKey(d: Pick<DomainRow, "case_sensitive">, slug: string) {
  return d.case_sensitive ? slug : slug.toLowerCase();
}

export function domainView(d: DomainRow, linkCount?: number) {
  return {
    id: d.id,
    hostname: d.hostname,
    is_default: !!d.is_default,
    root_redirect: d.root_redirect,
    not_found_redirect: d.not_found_redirect,
    slug_length: d.slug_length,
    case_sensitive: !!d.case_sensitive,
    created_at: d.created_at,
    ...(linkCount !== undefined ? { links: linkCount } : {}),
  };
}
