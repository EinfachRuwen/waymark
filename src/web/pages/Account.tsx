import { Monitor } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ROLE_INFO } from "../../shared/permissions";
import { PageHead } from "../App";
import { Button, Input, useToast } from "../components/ui";
import { api } from "../lib/api";
import { ago } from "../lib/format";
import { useApi } from "../lib/hooks";
import { useSession } from "../lib/session";
import { t } from "../lib/i18n";

interface SessionRow {
  id: string;
  created_at: number;
  last_seen_at: number;
  ip: string | null;
  user_agent: string | null;
  current: boolean;
}

function device(ua: string | null) {
  if (!ua) return t("Unknown device");
  const os = /iphone/i.test(ua)
    ? "iPhone"
    : /ipad/i.test(ua)
      ? "iPad"
      : /android/i.test(ua)
        ? t("Android")
        : /mac os/i.test(ua)
          ? t("Mac")
          : /windows/i.test(ua)
            ? t("Windows")
            : /linux/i.test(ua)
              ? t("Linux")
              : t("Device");
  const br = /edg\//i.test(ua)
    ? t("Edge")
    : /firefox/i.test(ua)
      ? t("Firefox")
      : /chrome/i.test(ua)
        ? t("Chrome")
        : /safari/i.test(ua)
          ? t("Safari")
          : t("Browser");
  return t("{b} on {o}", { b: br, o: os });
}

export function Account() {
  const { me, refresh } = useSession();
  const toast = useToast();
  const [name, setName] = useState(me!.user.name);
  const [email, setEmail] = useState(me!.user.email);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [pwError, setPwError] = useState<string | null>(null);
  const sessions = useApi<{ data: SessionRow[] }>("/me/sessions");

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/me", { method: "PATCH", body: { name, email } });
      await refresh();
      toast(t("Profile saved"));
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    setPwError(null);
    try {
      await api("/me/password", { body: pw });
      setPw({ current: "", next: "" });
      toast(t("Password changed. Other sessions were signed out."));
      void sessions.reload();
    } catch (err) {
      setPwError((err as Error).message);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <PageHead title={t("Your account")} desc={`${t(ROLE_INFO[me!.user.role].label)}: ${t(ROLE_INFO[me!.user.role].summary)}`} />
      <div className="stack" style={{ gap: 18 }}>
        <section className="panel">
          <form className="panel-body stack" onSubmit={saveProfile}>
            <div className="section-title">{t("Profile")}</div>
            <div className="grid-2">
              <Input label={t("Name")} value={name} onChange={(e) => setName(e.target.value)} />
              <Input label={t("Email")} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Button type="submit" variant="dark">
                {t("Save profile")}
              </Button>
            </div>
          </form>
        </section>
        <section className="panel">
          <form className="panel-body stack" onSubmit={savePassword}>
            <div className="section-title">{t("Password")}</div>
            <div className="grid-2">
              <Input
                label={t("Current password")}
                type="password"
                autoComplete="current-password"
                value={pw.current}
                onChange={(e) => setPw({ ...pw, current: e.target.value })}
                required
              />
              <Input
                label={t("New password")}
                type="password"
                autoComplete="new-password"
                minLength={10}
                value={pw.next}
                onChange={(e) => setPw({ ...pw, next: e.target.value })}
                required
                hint={t("At least 10 characters.")}
                error={pwError}
              />
            </div>
            <div>
              <Button type="submit" variant="dark">
                {t("Change password")}
              </Button>
            </div>
          </form>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>{t("Signed-in devices")}</h2>
          </div>
          <div className="list-rows" style={{ marginTop: 8 }}>
            {sessions.data?.data.map((s) => (
              <div className="list-row" key={s.id}>
                <Monitor className="icon faint" />
                <div className="grow">
                  <div className="title">
                    {device(s.user_agent)}{" "}
                    {s.current && (
                      <span className="chip moss" style={{ marginLeft: 6 }}>
                        {t("this device")}
                      </span>
                    )}
                  </div>
                  <div className="sub">
                    {t("Active {ago}", { ago: ago(s.last_seen_at) })}
                    {s.ip ? ` · ${s.ip}` : ""}
                  </div>
                </div>
                {!s.current && (
                  <Button
                    size="sm"
                    onClick={async () => {
                      await api(`/me/sessions/${s.id}`, { method: "DELETE" });
                      void sessions.reload();
                    }}
                  >
                    {t("Sign out")}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
