import { Globe, Plus, Star, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { PageHead } from "../App";
import { Button, Callout, Dialog, Empty, Input, Switch, useConfirm, useToast } from "../components/ui";
import { api, type Domain } from "../lib/api";
import { num } from "../lib/format";
import { useSession } from "../lib/session";
import { t } from "../lib/i18n";

export function Domains() {
  const { domains, can, reloadDomains } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Domain | "new" | null>(null);

  async function remove(d: Domain) {
    if (
      !(await confirm({
        title: t("Remove {host}?", { host: d.hostname }),
        body: t("Links on this domain stop working. Only domains without links can be removed."),
        confirm: t("Remove"),
        danger: true,
      }))
    )
      return;
    try {
      await api(`/domains/${d.id}`, { method: "DELETE" });
      toast(t("Domain removed"));
      await reloadDomains();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function makeDefault(d: Domain) {
    await api(`/domains/${d.id}`, { method: "PATCH", body: { is_default: true } });
    toast(t("{host} is now the default", { host: d.hostname }));
    await reloadDomains();
  }

  return (
    <div className="page">
      <PageHead
        title={t("Domains")}
        desc={t("Every hostname that serves your short links. Point a domain at Waymark, then add it here.")}
        actions={
          can("domains:write") && (
            <Button variant="primary" icon={<Plus className="icon" />} onClick={() => setEditing("new")}>
              {t("Add domain")}
            </Button>
          )
        }
      />
      <div className="panel list-rows">
        {domains.length === 0 && <Empty title={t("No domains yet.")} />}
        {domains.map((d) => (
          <div className="list-row" key={d.id}>
            <Globe className="icon faint" />
            <div className="grow">
              <div className="title row" style={{ gap: 8 }}>
                <span className="mono">{d.hostname}</span>
                {d.is_default && <span className="chip blaze">{t("default")}</span>}
              </div>
              <div className="sub">
                {t("{n} links · {len}-character slugs · {cs}", {
                  n: num(d.links ?? 0),
                  len: d.slug_length,
                  cs: t(d.case_sensitive ? "case-sensitive" : "case-insensitive"),
                })}
                {d.root_redirect ? ` · root → ${d.root_redirect}` : ""}
              </div>
            </div>
            {can("domains:write") && (
              <div className="row" style={{ gap: 4 }}>
                {!d.is_default && (
                  <Button size="sm" variant="ghost" icon={<Star className="icon" />} onClick={() => void makeDefault(d)}>
                    {t("Make default")}
                  </Button>
                )}
                <Button size="sm" onClick={() => setEditing(d)}>
                  {t("Edit")}
                </Button>
                <Button size="sm" variant="ghost" icon={<Trash2 className="icon" />} aria-label={`Remove ${d.hostname}`} onClick={() => void remove(d)} />
              </div>
            )}
          </div>
        ))}
      </div>

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h2>{t("Connecting a domain")}</h2>
        </div>
        <div className="panel-body stack" style={{ maxWidth: "75ch", gap: 10 }}>
          <p>
            <b>{t("Cloudflare Workers.")}</b>{" "}
            {t(
              "Open your Worker in the Cloudflare dashboard → Settings → Domains & Routes → Add → Custom domain, and enter the hostname. Cloudflare creates the DNS record and certificate.",
            )}
          </p>
          <p>
            <b>{t("Docker or Node.")}</b>{" "}
            {t(
              "Create an A/AAAA or CNAME record for the hostname pointing at your server, and route it through your reverse proxy (Caddy, Traefik, nginx) to Waymark's port.",
            )}
          </p>
          <p className="muted">{t("Requests on hostnames that are not listed here are served by the default domain.")}</p>
        </div>
      </section>

      {editing && (
        <DomainDialog
          domain={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reloadDomains();
          }}
        />
      )}
    </div>
  );
}

function DomainDialog({ domain, onClose, onSaved }: { domain: Domain | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    hostname: domain?.hostname ?? "",
    root_redirect: domain?.root_redirect ?? "",
    not_found_redirect: domain?.not_found_redirect ?? "",
    slug_length: domain?.slug_length ?? 6,
    case_sensitive: domain?.case_sensitive ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { ...f, root_redirect: f.root_redirect || null, not_found_redirect: f.not_found_redirect || null };
      if (domain) await api(`/domains/${domain.id}`, { method: "PATCH", body });
      else await api("/domains", { body });
      toast(domain ? t("Domain saved") : t("Domain added"));
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={domain ? t("Edit {host}", { host: domain.hostname }) : t("Add a domain")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button type="submit" form="domain-form" variant="dark" loading={busy}>
            {domain ? t("Save") : t("Add domain")}
          </Button>
        </>
      }
    >
      <form id="domain-form" onSubmit={submit} className="stack" style={{ paddingTop: 12 }}>
        <Input
          label={t("Hostname")}
          required
          className="mono"
          placeholder="go.example.com"
          value={f.hostname}
          onChange={(e) => setF({ ...f, hostname: e.target.value })}
          autoFocus
        />
        <Input
          label={t("Root redirect")}
          type="url"
          className="mono"
          placeholder="https://example.com"
          value={f.root_redirect}
          onChange={(e) => setF({ ...f, root_redirect: e.target.value })}
          hint={t("Where the bare domain goes. Empty shows a neutral page.")}
        />
        <Input
          label={t("Not-found redirect")}
          type="url"
          className="mono"
          placeholder="https://example.com/404"
          value={f.not_found_redirect}
          onChange={(e) => setF({ ...f, not_found_redirect: e.target.value })}
          hint={t("Where unknown slugs go. Empty shows a 404 page.")}
        />
        <Input
          label={t("Random slug length")}
          type="number"
          min={3}
          max={32}
          value={f.slug_length}
          onChange={(e) => setF({ ...f, slug_length: Number(e.target.value) })}
        />
        <Switch
          checked={f.case_sensitive}
          onChange={(v) => setF({ ...f, case_sensitive: v })}
          disabled={!!domain?.links}
          label={t("Case-sensitive slugs")}
          description={
            domain?.links
              ? t("Can only change while the domain has no links.")
              : "/Launch and /launch become different links. Needed for most Bitly-style imports."
          }
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {!domain && <Callout>{t("Adding the domain here does not change DNS. Connect it at your host first, see the instructions below the list.")}</Callout>}
      </form>
    </Dialog>
  );
}
