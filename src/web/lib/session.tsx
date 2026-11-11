import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Scope } from "../../shared/permissions";
import { api, type Domain, type Me } from "./api";

interface AuthState {
  setup_required: boolean;
  setup_token_required: boolean;
  instance_name: string;
  user: unknown;
}

interface Session {
  state: AuthState | null;
  me: Me | null;
  domains: Domain[];
  can: (s: Scope) => boolean;
  isAdmin: boolean;
  refresh: () => Promise<void>;
  reloadDomains: () => Promise<void>;
  /** Bumped whenever links change so lists elsewhere can refetch. */
  linksVersion: number;
  bumpLinks: () => void;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [linksVersion, setLinksVersion] = useState(0);

  const reloadDomains = useCallback(async () => {
    try {
      const d = await api<{ data: Domain[] }>("/domains");
      setDomains(d.data);
    } catch {
      setDomains([]);
    }
  }, []);

  const refresh = useCallback(async () => {
    const s = await api<AuthState>("/auth/state");
    setState(s);
    if (s.user) {
      const m = await api<Me>("/me");
      setMe(m);
      document.title = m.settings.instance_name;
      if (m.scopes.includes("domains:read")) await reloadDomains();
    } else {
      setMe(null);
      document.title = s.instance_name;
    }
  }, [reloadDomains]);

  useEffect(() => {
    refresh().catch(() => setState({ setup_required: false, setup_token_required: false, instance_name: "Waymark", user: null }));
    const out = () => {
      setMe(null);
      setState((s) => (s ? { ...s, user: null } : s));
    };
    addEventListener("waymark:signed-out", out);
    return () => removeEventListener("waymark:signed-out", out);
  }, [refresh]);

  const can = useCallback((s: Scope) => !!me?.scopes.includes(s), [me]);
  const value: Session = {
    state,
    me,
    domains,
    can,
    isAdmin: me?.user.role === "owner" || me?.user.role === "admin",
    refresh,
    reloadDomains,
    linksVersion,
    bumpLinks: () => setLinksVersion((v) => v + 1),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside provider");
  return s;
}
