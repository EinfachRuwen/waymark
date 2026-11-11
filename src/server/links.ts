import { z } from "zod";
import type { Db } from "./db";
import { type DomainRow, listDomains, slugKey } from "./domains";
import { HttpError } from "./errors";
import { hashPassword, newId, randomString } from "./lib/crypto";

export interface LinkRow {
  id: string;
  domain_id: string;
  slug: string;
  slug_key: string;
  url: string;
  title: string | null;
  notes: string | null;
  tags: string;
  redirect_type: number;
  archived: number;
  starts_at: number | null;
  expires_at: number | null;
  max_clicks: number | null;
  expired_url: string | null;
  password_hash: string | null;
  cloak: number;
  forward_query: number;
  utm: string | null;
  rules: string | null;
  variants: string | null;
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

export interface Rule {
  type: "country" | "device" | "os" | "language";
  values: string[];
  url: string;
}
export interface Variant {
  url: string;
  weight: number;
}
export interface Utm {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
}

/** Path prefixes Waymark itself uses. */
export const RESERVED = ["_", "api", ".well-known", "favicon.ico", "robots.txt", "apple-touch-icon.png"];

const BLOCKED_SCHEMES = ["javascript:", "data:", "vbscript:", "file:", "blob:", "about:"];

export function checkUrl(value: string, field = "url"): string {
  const v = value.trim();
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new HttpError(422, "invalid_url", `${field} is not a valid absolute URL. Include the scheme, e.g. https://`);
  }
  if (BLOCKED_SCHEMES.includes(u.protocol)) throw new HttpError(422, "invalid_url", `${field}: the ${u.protocol} scheme is not allowed.`);
  if (v.length > 4096) throw new HttpError(422, "invalid_url", `${field} is longer than 4096 characters.`);
  return v;
}

const SLUG_RE = /^[\p{L}\p{N}][\p{L}\p{N}_\-.~/+]*$/u;

export function checkSlug(slug: string): string {
  const s = slug.trim().replace(/^\/+|\/+$/g, "");
  if (!s) throw new HttpError(422, "invalid_slug", "The slug is empty.");
  if (s.length > 120) throw new HttpError(422, "invalid_slug", "Slugs can be at most 120 characters.");
  if (!SLUG_RE.test(s) || s.includes("//")) {
    throw new HttpError(422, "invalid_slug", "Slugs may contain letters, digits and - _ . ~ / +, and must start with a letter or digit.");
  }
  const first = s.split("/")[0].toLowerCase();
  if (RESERVED.includes(first)) throw new HttpError(422, "reserved_slug", `"${first}" is reserved by Waymark.`);
  return s;
}

const SLUG_ALPHABET_CI = "abcdefghijkmnpqrstuvwxyz23456789";
const SLUG_ALPHABET_CS = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export async function generateSlug(db: Db, d: DomainRow): Promise<string> {
  const alphabet = d.case_sensitive ? SLUG_ALPHABET_CS : SLUG_ALPHABET_CI;
  for (let attempt = 0; attempt < 8; attempt++) {
    const len = Math.max(3, d.slug_length) + Math.floor(attempt / 3);
    const s = randomString(len, alphabet);
    const taken = await db.first("SELECT 1 FROM links WHERE domain_id = ? AND slug_key = ?", [d.id, slugKey(d, s)]);
    if (!taken) return s;
  }
  throw new HttpError(409, "slug_space_exhausted", "Could not find a free slug. Increase the slug length of this domain.");
}

const ts = z.union([z.number(), z.string(), z.null()]).transform((v, ctx) => {
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : Date.parse(v);
  if (!Number.isFinite(n)) {
    ctx.addIssue({ code: "custom", message: "Expected a timestamp in ms or an ISO date." });
    return z.NEVER;
  }
  return n;
});

const str = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => s.trim() || null);

export const linkInput = z.object({
  url: z.string().min(1).max(4096),
  domain: z.string().optional(),
  slug: z.string().max(200).nullish(),
  title: str(300).nullish(),
  notes: str(4000).nullish(),
  tags: z.array(z.string().trim().min(1).max(48)).max(30).optional(),
  redirect_type: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]).optional(),
  archived: z.boolean().optional(),
  starts_at: ts.optional(),
  expires_at: ts.optional(),
  max_clicks: z.number().int().positive().nullish(),
  expired_url: z.string().max(4096).nullish(),
  password: z.string().max(200).nullish(),
  cloak: z.boolean().optional(),
  forward_query: z.boolean().optional(),
  utm: z
    .object({
      source: z.string().max(200).optional(),
      medium: z.string().max(200).optional(),
      campaign: z.string().max(200).optional(),
      term: z.string().max(200).optional(),
      content: z.string().max(200).optional(),
    })
    .nullish(),
  rules: z
    .array(
      z.object({
        type: z.enum(["country", "device", "os", "language"]),
        values: z.array(z.string().trim().min(1).max(40)).min(1).max(250),
        url: z.string().max(4096),
      }),
    )
    .max(50)
    .nullish(),
  variants: z
    .array(z.object({ url: z.string().max(4096), weight: z.number().int().min(1).max(100) }))
    .max(10)
    .nullish(),
  og_title: str(300).nullish(),
  og_description: str(1000).nullish(),
  og_image: z.string().max(4096).nullish(),
  external_id: z.string().max(200).nullish(),
});
export type LinkInput = z.infer<typeof linkInput>;
export const linkPatch = linkInput.partial();
export type LinkPatch = z.infer<typeof linkPatch>;

