import { Database, Download, FileUp, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { PageHead } from "../App";
import { Button, Callout, Field, Input, Switch, Tabs, useToast } from "../components/ui";
import { api } from "../lib/api";
import { detectMapping, detectSource, FIELDS, mapRows, parseCsv, type Field as F } from "../lib/csv";
import { num } from "../lib/format";
import { useSession } from "../lib/session";

type Tab = "shortio" | "csv" | "backup" | "export";

interface Totals {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: { slug?: string; message: string }[];
}
const zero = (): Totals => ({ created: 0, updated: 0, skipped: 0, failed: 0, errors: [] });

function Summary({ t, running, done, total }: { t: Totals; running: boolean; done: number; total: number | null }) {
  return (
    <div className="stack-sm">
      {total ? <div className="progress" aria-label="Progress"><div style={{ width: `${Math.min(100, (done / total) * 100)}%` }} /></div> : null}
      <div className="readout">
        <div className="r small"><b>{num(t.created)}</b><span>created</span></div>
        <div className="r small"><b>{num(t.updated)}</b><span>overwritten</span></div>
        <div className="r small"><b>{num(t.skipped)}</b><span>already there</span></div>
        <div className="r small"><b style={{ color: t.failed ? "var(--ember)" : undefined }}>{num(t.failed)}</b><span>failed</span></div>
      </div>
      <p className="faint" style={{ fontSize: 12.5 }} role="status">{running ? `Working… ${num(done)}${total ? ` of ${num(total)}` : ""} processed` : `Finished. ${num(done)} processed.`}</p>
      {t.errors.length > 0 && (
        <details>
          <summary style={{ cursor: "pointer", fontSize: 13 }}>Show {t.errors.length} problem{t.errors.length === 1 ? "" : "s"}</summary>
          <ul style={{ fontSize: 12.5, maxHeight: 200, overflow: "auto", margin: "8px 0 0", paddingLeft: 18 }}>
            {t.errors.map((e, i) => <li key={i}><code>{e.slug ?? "?"}</code> — {e.message}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

export function ImportExport() {
  const [tab, setTab] = useState<Tab>("shortio");
  const { isAdmin } = useSession();
  return (
    <div className="page">
      <PageHead title="Import & export" desc="Move links in from another shortener, or take everything with you. Imports never delete existing links." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "shortio", label: "From Short.io" },
          { value: "csv", label: "From CSV (Bitly, YOURLS, Kutt…)" },
          ...(isAdmin ? [{ value: "backup" as Tab, label: "Backup & restore" }] : []),
          { value: "export", label: "Export" },
        ]}
      />
      {tab === "shortio" && <ShortioImport />}
      {tab === "csv" && <CsvImport />}
      {tab === "backup" && <Backup />}
      {tab === "export" && <Export />}
    </div>
  );
}

function DomainSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { domains } = useSession();
  return (
    <Field label="Into Waymark domain" hint="Slugs keep their path. Add the old domain under Domains first if you are moving it here.">
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {domains.map((d) => <option key={d.id} value={d.hostname}>{d.hostname}</option>)}
      </select>
    </Field>
  );
}

function ShortioImport() {
  const { domains, bumpLinks } = useSession();
  const toast = useToast();
  const [key, setKey] = useState("");
  const [sDomains, setSDomains] = useState<{ id: string; hostname: string; links: number | null }[] | null>(null);
  const [sDomain, setSDomain] = useState("");
  const [target, setTarget] = useState(domains.find((d) => d.is_default)?.hostname ?? domains[0]?.hostname ?? "");
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ data: { id: string; hostname: string; links: number | null }[] }>("/import/shortio/domains", { body: { api_key: key } });
      setSDomains(r.data);
      setSDomain(r.data[0]?.id ?? "");
      const match = domains.find((d) => r.data.some((s) => s.hostname === d.hostname));
      if (match) setTarget(match.hostname);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setRunning(true);
    stop.current = false;
    const t = zero();
    setTotals({ ...t });
    setDone(0);
    let token: string | null = null;
    let processed = 0;
    try {
      do {
        const r: Totals & { next_page_token: string | null; total: number | null } = await api("/import/shortio/links", {
          body: { api_key: key, shortio_domain_id: sDomain, domain: target, page_token: token, on_conflict: overwrite ? "overwrite" : "skip" },
        });
        t.created += r.created;
        t.updated += r.updated;
        t.skipped += r.skipped;
        t.failed += r.failed;
        t.errors.push(...r.errors);
        processed += r.created + r.updated + r.skipped + r.failed;
        setTotals({ ...t, errors: [...t.errors] });
        setDone(processed);
        if (r.total) setTotal(r.total);
        token = r.next_page_token;
      } while (token && !stop.current);
      toast(`Imported ${num(t.created)} links from Short.io`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setRunning(false);
      bumpLinks();
    }
  }

  return (
    <div className="cards-2" style={{ alignItems: "start" }}>
      <section className="panel">
        <div className="panel-body stack">
          <div>
            <div className="section-title">Import directly from Short.io</div>
            <p className="section-desc">Waymark reads your links through the Short.io API page by page: destinations, slugs, titles, tags, expiry, click limits, cloaking, redirect types, UTM values and iOS/Android targets.</p>
          </div>
          <Input
            label="Short.io secret API key"
            type="password"
            className="mono"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            hint="Short.io → Integrations & API → API keys. Used only for this import, never stored."
            autoComplete="off"
          />
          {!sDomains && <div><Button variant="dark" loading={busy} disabled={key.length < 8} onClick={() => void connect()}>Connect</Button></div>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {sDomains && (
            <>
              <Field label="Short.io domain">
                <select className="select" value={sDomain} onChange={(e) => setSDomain(e.target.value)}>
                  {sDomains.map((d) => <option key={d.id} value={d.id}>{d.hostname}{d.links !== null ? ` · ${num(d.links)} links` : ""}</option>)}
                </select>
              </Field>
              <DomainSelect value={target} onChange={setTarget} />
              <Switch checked={overwrite} onChange={setOverwrite} label="Overwrite links that already exist" description="Off: existing slugs are left alone." />
              <div className="row">
                <Button variant="primary" icon={<Upload className="icon" />} loading={running} onClick={() => void run()} disabled={!sDomain || !target}>Start import</Button>
                {running && <Button onClick={() => (stop.current = true)}>Stop after this page</Button>}
              </div>
            </>
          )}
          {totals && <Summary t={totals} running={running} done={done} total={total} />}
        </div>
      </section>
      <section className="panel">
        <div className="panel-body stack-sm">
          <div className="section-title">Moving a domain from Short.io</div>
          <ol className="muted" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6, fontSize: 13 }}>
            <li>Add the domain under <b>Domains</b> in Waymark.</li>
            <li>Import the links here into that domain.</li>
            <li>Check a few links on the Waymark hostname.</li>
            <li>Point the domain's DNS to Waymark. Old links keep working.</li>
          </ol>
          <Callout>Passwords and Short.io's geo-targeting rules are not exposed by their links API. Re-add those by hand after the import.</Callout>
        </div>
      </section>
    </div>
  );
}

function CsvImport() {
  const { domains, bumpLinks } = useSession();
  const toast = useToast();
  const [file, setFile] = useState<{ name: string; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<F, number>>>({});
  const [target, setTarget] = useState(domains.find((d) => d.is_default)?.hostname ?? domains[0]?.hostname ?? "");
  const [keepClicks, setKeepClicks] = useState(true);
  const [useDomainColumn, setUseDomainColumn] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [running, setRunning] = useState(false);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [done, setDone] = useState(0);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const headers = file?.rows[0] ?? [];
  const source = useMemo(() => detectSource(headers), [headers]);
  const mapped = useMemo(() => (file ? mapRows(file.rows.slice(1), mapping, { keepClicks, useDomainColumn }) : []), [file, mapping, keepClicks, useDomainColumn]);

  async function load(f: File) {
    const text = await f.text();
    const rows = parseCsv(text);
    setFile({ name: f.name, rows });
    setMapping(detectMapping(rows[0] ?? []));
    setTotals(null);
  }

  async function run() {
    setRunning(true);
    const t = zero();
    setTotals({ ...t });
    setDone(0);
    try {
      for (let i = 0; i < mapped.length; i += 200) {
        const chunk = mapped.slice(i, i + 200);
        const r = await api<Omit<Totals, "errors"> & { errors: { index: number; slug?: string; message: string }[] }>("/links/bulk", {
          body: { links: chunk, domain: target, on_conflict: overwrite ? "overwrite" : "skip", source },
        });
        t.created += r.created;
        t.updated += r.updated;
        t.skipped += r.skipped;
        t.failed += r.failed;
        t.errors.push(...r.errors.map((e) => ({ slug: e.slug ?? `row ${i + e.index + 2}`, message: e.message })));
        setTotals({ ...t, errors: [...t.errors] });
        setDone(Math.min(mapped.length, i + 200));
      }
      toast(`Imported ${num(t.created)} links`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setRunning(false);
      bumpLinks();
    }
  }

  return (
    <section className="panel">
      <div className="panel-body stack">
        {!file ? (
          <div
            className={`dropzone ${over ? "over" : ""}`}
            onClick={() => input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void load(f); }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
          >
            <FileUp className="icon" style={{ width: 28, height: 28, marginBottom: 8 }} />
            <div><b style={{ color: "var(--ink)" }}>Drop a CSV export here</b> or click to choose a file.</div>
            <div className="faint" style={{ fontSize: 12.5, marginTop: 6 }}>Exports from Short.io, Bitly, Rebrandly, YOURLS, Kutt, Dub and spreadsheets work. Columns are matched automatically.</div>
            <input ref={input} type="file" accept=".csv,text/csv,.tsv,.txt" hidden onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} />
          </div>
        ) : (
          <>
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
              <div>
                <div className="section-title">{file.name}</div>
                <p className="muted" style={{ fontSize: 13 }}>{num(file.rows.length - 1)} rows · detected as <b>{source === "csv" ? "generic CSV" : source}</b> · {num(mapped.length)} with a destination</p>
              </div>
              <Button size="sm" onClick={() => { setFile(null); setTotals(null); }}>Choose another file</Button>
            </div>
            <div className="grid-3">
              {FIELDS.map((f) => (
                <Field key={f} label={f.replace("_", " ")}>
                  <select className="select" value={mapping[f] ?? ""} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value === "" ? undefined : Number(e.target.value) })}>
                    <option value="">—</option>
                    {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select>
                </Field>
              ))}
            </div>
            {mapping.url === undefined && <Callout kind="warn">Pick the column that holds the destination URL.</Callout>}
            {mapped.length > 0 && (
              <div className="table-wrap panel" style={{ maxHeight: 220, overflow: "auto" }}>
                <table className="data">
                  <thead><tr><th>Slug</th><th>Destination</th><th>Title</th><th>Tags</th><th className="right">Clicks</th></tr></thead>
                  <tbody>
                    {mapped.slice(0, 5).map((r, i) => (
                      <tr key={i}>
                        <td className="mono" style={{ fontSize: 12.5 }}>{r.slug ?? <span className="faint">random</span>}</td>
                        <td className="mono" style={{ fontSize: 12.5, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.url}</td>
                        <td>{r.title}</td>
                        <td>{r.tags?.join(", ")}</td>
                        <td className="right num">{r.clicks ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="grid-2">
              <DomainSelect value={target} onChange={setTarget} />
              <div className="stack-sm" style={{ paddingTop: 22 }}>
                <Switch checked={keepClicks} onChange={setKeepClicks} label="Keep click totals" description="Carries the old counter over. Per-click history cannot be imported." />
                {mapping.domain !== undefined || mapping.short_url !== undefined ? (
                  <Switch checked={useDomainColumn} onChange={setUseDomainColumn} label="Use the domain from each row" description="Rows go to the matching Waymark domain when it exists." />
                ) : null}
                <Switch checked={overwrite} onChange={setOverwrite} label="Overwrite existing slugs" />
              </div>
            </div>
            <div><Button variant="primary" icon={<Upload className="icon" />} loading={running} disabled={!mapped.length || mapping.url === undefined} onClick={() => void run()}>Import {num(mapped.length)} links</Button></div>
            {totals && <Summary t={totals} running={running} done={done} total={mapped.length} />}
          </>
        )}
      </div>
    </section>
  );
}

function Backup() {
  const toast = useToast();
  const { bumpLinks, reloadDomains } = useSession();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function restore(f: File) {
    setBusy(true);
    try {
      const data = JSON.parse(await f.text());
      const r = await api<{ links: number }>("/import/backup", { body: data });
      toast(`Restored ${num(r.links)} links. Existing ones were kept.`);
      bumpLinks();
      await reloadDomains();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="cards-2" style={{ alignItems: "start" }}>
      <section className="panel">
        <div className="panel-body stack-sm">
          <Database className="icon faint" />
          <div className="section-title">Full backup</div>
          <p className="section-desc">Domains, links with all their settings, and tags as one JSON file. Click history is not included; export it as CSV from any analytics view.</p>
          <div><a className="btn dark" href="/api/v1/export/backup.json" download><Download className="icon" /> Download backup</a></div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-body stack-sm">
          <Upload className="icon faint" />
          <div className="section-title">Restore</div>
          <p className="section-desc">Adds what is in a backup file to this Waymark. Links and domains that already exist are left as they are.</p>
          <div><Button loading={busy} onClick={() => input.current?.click()}>Choose backup file</Button></div>
          <input ref={input} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && void restore(e.target.files[0])} />
        </div>
      </section>
    </div>
  );
}

function Export() {
  return (
    <section className="panel">
      <div className="panel-body stack-sm">
        <div className="section-title">Links as CSV</div>
        <p className="section-desc">Short URL, destination, title, tags, clicks and dates for every link you can see. Opens in any spreadsheet and re-imports here.</p>
        <div><a className="btn dark" href="/api/v1/export/links.csv" download><Download className="icon" /> Download links.csv</a></div>
      </div>
    </section>
  );
}
