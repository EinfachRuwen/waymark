import { Activity, Archive, ArchiveRestore, ArrowLeft, ExternalLink, Lock, Pencil, QrCode, RotateCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { AnalyticsView, RangePicker, useRange } from "../components/AnalyticsView";
import { Button, CopyButton, ErrorNote, Sign, useConfirm, useToast } from "../components/ui";
import { api, type Link as LinkT } from "../lib/api";
import { ago, country, dateTime, num } from "../lib/format";
import { useApi } from "../lib/hooks";
import { Link, useRouter } from "../lib/router";
import { useSession } from "../lib/session";
import { LinkEditor } from "./LinkEditor";
import { QrDialog, qrSvg } from "./QrDialog";

const RULE_WORD: Record<string, string> = { country: "Visitors from", device: "On", os: "On", language: "Speaking" };

function ruleValues(type: string, values: string[]) {
  if (type === "country") return values.map(country).join(", ");
  return values.join(", ");
}

export function LinkDetail({ id }: { id: string }) {
  const { can, bumpLinks, linksVersion } = useSession();
  const { navigate } = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [range, setRange] = useRange();
  const { data: l, error, reload, setData } = useApi<LinkT>(`/links/${id}`, [linksVersion]);
  const [editing, setEditing] = useState(false);
  const [qr, setQr] = useState(false);
  const [health, setHealth] = useState<{ ok: boolean; status: number; ms: number; error?: string; location?: string | null } | null>(null);
  const [checking, setChecking] = useState(false);
  const preview = useMemo(() => (l?.short_url ? qrSvg(l.short_url + "?qr", "#000000", "#ffffff") : ""), [l?.short_url]);

  if (error) return <div className="page"><ErrorNote error={error} retry={reload} /></div>;
  if (!l) return <div className="page"><div className="skeleton" style={{ height: 46, width: 320, marginBottom: 20 }} /><div className="skeleton" style={{ height: 320 }} /></div>;

  async function setArchived(v: boolean) {
    const u = await api<LinkT>(`/links/${l!.id}`, { method: "PATCH", body: { archived: v } });
    setData(u);
    bumpLinks();
    toast(v ? "Link archived. It now answers 404." : "Link restored");
  }

  async function remove() {
    if (!(await confirm({ title: `Delete ${l!.domain}/${l!.slug}?`, body: "Its click history is deleted too. This cannot be undone.", confirm: "Delete link", danger: true }))) return;
    await api(`/links/${l!.id}`, { method: "DELETE" });
    bumpLinks();
    toast("Link deleted");
    navigate("/links");
  }

  async function resetClicks() {
    if (!(await confirm({ title: "Reset click history?", body: "All recorded clicks for this link are deleted and the counter goes back to zero.", confirm: "Reset", danger: true }))) return;
    await api("/links/actions", { body: { ids: [l!.id], action: "reset_clicks" } });
    bumpLinks();
    toast("Click history reset");
  }

  async function check() {
    setChecking(true);
    try {
      setHealth(await api(`/links/${l!.id}/check`, { method: "POST", body: {} }));
    } finally {
      setChecking(false);
    }
  }

  const statusChip = { active: "moss", expired: "ember", scheduled: "sky", archived: "" }[l.status];

  return (
    <div className="page">
      <div className="detail-head">
        <div className="crumbs">
          <Link to="/links" className="row" style={{ gap: 4 }}>
            <ArrowLeft className="icon" /> Links
          </Link>
        </div>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
          <div className="row" style={{ gap: 12, minWidth: 0, flexWrap: "wrap" }}>
            <Sign host={l.domain} slug={l.slug} size="lg" muted={l.status !== "active"} />
            <span className={`chip ${statusChip}`}>{l.status}</span>
            {l.has_password && <span className="chip"><Lock /> password</span>}
          </div>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {l.short_url && <CopyButton text={l.short_url} label="Copy" size="md" />}
            <Button icon={<QrCode className="icon" />} onClick={() => setQr(true)}>QR code</Button>
            {can("links:write") && <Button variant="dark" icon={<Pencil className="icon" />} onClick={() => setEditing(true)}>Edit</Button>}
          </div>
        </div>
        {l.title && <h1 style={{ fontSize: 20, fontWeight: 620, fontStretch: "90%" }}>{l.title}</h1>}
      </div>

      <div className="layout-2">
        <div className="stack" style={{ gap: 18, minWidth: 0 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ fontSize: 15, fontWeight: 650 }}>Traffic</h2>
            <RangePicker value={range} onChange={setRange} />
          </div>
          <AnalyticsView linkId={l.id} range={range} showTargets={l.rules.length + l.variants.length > 0} />
        </div>

        <aside className="stack" style={{ gap: 18 }}>
          <section className="panel">
            <div className="panel-head"><h2>Route</h2></div>
            <div className="panel-body">
              <div className="route">
                <div className="stop blaze">
                  <span className="when">Short link</span>
                  <span className="to">{l.short_url}</span>
                </div>
                {l.has_password && (
                  <div className="stop">
                    <span className="when">Password check</span>
                  </div>
                )}
                {l.rules.map((r, i) => (
                  <div className="stop" key={i}>
                    <span className="when">{RULE_WORD[r.type]} {ruleValues(r.type, r.values)}</span>
                    <a className="to" href={r.url} target="_blank" rel="noreferrer">{r.url}</a>
                  </div>
                ))}
                {l.variants.map((v, i) => (
                  <div className="stop" key={`v${i}`}>
                    <span className="when">{v.weight}% of visitors</span>
                    <a className="to" href={v.url} target="_blank" rel="noreferrer">{v.url}</a>
                  </div>
                ))}
                <div className="stop end">
                  <span className="when">
                    {l.rules.length || l.variants.length ? `Everyone else${l.variants.length ? ` · ${Math.max(0, 100 - l.variants.reduce((s, v) => s + v.weight, 0))}%` : ""}` : "Destination"}
                  </span>
                  <a className="to" href={l.url} target="_blank" rel="noreferrer" title={l.url}>{l.url}</a>
                </div>
              </div>
              <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
                <Button size="sm" icon={<Activity className="icon" />} loading={checking} onClick={() => void check()}>Check destination</Button>
                <a className="btn sm ghost" href={l.url} target="_blank" rel="noreferrer"><ExternalLink className="icon" /> Open</a>
              </div>
              {health && (
                <p style={{ fontSize: 12.5, marginTop: 10, color: health.ok ? "var(--moss)" : "var(--ember)" }} role="status">
                  {health.status ? `Answered ${health.status} in ${num(health.ms)} ms` : health.error}
                  {health.location ? ` → ${health.location}` : ""}
                </p>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Details</h2></div>
            <div className="panel-body">
              <dl className="kv">
                <dt>Total clicks</dt>
                <dd className="num">{num(l.clicks)}{l.max_clicks ? ` of ${num(l.max_clicks)}` : ""}</dd>
                <dt>Last click</dt>
                <dd>{ago(l.last_click_at)}</dd>
                <dt>Created</dt>
                <dd>{dateTime(l.created_at)}</dd>
                {l.created_via && <><dt>Via</dt><dd>{l.created_via}</dd></>}
                {l.starts_at && <><dt>Active from</dt><dd>{dateTime(l.starts_at)}</dd></>}
                {l.expires_at && <><dt>Expires</dt><dd>{dateTime(l.expires_at)}</dd></>}
                {l.expired_url && <><dt>Then</dt><dd className="mono" style={{ fontSize: 12 }}>{l.expired_url}</dd></>}
                <dt>Redirect</dt>
                <dd>{l.cloak ? "Framed (URL stays)" : l.redirect_type ?? "Default"}</dd>
                {l.utm && <><dt>UTM</dt><dd className="mono" style={{ fontSize: 12 }}>{Object.entries(l.utm).map(([k, v]) => `${k}=${v}`).join(" · ")}</dd></>}
                {l.tags.length > 0 && <><dt>Tags</dt><dd><div className="tags">{l.tags.map((t) => <Link key={t} to={`/links?tag=${encodeURIComponent(t)}`} className="tag" style={{ textDecoration: "none" }}>{t}</Link>)}</div></dd></>}
                {l.notes && <><dt>Notes</dt><dd style={{ whiteSpace: "pre-wrap" }}>{l.notes}</dd></>}
                <dt>ID</dt>
                <dd className="mono faint" style={{ fontSize: 11.5 }}>{l.id}</dd>
              </dl>
            </div>
          </section>

          <section className="panel">
            <div className="panel-body">
              <button className="qr-box" style={{ background: "none", border: 0, cursor: "pointer", width: "100%", padding: 0 }} onClick={() => setQr(true)} aria-label="Open QR code options">
                <div className="qr" style={{ maxWidth: 150 }} dangerouslySetInnerHTML={{ __html: preview }} />
              </button>
            </div>
          </section>

          {can("links:write") && (
            <div className="row" style={{ flexWrap: "wrap" }}>
              {l.archived ? (
                <Button size="sm" icon={<ArchiveRestore className="icon" />} onClick={() => void setArchived(false)}>Restore</Button>
              ) : (
                <Button size="sm" icon={<Archive className="icon" />} onClick={() => void setArchived(true)}>Archive</Button>
              )}
              {can("links:delete") && <Button size="sm" icon={<RotateCcw className="icon" />} onClick={() => void resetClicks()}>Reset clicks</Button>}
              {can("links:delete") && <Button size="sm" variant="danger" icon={<Trash2 className="icon" />} onClick={() => void remove()}>Delete</Button>}
            </div>
          )}
        </aside>
      </div>

      {editing && (
        <LinkEditor
          link={l}
          onClose={() => setEditing(false)}
          onSaved={(u) => {
            setEditing(false);
            setData(u);
            bumpLinks();
          }}
        />
      )}
      {qr && <QrDialog link={l} onClose={() => setQr(false)} />}
    </div>
  );
}
