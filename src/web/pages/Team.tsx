import { MoreHorizontal, UserPlus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ROLE_INFO, type Role } from "../../shared/permissions";
import { PageHead } from "../App";
import { Button, Callout, CopyButton, Dialog, ErrorNote, Field, Input, Menu, useConfirm, useToast } from "../components/ui";
import { api, type User } from "../lib/api";
import { ago, initials } from "../lib/format";
import { useApi } from "../lib/hooks";
import { useSession } from "../lib/session";

export function Team() {
  const { me, can } = useSession();
  const { data, error, reload } = useApi<{ data: User[] }>("/users");
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState<{ email: string; url: string; reset: boolean } | null>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const isOwner = me?.user.role === "owner";
  const write = can("users:write");

  async function update(u: User, body: Partial<{ role: Role; disabled: boolean }>) {
    try {
      await api(`/users/${u.id}`, { method: "PATCH", body });
      toast("Saved");
      void reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function resetLink(u: User) {
    const r = await api<{ invite_url: string }>(`/users/${u.id}/invite`, { method: "POST", body: {} });
    setLink({ email: u.email, url: r.invite_url, reset: !u.pending_invite });
  }

  async function remove(u: User) {
    if (!(await confirm({ title: `Remove ${u.name || u.email}?`, body: "Their sessions and API keys stop working. Links they created stay.", confirm: "Remove", danger: true }))) return;
    try {
      await api(`/users/${u.id}`, { method: "DELETE" });
      toast("Removed from the team");
      void reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div className="page">
      <PageHead
        title="Team"
        desc="People who can sign in to this Waymark. Nobody can sign up on their own; every account starts with an invite."
        actions={write && <Button variant="primary" icon={<UserPlus className="icon" />} onClick={() => setInviting(true)}>Invite</Button>}
      />
      {error && <ErrorNote error={error} retry={reload} />}
      <div className="panel list-rows">
        {data?.data.map((u) => (
          <div className="list-row" key={u.id} style={{ opacity: u.disabled ? 0.6 : 1 }}>
            <span className="avatar" style={{ background: "var(--sunken)", color: "var(--ink)" }}>{initials(u.name, u.email)}</span>
            <div className="grow">
              <div className="title">
                {u.name || u.email} {u.id === me?.user.id && <span className="faint" style={{ fontWeight: 450 }}>(you)</span>}
              </div>
              <div className="sub">
                {u.email} · {u.pending_invite ? "invite not accepted yet" : `last sign-in ${ago(u.last_login_at)}`}
                {u.disabled && " · disabled"}
              </div>
            </div>
            {write && u.id !== me?.user.id && (u.role !== "owner" || isOwner) ? (
              <select className="select" style={{ width: "auto" }} value={u.role} onChange={(e) => void update(u, { role: e.target.value as Role })} aria-label={`Role of ${u.email}`}>
                {(Object.keys(ROLE_INFO) as Role[]).filter((r) => r !== "owner" || isOwner).map((r) => <option key={r} value={r}>{ROLE_INFO[r].label}</option>)}
              </select>
            ) : (
              <span className="chip">{ROLE_INFO[u.role].label}</span>
            )}
            {write && u.id !== me?.user.id && (u.role !== "owner" || isOwner) && (
              <Menu trigger={(p) => <Button size="sm" variant="ghost" icon={<MoreHorizontal className="icon" />} aria-label="More" {...p} />}>
                {(close) => (
                  <>
                    <button onClick={() => { close(); void resetLink(u); }}>{u.pending_invite ? "New invite link" : "Password reset link"}</button>
                    <button onClick={() => { close(); void update(u, { disabled: !u.disabled }); }}>{u.disabled ? "Enable account" : "Disable account"}</button>
                    <hr />
                    <button className="danger" onClick={() => { close(); void remove(u); }}>Remove from team</button>
                  </>
                )}
              </Menu>
            )}
          </div>
        ))}
      </div>

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head"><h2>Roles</h2></div>
        <div className="panel-body">
          <dl className="kv">
            {(Object.keys(ROLE_INFO) as Role[]).map((r) => (
              <div key={r} style={{ display: "contents" }}>
                <dt style={{ fontWeight: 600, color: "var(--ink)" }}>{ROLE_INFO[r].label}</dt>
                <dd className="muted">{ROLE_INFO[r].summary}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {inviting && (
        <InviteDialog
          isOwner={isOwner}
          onClose={() => setInviting(false)}
          onDone={(email, url) => {
            setInviting(false);
            setLink({ email, url, reset: false });
            void reload();
          }}
        />
      )}
      {link && (
        <Dialog title={link.reset ? "Password reset link" : "Invite link"} onClose={() => setLink(null)} footer={<Button variant="dark" onClick={() => setLink(null)}>Done</Button>}>
          <div className="stack" style={{ paddingTop: 10 }}>
            <p className="muted">Send this link to {link.email}. It works once and expires in 7 days. Waymark does not send email itself.</p>
            <div className="secret"><code>{link.url}</code><CopyButton text={link.url} iconOnly /></div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function InviteDialog({ isOwner, onClose, onDone }: { isOwner: boolean; onClose: () => void; onDone: (email: string, url: string) => void }) {
  const [f, setF] = useState({ email: "", name: "", role: "editor" as Role });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ invite_url: string }>("/users", { body: f });
      onDone(f.email, r.invite_url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Invite someone" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button type="submit" form="invite-form" variant="dark" loading={busy}>Create invite</Button></>}>
      <form id="invite-form" onSubmit={submit} className="stack" style={{ paddingTop: 12 }}>
        <Input label="Email" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoFocus />
        <Input label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Field label="Role">
          <div className="stack-sm">
            {(Object.keys(ROLE_INFO) as Role[]).filter((r) => r !== "owner" || isOwner).map((r) => (
              <label key={r} className="check" style={{ alignItems: "flex-start" }}>
                <input type="radio" name="role" checked={f.role === r} onChange={() => setF({ ...f, role: r })} style={{ marginTop: 3, accentColor: "var(--ink)" }} />
                <span><b style={{ fontWeight: 600 }}>{ROLE_INFO[r].label}</b> <span className="muted">— {ROLE_INFO[r].summary}</span></span>
              </label>
            ))}
          </div>
        </Field>
        {error && <p className="form-error" role="alert">{error}</p>}
        <Callout>You get a link to send yourself. It works for 7 days.</Callout>
      </form>
    </Dialog>
  );
}
