import {
  BarChart3,
  Code2,
  Globe,
  History,
  KeyRound,
  Link2,
  LogOut,
  Menu as MenuIcon,
  Moon,
  Plus,
  Settings as SettingsIcon,
  Sun,
  Tags,
  Upload,
  Users,
  Webhook,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button, useToast } from "./components/ui";
import { LinkEditor } from "./pages/LinkEditor";
import { api } from "./lib/api";
import { initials } from "./lib/format";
import { useKey } from "./lib/hooks";
import { Link, match, useRouter } from "./lib/router";
import { useSession } from "./lib/session";
import { Login, Setup, Invite } from "./pages/Auth";
import { Overview } from "./pages/Overview";
import { Links } from "./pages/Links";
import { LinkDetail } from "./pages/LinkDetail";
import { Domains } from "./pages/Domains";
import { TagsPage } from "./pages/Tags";
import { Team } from "./pages/Team";
import { ApiKeys } from "./pages/ApiKeys";
import { Webhooks } from "./pages/Webhooks";
import { ImportExport } from "./pages/ImportExport";
import { SettingsPage } from "./pages/Settings";
import { Audit } from "./pages/Audit";
import { Account } from "./pages/Account";
import { ApiDocs } from "./pages/ApiDocs";
import { ROLE_INFO, type Scope } from "../shared/permissions";
import { useLang } from "./lib/i18n";
import { t } from "./lib/i18n";

export function App() {
  const { state, me } = useSession();
  const { path } = useRouter();

  const invite = match("/invite/:token", path);
  if (invite) return <Invite token={invite.token} />;
  if (!state) return <div style={{ minHeight: "100vh" }} />;
  if (state.setup_required) return <Setup tokenRequired={state.setup_token_required} />;
  if (!me) return <Login instanceName={state.instance_name} />;
  return <Shell />;
}

const NAV: { to: string; label: string; icon: typeof Link2; scope?: Scope; admin?: boolean; group?: string }[] = [
  { to: "/", label: t("Overview"), icon: BarChart3, scope: "analytics:read" },
  { to: "/links", label: t("Links"), icon: Link2, scope: "links:read" },
  { to: "/tags", label: t("Tags"), icon: Tags, scope: "links:read" },
  { to: "/domains", label: t("Domains"), icon: Globe, scope: "domains:read" },
  { to: "/import", label: t("Import & export"), icon: Upload, scope: "links:write" },
  { to: "/team", label: t("Team"), icon: Users, scope: "users:read", group: t("Workspace") },
  { to: "/keys", label: t("API keys"), icon: KeyRound, group: t("Workspace") },
  { to: "/webhooks", label: t("Webhooks"), icon: Webhook, scope: "webhooks:write", group: t("Workspace") },
  { to: "/audit", label: t("Audit log"), icon: History, scope: "audit:read", group: t("Workspace") },
  { to: "/settings", label: t("Settings"), icon: SettingsIcon, admin: true, group: t("Workspace") },
  { to: "/api", label: t("API reference"), icon: Code2, group: t("Workspace") },
];

