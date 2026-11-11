import { Monitor } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ROLE_INFO } from "../../shared/permissions";
import { PageHead } from "../App";
import { Button, Input, useToast } from "../components/ui";
import { api } from "../lib/api";
import { ago } from "../lib/format";
import { useApi } from "../lib/hooks";
import { useSession } from "../lib/session";

interface SessionRow {
  id: string;
  created_at: number;
  last_seen_at: number;
  ip: string | null;
  user_agent: string | null;
  current: boolean;
}

function device(ua: string | null) {
  if (!ua) return "Unknown device";
  const os = /iphone/i.test(ua) ? "iPhone" : /ipad/i.test(ua) ? "iPad" : /android/i.test(ua) ? "Android" : /mac os/i.test(ua) ? "Mac" : /windows/i.test(ua) ? "Windows" : /linux/i.test(ua) ? "Linux" : "Device";
  const br = /edg\//i.test(ua) ? "Edge" : /firefox/i.test(ua) ? "Firefox" : /chrome/i.test(ua) ? "Chrome" : /safari/i.test(ua) ? "Safari" : "Browser";
  return `${br} on ${os}`;
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
      toast("Profile saved");
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
      toast("Password changed. Other sessions were signed out.");
      void sessions.reload();
    } catch (err) {
      setPwError((err as Error).message);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <PageHead title="Your account" desc={`${ROLE_INFO[me!.user.role].label}: ${ROLE_INFO[me!.user.role].summary}`} />
      <div className="stack" style={{ gap: 18 }}>
        <section className="panel">
          <form className="panel-body stack" onSubmit={saveProfile}>
            <div className="section-title">Profile</div>
            <div className="grid-2">
              <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
              <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div><Button type="submit" variant="dark">Save profile</Button></div>
          </form>
        </section>
        <section className="panel">
          <form className="panel-body stack" onSubmit={savePassword}>
            <div className="section-title">Password</div>
            <div className="grid-2">
              <Input label="Current password" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />
              <Input label="New password" type="password" autoComplete="new-password" minLength={10} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required hint="At least 10 characters." error={pwError} />
            </div>
            <div><Button type="submit" variant="dark">Change password</Button></div>
          </form>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Signed-in devices</h2></div>
          <div className="list-rows" style={{ marginTop: 8 }}>
            {sessions.data?.data.map((s) => (
              <div className="list-row" key={s.id}>
                <Monitor className="icon faint" />
                <div className="grow">
                  <div className="title">{device(s.user_agent)} {s.current && <span className="chip moss" style={{ marginLeft: 6 }}>this device</span>}</div>
                  <div className="sub">Active {ago(s.last_seen_at)}{s.ip ? ` · ${s.ip}` : ""}</div>
                </div>
                {!s.current && (
                  <Button size="sm" onClick={async () => { await api(`/me/sessions/${s.id}`, { method: "DELETE" }); void sessions.reload(); }}>Sign out</Button>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
