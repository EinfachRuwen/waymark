import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type ReactNode } from "react";

const BASE = "/_";

interface RouterState {
  path: string;
  query: URLSearchParams;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
}

const Ctx = createContext<RouterState | null>(null);

function current() {
  const p = location.pathname.startsWith(BASE) ? location.pathname.slice(BASE.length) : location.pathname;
  return { path: p.replace(/\/+$/, "") || "/", search: location.search };
}

export function Router({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState(current);
  useEffect(() => {
    const on = () => setLoc(current());
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    const url = to.startsWith("/") ? BASE + to : to;
    if (opts?.replace) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
    setLoc(current());
    if (!opts?.replace) window.scrollTo({ top: 0 });
  }, []);
  const value = useMemo(() => ({ path: loc.path, query: new URLSearchParams(loc.search), navigate }), [loc, navigate]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRouter() {
  const r = useContext(Ctx);
  if (!r) throw new Error("useRouter outside Router");
  return r;
}

/** Matches "/links/:id" style patterns. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split("/").filter(Boolean);
  const b = path.split("/").filter(Boolean);
  if (a.length !== b.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) out[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return out;
}

export function Link({ to, children, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { navigate } = useRouter();
  return (
    <a
      href={BASE + to}
      {...rest}
      onClick={(e) => {
        rest.onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

/** Keeps a piece of UI state in the query string so views are linkable. */
export function useQueryState(key: string, def = ""): [string, (v: string) => void] {
  const { query, path, navigate } = useRouter();
  const value = query.get(key) ?? def;
  const set = useCallback(
    (v: string) => {
      const q = new URLSearchParams(location.search);
      if (!v || v === def) q.delete(key);
      else q.set(key, v);
      const s = q.toString();
      navigate(path + (s ? `?${s}` : ""), { replace: true });
    },
    [key, def, path, navigate],
  );
  return [value, set];
}