function Shell() {
  const { me, can, isAdmin, refresh, bumpLinks } = useSession();
  const { path, navigate } = useRouter();
  const [railOpen, setRailOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const toast = useToast();
  const { lang, setLang } = useLang();
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || "");

  useEffect(() => setRailOpen(false), [path]);
  useKey("n", (e) => {
    if (can("links:write")) {
      e.preventDefault();
      setCreating(true);
    }
  });
  useKey("/", (e) => {
    if (path !== "/links") return;
    e.preventDefault();
    document.querySelector<HTMLInputElement>("#link-search")?.focus();
  });

  const toggleTheme = () => {
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    const cur = theme || (dark ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem("waymark-theme", next);
    } catch {
      /* ignore */
    }
  };

  const items = NAV.filter((n) => (!n.scope || can(n.scope)) && (!n.admin || isAdmin));
  const active = (to: string) => (to === "/" ? path === "/" : path === to || path.startsWith(to + "/"));
  let lastGroup: string | undefined;
  const isDark = theme ? theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;

  return (
    <div className="shell">
      <nav className={`rail ${railOpen ? "open" : ""}`} aria-label={t("Main")}>
        <Link to="/" className="brand" style={{ color: "inherit" }}>
          <span className="brand-mark" aria-hidden>
            <svg viewBox="0 0 16 16">
              <path d="M3 2v12M3 3h8l-2 3 2 3H3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          </span>
          <span>
            <span className="brand-name">{t("Waymark")}</span>
            {me!.settings.instance_name !== "Waymark" && <span className="brand-sub">{me!.settings.instance_name}</span>}
          </span>
        </Link>
        {can("links:write") && (
          <Button variant="primary" icon={<Plus className="icon" />} onClick={() => setCreating(true)} style={{ margin: "0 4px 10px" }}>
            {t("New link")} <kbd style={{ marginLeft: "auto", background: "transparent", borderColor: "rgb(27 26 16 / .3)", color: "inherit" }}>N</kbd>
          </Button>
        )}
        {items.map((n) => {
          const head = n.group && n.group !== lastGroup ? <div className="rail-group">{n.group}</div> : null;
          lastGroup = n.group ?? lastGroup;
          const I = n.icon;
          return (
            <div key={n.to}>
              {head}
              <Link to={n.to} className="nav" aria-current={active(n.to) ? "page" : undefined}>
                <I className="icon" />
                {t(n.label)}
              </Link>
            </div>
          );
        })}
        <div className="rail-foot">
          <Link to="/account" className="avatar" aria-label={t("Your account")} style={{ textDecoration: "none" }}>
            {initials(me!.user.name, me!.user.email)}
          </Link>
          <div className="who">
            <b>{me!.user.name || me!.user.email}</b>
            <span>{t(ROLE_INFO[me!.user.role].label)}</span>
          </div>
          <button
            className="icon-btn"
            onClick={() => setLang(lang === "de" ? "en" : "de")}
            aria-label={lang === "de" ? "Switch to English" : "Auf Deutsch umstellen"}
            title={lang === "de" ? "English" : "Deutsch"}
            style={{ font: "600 11px/1 var(--font)", letterSpacing: ".04em" }}
          >
            {lang === "de" ? "EN" : "DE"}
          </button>
          <button
            className="icon-btn"
            onClick={toggleTheme}
            aria-label={isDark ? t("Use light theme") : t("Use dark theme")}
            title={isDark ? t("Light theme") : t("Dark theme")}
          >
            {isDark ? <Sun className="icon" /> : <Moon className="icon" />}
          </button>
          <button
            className="icon-btn"
            aria-label={t("Sign out")}
            title={t("Sign out")}
            onClick={async () => {
              await api("/auth/logout", { method: "POST", body: {} });
              await refresh();
              navigate("/", { replace: true });
              toast(t("Signed out"));
            }}
          >
            <LogOut className="icon" />
          </button>
        </div>
      </nav>
      {railOpen && <div className="scrim" style={{ zIndex: 44 }} onClick={() => setRailOpen(false)} />}
      <div style={{ minWidth: 0 }}>
        <div className="mobile-bar">
          <button className="icon-btn" aria-label={t("Open menu")} onClick={() => setRailOpen(true)}>
            <MenuIcon className="icon" />
          </button>
          <span className="brand-name" style={{ flex: 1 }}>
            {t("Waymark")}
          </span>
          {can("links:write") && (
            <Button variant="primary" size="sm" icon={<Plus className="icon" />} onClick={() => setCreating(true)}>
              {t("New")}
            </Button>
          )}
        </div>
        <main className="main">
          <Routes />
        </main>
      </div>
      {creating && (
        <LinkEditor
          onClose={() => setCreating(false)}
          onSaved={(l) => {
            setCreating(false);
            bumpLinks();
            navigate(`/links/${l.id}`);
          }}
        />
      )}
    </div>
  );
}

function Routes() {
  const { path } = useRouter();
  const { can, isAdmin } = useSession();
  const guard = (ok: boolean, el: ReactNode) => (ok ? el : <NoAccess />);

  const detail = match("/links/:id", path);
  if (detail) return guard(can("links:read"), <LinkDetail id={detail.id} />);
  switch (path) {
    case "/":
      return can("analytics:read") ? <Overview /> : <Links />;
    case "/links":
      return guard(can("links:read"), <Links />);
    case "/tags":
      return guard(can("links:read"), <TagsPage />);
    case "/domains":
      return guard(can("domains:read"), <Domains />);
    case "/import":
      return guard(can("links:write"), <ImportExport />);
    case "/team":
      return guard(can("users:read"), <Team />);
    case "/keys":
      return <ApiKeys />;
    case "/webhooks":
      return guard(can("webhooks:write"), <Webhooks />);
    case "/audit":
      return guard(can("audit:read"), <Audit />);
    case "/settings":
      return guard(isAdmin, <SettingsPage />);
    case "/account":
      return <Account />;
    case "/api":
      return <ApiDocs />;
    default:
      return (
        <div className="page">
          <div className="empty">
            <span className="sign muted-sign">{path}</span>
            <h3>{t("This page does not exist.")}</h3>
            <Link to="/">{t("Back to the overview")}</Link>
          </div>
        </div>
      );
  }
}

function NoAccess() {
  return (
    <div className="page">
      <div className="empty">
        <h3>{t("Your role does not include this area.")}</h3>
        <p>{t("Ask an owner or admin of this Waymark if you need access.")}</p>
      </div>
    </div>
  );
}

export function PageHead({ title, desc, actions }: { title: ReactNode; desc?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {desc && <p>{desc}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}
