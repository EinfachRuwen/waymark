import { createContext, useContext, useState, type ReactNode } from "react";
import { DE, DE_PATTERNS } from "./i18n-de";

/**
 * English text is the key; other languages map it. Missing entries fall back
 * to English, so a new string never breaks the UI.
 */
export type Lang = "en" | "de";

function detect(): Lang {
  try {
    const saved = localStorage.getItem("waymark-lang");
    if (saved === "de" || saved === "en") return saved;
  } catch {
    /* storage unavailable */
  }
  return navigator.language?.toLowerCase().startsWith("de") ? "de" : "en";
}

let current: Lang = detect();
document.documentElement.lang = current;

export function t(key: string, vars?: Record<string, string | number>): string {
  let s = current === "de" ? (DE[key] ?? key) : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Picks singular or plural, e.g. tn(n, "{n} link", "{n} links"). */
export function tn(n: number, one: string, many: string, vars: Record<string, string | number> = {}) {
  return t(n === 1 ? one : many, { n: new Intl.NumberFormat().format(n), ...vars });
}

export const lang = () => current;

/** Translates a message that came from the server, including ones with values. */
export function tError(msg: string): string {
  if (current !== "de") return msg;
  if (DE[msg]) return DE[msg];
  for (const [re, rep] of DE_PATTERNS) if (re.test(msg)) return msg.replace(re, rep);
  return msg;
}

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: current, setLang: () => {} });

export function LangProvider({ children }: { children: ReactNode }) {
  const [l, setL] = useState<Lang>(current);
  const setLang = (next: Lang) => {
    current = next;
    document.documentElement.lang = next;
    try {
      localStorage.setItem("waymark-lang", next);
    } catch {
      /* ignore */
    }
    setL(next);
    // Module-level labels are translated at load time, so a reload is the honest switch.
    location.reload();
  };
  // Re-keying remounts the tree so every t() call re-runs in the new language.
  return (
    <Ctx.Provider value={{ lang: l, setLang }}>
      <div key={l} style={{ display: "contents" }}>
        {children}
      </div>
    </Ctx.Provider>
  );
}

export const useLang = () => useContext(Ctx);
