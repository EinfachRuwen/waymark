import { lang, t } from "./i18n";
const nf = new Intl.NumberFormat(lang());
const compact = new Intl.NumberFormat(lang(), { notation: "compact", maximumFractionDigits: 1 });

export const num = (n: number | null | undefined) => nf.format(n ?? 0);
export const short = (n: number) => (Math.abs(n) >= 10_000 ? compact.format(n) : nf.format(n));

export function date(ts: number | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(lang(), opts);
}

export function dateTime(ts: number | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(lang(), { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const rtf = new Intl.RelativeTimeFormat(lang(), { numeric: "auto" });
export function ago(ts: number | null | undefined) {
  if (!ts) return t("never");
  const s = (ts - Date.now()) / 1000;
  const abs = Math.abs(s);
  if (abs < 45) return t("just now");
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.round(s / (86400 * 30)), "month");
  return rtf.format(Math.round(s / (86400 * 365)), "year");
}

let regionNames: Intl.DisplayNames | null = null;
export function country(code: string | null | undefined) {
  if (!code) return t("Unknown");
  try {
    regionNames ??= new Intl.DisplayNames(lang(), { type: "region" });
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

let langNames: Intl.DisplayNames | null = null;
export function language(code: string | null | undefined) {
  if (!code) return t("Unknown");
  try {
    langNames ??= new Intl.DisplayNames(lang(), { type: "language" });
    return langNames.of(code) ?? code;
  } catch {
    return code;
  }
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** "https://www.example.com/a/b?c" → { host: "example.com", rest: "/a/b?c" } */
export function splitUrl(url: string) {
  try {
    const u = new URL(url);
    const rest = (u.pathname === "/" ? "" : u.pathname) + u.search + u.hash;
    return { host: u.host.replace(/^www\./, ""), rest };
  } catch {
    return { host: url, rest: "" };
  }
}

export function toLocalInput(ts: number | null | undefined) {
  if (!ts) return "";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string) {
  return v ? new Date(v).getTime() : null;
}

export function initials(name: string, email: string) {
  const src = name.trim() || email;
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function download(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const TAG_COLORS: Record<string, string> = {
  moss: "var(--moss)",
  blaze: "var(--blaze)",
  sky: "var(--sky)",
  ember: "var(--ember)",
  slate: "var(--slate)",
  heather: "var(--heather)",
};