function cleanUtm(u: Utm | null | undefined): string | null {
  if (!u) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(u)) if (v && v.trim()) out[k] = v.trim();
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

function normTags(tags: string[] | undefined) {
  if (!tags) return undefined;
  const seen = new Map<string, string>();
  for (const t of tags) {
    const k = t.toLowerCase();
    if (!seen.has(k)) seen.set(k, t);
  }
  return JSON.stringify([...seen.values()]);
}

/** Turns validated input into column values. Only keys present in the input are returned. */
async function toColumns(input: LinkPatch): Promise<Partial<LinkRow>> {
  const c: Partial<LinkRow> = {};
  if (input.url !== undefined) c.url = checkUrl(input.url);
  if (input.title !== undefined) c.title = input.title ?? null;
  if (input.notes !== undefined) c.notes = input.notes ?? null;
  if (input.tags !== undefined) c.tags = normTags(input.tags);
  if (input.redirect_type !== undefined) c.redirect_type = input.redirect_type;
  if (input.archived !== undefined) c.archived = input.archived ? 1 : 0;
  if (input.starts_at !== undefined) c.starts_at = input.starts_at;
  if (input.expires_at !== undefined) c.expires_at = input.expires_at;
  if (input.max_clicks !== undefined) c.max_clicks = input.max_clicks ?? null;
  if (input.expired_url !== undefined) c.expired_url = input.expired_url ? checkUrl(input.expired_url, "expired_url") : null;
  if (input.password !== undefined) c.password_hash = input.password ? await hashPassword(input.password) : null;
  if (input.cloak !== undefined) c.cloak = input.cloak ? 1 : 0;
  if (input.forward_query !== undefined) c.forward_query = input.forward_query ? 1 : 0;
  if (input.utm !== undefined) c.utm = cleanUtm(input.utm);
  if (input.rules !== undefined) {
    const rules = (input.rules || []).map((r) => ({
      type: r.type,
      values: r.values.map((v) => (r.type === "country" ? v.toUpperCase() : v.toLowerCase())),
      url: checkUrl(r.url, "rule url"),
    }));
    c.rules = rules.length ? JSON.stringify(rules) : null;
  }
  if (input.variants !== undefined) {
    const vs = (input.variants || []).map((v) => ({ url: checkUrl(v.url, "variant url"), weight: v.weight }));
    c.variants = vs.length ? JSON.stringify(vs) : null;
  }
  if (input.og_title !== undefined) c.og_title = input.og_title ?? null;
  if (input.og_description !== undefined) c.og_description = input.og_description ?? null;
  if (input.og_image !== undefined) c.og_image = input.og_image ? checkUrl(input.og_image, "og_image") : null;
  if (input.external_id !== undefined) c.external_id = input.external_id ?? null;
  return c;
}

export interface CreateOpts {
  domain: DomainRow;
  userId: string | null;
  via: string;
  /** On slug conflict: fail (default), skip (return null) or overwrite. */
  onConflict?: "fail" | "skip" | "overwrite";
  createdAt?: number;
  clicks?: number;
}

