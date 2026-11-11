import { MoreHorizontal, UserPlus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ROLE_INFO, type Role } from "../../shared/permissions";
import { PageHead } from "../App";
import { Button, Callout, CopyButton, Dialog, ErrorNote, Field, Input, Menu, useConfirm, useToast } from "../components/ui";
import { api, type User } from "../lib/api";
import { ago, initials } from "../lib/format";
import { useApi } from "../lib/hooks";
import { useSession } from "../lib/session";
import { t } from "../lib/i18n";

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
      toast(t("Saved"));
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
    if (
      !(await confirm({
        title: t("Remove {name}?", { name: u.name || u.email }),
        body: t("Their sessions and API keys stop working. Links they created stay."),
        confirm: t("Remove"),
        danger: true,
      }))
    )
      return;
    try {
      await api(`/users/${u.id}`, { method: "DELETE" });
      toast(t("Removed from the team"));
      void reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div className="page">
      <PageHead
        title={t("Team")}
        desc={t("People who can sign in to this Waymark. Nobody can sign up on their own; every account starts with an invite.")}
        actions={
          write && (
            <Button variant="primary" icon={<UserPlus className="icon" />} onClick={() => setInviting(true)}>
              {t("Invite")}
            </Button>
          )
        }
      />
      {error && <ErrorNote error={error} retry={reload} />}
      <div className="panel list-rows">
        {data?.data.map((u) => (
          <div className="list-row" key={u.id} style={{ opacity: u.disabled ? 0.6 : 1 }}>
            <span className="avatar" style={{ background: "var(--sunken)", color: "var(--ink)" }}>
              {initials(u.name, u.email)}
            </span>
            <div className="grow">
              <div className="title">
                {u.name || u.email}{" "}
                {u.id === me?.user.id && (
                  <span className="faint" style={{ fontWeight: 450 }}>
                    {t("(you)")}
                  </span>
                )}
              </div>
              <div className="sub">
                {u.email} · {u.pending_invite ? t("invite not accepted yet") : t("last sign-in {ago}", { ago: ago(u.last_login_at) })}
                {u.disabled && ` · ${t("disabled")}`}
              </div>
            </div>
            {write && u.id !== me?.user.id && (u.role !== "owner" || isOwner) ? (
              <select
                className="select"
                style={{ width: "auto" }}
                value={u.role}
                onChange={(e) => void update(u, { role: e.target.value as Role })}
                aria-label={`Role of ${u.email}`}
              >
                {(Object.keys(ROLE_INFO) as Role[])
                  .filter((r) => r !== "owner" || isOwner)
                  .map((r) => (
                    <option key={r} value={r}>
                      {t(ROLE_INFO[r].label)}
                    </option>
                  ))}
              </select>
            ) : (
              <span className="chip">{t(ROLE_INFO[u.role].label)}</span>
            )}
            {write && u.id !== me?.user.id && (u.role !== "owner" || isOwner) && (
              <Menu trigger={(p) => <Button size="sm" variant="ghost" icon={<MoreHorizontal className="icon" />} aria-label={t("More")} {...p} />}>
                {(close) => (
                  <>
                    <button
                      onClick={() => {
                        close();
                        void resetLink(u);
                      }}
                    >
                      {u.pending_invite ? t("New invite link") : t("Password reset link")}
                    </button>
                    <button
                      onClick={() => {
                        close();
                        void update(u, { disabled: !u.disabled });
                      }}
                    >
                      {u.disabled ? t("Enable account") : t("Disable account")}
                    </button>
                    <hr />
                    <button
                      className="danger"
                      onClick={() => {
                        close();
                        void remove(u);
                      }}
                    >
                      {t("Remove from team")}
                    </button>
                  </>
                )}
              </Menu>
            )}
          </div>
        ))}
      </div>

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h2>{t("Roles")}</h2>
        </div>
        <div className="panel-body">
          <dl className="kv">
            {(Object.keys(ROLE_INFO) as Role[]).map((r) => (
              <div key={r} style={{ display: "contents" }}>
                <dt style={{ fontWeight: 600, color: "var(--ink)" }}>{t(ROLE_INFO[r].label)}</dt>
                <dd className="muted">{t(ROLE_INFO[r].summary)}</dd>
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
        <Dialog
          title={link.reset ? t("Password reset link") : t("Invite link")}
          onClose={() => setLink(null)}
          footer={
            <Button variant="dark" onClick={() => setLink(null)}>
              {t("Done")}
            </Button>
          }
        >
          <div className="stack" style={{ paddingTop: 10 }}>
            <p className="muted">
              {t("Send this link to {email}. It works once and expires in 7 days. Waymark does not send email itself.", { email: link.email })}
            </p>
            <div className="secret">
              <code>{link.url}</code>
              <CopyButton text={link.url} iconOnly />
            </div>
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
    <Dialog
      title={t("Invite someone")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button type="submit" form="invite-form" variant="dark" loading={busy}>
            {t("Create invite")}
          </Button>
        </>
      }
    >
      <form id="invite-form" onSubmit={submit} className="stack" style={{ paddingTop: 12 }}>
        <Input label={t("Email")} type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoFocus />
        <Input label={t("Name")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Field label={t("Role")}>
          <div className="stack-sm">
            {(Object.keys(ROLE_INFO) as Role[])
              .filter((r) => r !== "owner" || isOwner)
              .map((r) => (
                <label key={r} className="check" style={{ alignItems: "flex-start" }}>
                  <input
                    type="radio"
                    name="role"
                    checked={f.role === r}
                    onChange={() => setF({ ...f, role: r })}
                    style={{ marginTop: 3, accentColor: "var(--ink)" }}
                  />
                  <span>
                    <b style={{ fontWeight: 600 }}>{t(ROLE_INFO[r].label)}</b> <span className="muted">— {t(ROLE_INFO[r].summary)}</span>
                  </span>
                </label>
              ))}
          </div>
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Callout>{t("You get a link to send yourself. It works for 7 days.")}</Callout>
      </form>
    </Dialog>
  );
}
