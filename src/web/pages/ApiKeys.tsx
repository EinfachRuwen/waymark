import { KeyRound, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ROLE_SCOPES, SCOPES, type Scope } from "../../shared/permissions";
import { PageHead } from "../App";
import { Button, Callout, CopyButton, Dialog, Empty, ErrorNote, Field, Input, Switch, useConfirm, useToast } from "../components/ui";
import { api, type ApiKey } from "../lib/api";
import { ago, date } from "../lib/format";
import { useApi } from "../lib/hooks";
import { Link } from "../lib/router";
import { useSession } from "../lib/session";

const PRESETS: { label: string; scopes: Scope[] }[] = [
  { label: "Shorten only", scopes: ["links:write"] },
  { label: "Read-only", scopes: ["links:read", "analytics:read", "domains:read"] },
  { label: "Links & stats", scopes: ["links:read", "links:write", "links:delete", "analytics:read", "domains:read"] },
];

export function ApiKeys() {
  const { me, isAdmin } = useSession();
  const { data, error, reload } = useApi<{ data: ApiKey[] }>("/api-keys");
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ name: string; key: string } | null>(null);
  const confirm = useConfirm();
  const toast = useToast();

  async function revoke(k: ApiKey) {
    if (!(await confirm({ title: `Revoke “${k.name}”?`, body: "Anything using this key stops working immediately.", confirm: "Revoke key", danger: true }))) return;
    await api(`/api-keys/${k.id}`, { method: "DELETE" });
    toast("Key revoked");
    void reload();
  }

  const active = data?.data.filter((k) => !k.revoked_at) ?? [];
  const revoked = data?.data.filter((k) => k.revoked_at) ?? [];

  return (
    <div className="page">
      <PageHead
        title="API keys"
        desc={<>Keys let scripts, apps and automations use the <Link to="/api">Waymark API</Link>. A key can do at most what its creator's role allows.</>}
        actions={<Button variant="primary" icon={<Plus className="icon" />} onClick={() => setCreating(true)}>Create key</Button>}
      />
      {error && <ErrorNote error={error} retry={reload} />}
      <div className="panel list-rows">
        {data && !active.length && <Empty sign="wm_…" title="No API keys yet.">Create one to shorten links from Zapier, n8n, iOS Shortcuts, a CMS or your own code.</Empty>}
        {active.map((k) => (
          <div className="list-row" key={k.id}>
            <KeyRound className="icon faint" />
            <div className="grow">
              <div className="title">{k.name}</div>
              <div className="sub">
                <span className="mono">{k.prefix}…</span> · {k.scopes.join(", ")}
                {k.domain_ids ? ` · ${k.domain_ids.length} domain${k.domain_ids.length === 1 ? "" : "s"}` : ""}
              </div>
              <div className="sub">
                Used {ago(k.last_used_at)} · created {date(k.created_at)}
                {isAdmin && k.user_id !== me?.user.id ? ` by ${k.user_email}` : ""}
                {k.expires_at ? ` · ${k.expires_at < Date.now() ? "expired" : "expires"} ${date(k.expires_at)}` : ""}
              </div>
            </div>
            <Button size="sm" variant="danger" onClick={() => void revoke(k)}>Revoke</Button>
          </div>
        ))}
      </div>
      {revoked.length > 0 && (
        <details style={{ marginTop: 18 }}>
          <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>{revoked.length} revoked key{revoked.length === 1 ? "" : "s"}</summary>
          <div className="panel list-rows" style={{ marginTop: 10 }}>
            {revoked.map((k) => (
              <div className="list-row" key={k.id} style={{ opacity: 0.65 }}>
                <div className="grow"><div className="title">{k.name}</div><div className="sub">Revoked {ago(k.revoked_at)}</div></div>
              </div>
            ))}
          </div>
        </details>
      )}
      {creating && <CreateKey onClose={() => setCreating(false)} onCreated={(s) => { setCreating(false); setSecret(s); void reload(); }} />}
      {secret && (
        <Dialog title="Your new API key" onClose={() => setSecret(null)} footer={<Button variant="dark" onClick={() => setSecret(null)}>I saved it</Button>}>
          <div className="stack" style={{ paddingTop: 10 }}>
            <Callout kind="warn">This is the only time the key is shown. Store it in a password manager or your app's secrets.</Callout>
            <div className="secret"><code>{secret.key}</code><CopyButton text={secret.key} iconOnly /></div>
            <pre className="code">{`curl -X POST ${location.origin}/api/v1/links \\
  -H "Authorization: Bearer ${secret.key.slice(0, 12)}…" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://example.com"}'`}</pre>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function CreateKey({ onClose, onCreated }: { onClose: () => void; onCreated: (s: { name: string; key: string }) => void }) {
  const { me, domains } = useSession();
  const allowed = ROLE_SCOPES[me!.user.role];
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Set<Scope>>(new Set(["links:read", "links:write"].filter((s) => allowed.includes(s as Scope)) as Scope[]));
  const [restrict, setRestrict] = useState(false);
  const [domainIds, setDomainIds] = useState<Set<string>>(new Set());
  const [expires, setExpires] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (s: Scope) => setScopes((x) => {
    const n = new Set(x);
    if (n.has(s)) n.delete(s);
    else n.add(s);
    return n;
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ key: string; name: string }>("/api-keys", {
        body: {
          name,
          scopes: [...scopes],
          domain_ids: restrict ? [...domainIds] : null,
          expires_at: expires ? new Date(expires + "T23:59:59").getTime() : null,
        },
      });
      onCreated(r);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog wide title="Create an API key" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button type="submit" form="key-form" variant="dark" loading={busy} disabled={!scopes.size || !name.trim() || (restrict && !domainIds.size)}>Create key</Button></>}>
      <form id="key-form" onSubmit={submit} className="stack" style={{ paddingTop: 12 }}>
        <Input label="Name" required placeholder="Newsletter automation" value={name} onChange={(e) => setName(e.target.value)} autoFocus hint="Shown in the audit log next to everything this key does." />
        <Field label="Permissions">
          <div className="row" style={{ flexWrap: "wrap", marginBottom: 6 }}>
            {PRESETS.map((p) => (
              <Button key={p.label} size="sm" variant="ghost" onClick={() => setScopes(new Set(p.scopes.filter((s) => allowed.includes(s))))}>{p.label}</Button>
            ))}
          </div>
          <div className="scope-grid">
            {(Object.keys(SCOPES) as Scope[]).map((s) => (
              <label key={s} className="check" style={{ alignItems: "flex-start", opacity: allowed.includes(s) ? 1 : 0.45 }}>
                <input type="checkbox" className="box" checked={scopes.has(s)} disabled={!allowed.includes(s)} onChange={() => toggle(s)} style={{ marginTop: 2 }} />
                <span><code style={{ fontSize: 12.5 }}>{s}</code><small>{SCOPES[s]}</small></span>
              </label>
            ))}
          </div>
        </Field>
        <Switch checked={restrict} onChange={setRestrict} label="Limit to specific domains" description="The key can only see and create links on these domains." />
        {restrict && (
          <div className="stack-sm" style={{ paddingLeft: 46 }}>
            {domains.map((d) => (
              <label key={d.id} className="check">
                <input type="checkbox" className="box" checked={domainIds.has(d.id)} onChange={() => setDomainIds((x) => { const n = new Set(x); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n; })} />
                <span className="mono">{d.hostname}</span>
              </label>
            ))}
          </div>
        )}
        <Input label="Expires" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} hint="Optional. The key stops working at the end of this day." />
        {error && <p className="form-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  );
}