export async function createLink(db: Db, input: LinkInput, opts: CreateOpts): Promise<{ row: LinkRow; status: "created" | "skipped" | "updated" }> {
  const d = opts.domain;
  const cols = await toColumns(input);
  const slug = input.slug ? checkSlug(input.slug) : await generateSlug(db, d);
  const key = slugKey(d, slug);
  const existing = await db.first<LinkRow>("SELECT * FROM links WHERE domain_id = ? AND slug_key = ?", [d.id, key]);
  if (existing) {
    if (opts.onConflict === "skip") return { row: existing, status: "skipped" };
    if (opts.onConflict === "overwrite") {
      const row = await updateLink(db, existing, input, d);
      return { row, status: "updated" };
    }
    throw new HttpError(409, "slug_taken", `${d.hostname}/${slug} already exists.`);
  }
  const now = Date.now();
  const row: LinkRow = {
    id: newId("lnk_"),
    domain_id: d.id,
    slug,
    slug_key: key,
    url: cols.url!,
    title: cols.title ?? null,
    notes: cols.notes ?? null,
    tags: cols.tags ?? "[]",
    redirect_type: cols.redirect_type ?? 0,
    archived: cols.archived ?? 0,
    starts_at: cols.starts_at ?? null,
    expires_at: cols.expires_at ?? null,
    max_clicks: cols.max_clicks ?? null,
    expired_url: cols.expired_url ?? null,
    password_hash: cols.password_hash ?? null,
    cloak: cols.cloak ?? 0,
    forward_query: cols.forward_query ?? 1,
    utm: cols.utm ?? null,
    rules: cols.rules ?? null,
    variants: cols.variants ?? null,
    og_title: cols.og_title ?? null,
    og_description: cols.og_description ?? null,
    og_image: cols.og_image ?? null,
    clicks: opts.clicks ?? 0,
    last_click_at: null,
    created_by: opts.userId,
    created_via: opts.via,
    external_id: cols.external_id ?? null,
    created_at: opts.createdAt ?? now,
    updated_at: now,
  };
  const keys = Object.keys(row) as (keyof LinkRow)[];
  await db.run(
    `INSERT INTO links (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
    keys.map((k) => row[k]),
  );
  await ensureTags(db, JSON.parse(row.tags));
  return { row, status: "created" };
}

export async function updateLink(db: Db, link: LinkRow, input: LinkPatch, targetDomain?: DomainRow): Promise<LinkRow> {
  const cols = await toColumns(input);
  const domains = await listDomains(db);
  const d = targetDomain || domains.find((x) => x.id === link.domain_id)!;
  if (input.slug !== undefined && input.slug !== null) {
    const slug = checkSlug(input.slug);
    const key = slugKey(d, slug);
    if (key !== link.slug_key || d.id !== link.domain_id) {
      const taken = await db.first<{ id: string }>("SELECT id FROM links WHERE domain_id = ? AND slug_key = ?", [d.id, key]);
      if (taken && taken.id !== link.id) throw new HttpError(409, "slug_taken", `${d.hostname}/${slug} already exists.`);
    }
    cols.slug = slug;
    cols.slug_key = key;
  }
  if (d.id !== link.domain_id) {
    cols.domain_id = d.id;
    if (!cols.slug_key) {
      const key = slugKey(d, link.slug);
      const taken = await db.first<{ id: string }>("SELECT id FROM links WHERE domain_id = ? AND slug_key = ?", [d.id, key]);
      if (taken) throw new HttpError(409, "slug_taken", `${d.hostname}/${link.slug} already exists.`);
      cols.slug_key = key;
    }
  }
  cols.updated_at = Date.now();
  const keys = Object.keys(cols) as (keyof LinkRow)[];
  await db.run(`UPDATE links SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, [...keys.map((k) => cols[k] as never), link.id]);
  if (cols.tags) await ensureTags(db, JSON.parse(cols.tags));
  return { ...link, ...cols } as LinkRow;
}

export async function ensureTags(db: Db, tags: string[]) {
  if (!tags.length) return;
  await db.batch(tags.map((t) => ({ sql: "INSERT OR IGNORE INTO tags (name) VALUES (?)", params: [t] })));
}

export function shortUrl(d: Pick<DomainRow, "hostname">, slug: string) {
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(d.hostname);
  return `${local ? "http" : "https"}://${d.hostname}/${slug.split("/").map(encodeURIComponent).join("/")}`;
}

export function linkView(l: LinkRow, domains: DomainRow[]) {
  const d = domains.find((x) => x.id === l.domain_id);
  const now = Date.now();
  const status = l.archived
    ? "archived"
    : l.starts_at && l.starts_at > now
      ? "scheduled"
      : (l.expires_at && l.expires_at <= now) || (l.max_clicks && l.clicks >= l.max_clicks)
        ? "expired"
        : "active";
  return {
    id: l.id,
    domain: d?.hostname ?? null,
    domain_id: l.domain_id,
    slug: l.slug,
    short_url: d ? shortUrl(d, l.slug) : null,
    url: l.url,
    title: l.title,
    notes: l.notes,
    tags: JSON.parse(l.tags || "[]") as string[],
    redirect_type: l.redirect_type || null,
    status,
    archived: !!l.archived,
    starts_at: l.starts_at,
    expires_at: l.expires_at,
    max_clicks: l.max_clicks,
    expired_url: l.expired_url,
    has_password: !!l.password_hash,
    cloak: !!l.cloak,
    forward_query: !!l.forward_query,
    utm: l.utm ? (JSON.parse(l.utm) as Utm) : null,
    rules: l.rules ? (JSON.parse(l.rules) as Rule[]) : [],
    variants: l.variants ? (JSON.parse(l.variants) as Variant[]) : [],
    og_title: l.og_title,
    og_description: l.og_description,
    og_image: l.og_image,
    clicks: l.clicks,
    last_click_at: l.last_click_at,
    created_by: l.created_by,
    created_via: l.created_via,
    external_id: l.external_id,
    created_at: l.created_at,
    updated_at: l.updated_at,
  };
}
export type LinkView = ReturnType<typeof linkView>;
