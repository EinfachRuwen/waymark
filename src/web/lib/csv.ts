/** RFC 4180 CSV parser with delimiter sniffing (comma, semicolon, tab). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.indexOf("\n") === -1 ? undefined : src.indexOf("\n"));
  const delim = [",", ";", "\t"].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const ALIASES: Record<string, string[]> = {
  url: ["url", "original url", "originalurl", "long url", "long_url", "longurl", "destination", "destination url", "target", "target url", "long link", "redirect url"],
  slug: ["slug", "path", "keyword", "short code", "shortcode", "back-half", "back half", "custom back-half", "alias", "key"],
  short_url: ["short url", "short_url", "shorturl", "short link", "shortlink", "bitlink", "link", "secureshorturl"],
  title: ["title", "name", "link title"],
  tags: ["tags", "tag", "labels", "label"],
  created_at: ["created", "created at", "created_at", "createdat", "date", "date created", "creation date", "timestamp"],
  clicks: ["clicks", "total clicks", "total_clicks", "visits", "hits", "engagements"],
  expires_at: ["expires", "expires at", "expires_at", "expiresat", "expiration", "expiration date"],
  notes: ["notes", "note", "description", "comment"],
  domain: ["domain", "hostname", "host"],
};

export type Field = keyof typeof ALIASES;
export const FIELDS = Object.keys(ALIASES) as Field[];

export function detectMapping(headers: string[]): Partial<Record<Field, number>> {
  const norm = headers.map((h) => h.trim().toLowerCase().replace(/[_\s]+/g, " "));
  const out: Partial<Record<Field, number>> = {};
  for (const f of FIELDS) {
    const idx = norm.findIndex((h) => ALIASES[f].map((a) => a.replace(/[_\s]+/g, " ")).includes(h));
    if (idx >= 0) out[f] = idx;
  }
  return out;
}

export function detectSource(headers: string[]): string {
  const h = headers.map((x) => x.toLowerCase());
  if (h.some((x) => x.includes("originalurl") || x === "original url") && h.some((x) => x === "path" || x.includes("short"))) return "shortio";
  if (h.some((x) => x.includes("bitlink") || x === "long_url")) return "bitly";
  if (h.includes("keyword")) return "yourls";
  return "csv";
}

export interface MappedRow {
  url: string;
  slug?: string;
  title?: string | null;
  tags?: string[];
  notes?: string | null;
  created_at?: number;
  clicks?: number;
  expires_at?: number | null;
  domain?: string;
}

export function mapRows(rows: string[][], mapping: Partial<Record<Field, number>>, opts: { keepClicks: boolean; useDomainColumn: boolean }): MappedRow[] {
  const get = (r: string[], f: Field) => (mapping[f] !== undefined ? (r[mapping[f]!] ?? "").trim() : "");
  return rows
    .map((r) => {
      const url = get(r, "url");
      let slug = get(r, "slug");
      let domain = opts.useDomainColumn ? get(r, "domain") : "";
      const short = get(r, "short_url");
      if (!slug && short) {
        try {
          const u = new URL(short.includes("://") ? short : `https://${short}`);
          slug = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
          if (opts.useDomainColumn && !domain) domain = u.hostname;
        } catch {
          /* ignore */
        }
      }
      const created = get(r, "created_at");
      const createdTs = created ? (/^\d{10}$/.test(created) ? Number(created) * 1000 : /^\d{13}$/.test(created) ? Number(created) : Date.parse(created)) : NaN;
      const exp = get(r, "expires_at");
      const expTs = exp ? Date.parse(exp) : NaN;
      const clicks = Number(get(r, "clicks").replace(/[^\d]/g, ""));
      const tags = get(r, "tags")
        .split(/[|,;]/)
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 30);
      const row: MappedRow = { url };
      if (slug) row.slug = slug.replace(/^\/+/, "");
      if (get(r, "title")) row.title = get(r, "title").slice(0, 300);
      if (tags.length) row.tags = tags;
      if (get(r, "notes")) row.notes = get(r, "notes").slice(0, 4000);
      if (Number.isFinite(createdTs)) row.created_at = createdTs;
      if (Number.isFinite(expTs)) row.expires_at = expTs;
      if (opts.keepClicks && Number.isFinite(clicks) && clicks > 0) row.clicks = clicks;
      if (domain) row.domain = domain;
      return row;
    })
    .filter((r) => r.url);
}
