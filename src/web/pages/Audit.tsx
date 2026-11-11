import { useEffect, useState } from "react";
import { PageHead } from "../App";
import { Button, Empty, ErrorNote } from "../components/ui";
import { api, type AuditEntry } from "../lib/api";
import { dateTime } from "../lib/format";
import { Link } from "../lib/router";
import { t } from "../lib/i18n";

const ACTIONS = ["", "link", "domain", "user", "api_key", "webhook", "settings", "import", "auth"];

function describe(e: AuditEntry) {
  const d = (e.detail ?? {}) as Record<string, unknown>;
  switch (e.action) {
    case "link.created":
      return (
        <>
          {t("created")}{" "}
          <Link to={`/links/${e.target_id}`} className="mono">
            {String(d.short_url ?? e.target_id)}
          </Link>
        </>
      );
    case "link.updated":
      return (
        <>
          {t("changed")} <Link to={`/links/${e.target_id}`}>{t("a link")}</Link>
          {Array.isArray(d.fields) ? `: ${(d.fields as string[]).join(", ")}` : ""}
        </>
      );
    case "link.deleted":
      return (
        <>
          {t("deleted")} <span className="mono">{String(d.short_url ?? e.target_id)}</span>
        </>
      );
    default:
      if (e.action.startsWith("link.bulk_"))
        return (
          <>
            {e.action.slice(10).replace("_", " ")} on {String(d.count ?? d.created ?? "")} links
          </>
        );
      return (
        <>
          {e.action.replace(/[._]/g, " ")}
          {d && Object.keys(d).length ? (
            <span className="faint mono" style={{ fontSize: 11.5 }}>
              {" "}
              {JSON.stringify(d).slice(0, 120)}
            </span>
          ) : null}
        </>
      );
  }
}

export function Audit() {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [filter, setFilter] = useState("");
  const [more, setMore] = useState(true);

  async function load(before?: number) {
    try {
      const qs = new URLSearchParams({ limit: "60" });
      if (before) qs.set("before", String(before));
      if (filter) qs.set("action", filter);
      const r = await api<{ data: AuditEntry[] }>(`/audit?${qs}`);
      setRows((x) => (before ? [...(x ?? []), ...r.data] : r.data));
      setMore(r.data.length === 60);
    } catch (e) {
      setError(e as Error);
    }
  }
  useEffect(() => {
    setRows(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  return (
    <div className="page">
      <PageHead
        title={t("Audit log")}
        desc={t("Who changed what, from the app or through an API key. Kept for two years.")}
        actions={
          <select className="select" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t("Filter")}>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a ? a.replace("_", " ") : t("Everything")}
              </option>
            ))}
          </select>
        }
      />
      {error && <ErrorNote error={error} />}
      <div className="panel">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t("When")}</th>
                <th>{t("Who")}</th>
                <th>{t("What")}</th>
                <th className="hide-sm">{t("IP")}</th>
              </tr>
            </thead>
            <tbody>
              {rows?.map((e) => (
                <tr key={e.id}>
                  <td className="num faint" style={{ whiteSpace: "nowrap", fontSize: 12.5 }}>
                    {dateTime(e.ts)}
                  </td>
                  <td style={{ fontSize: 13 }}>{e.actor_label}</td>
                  <td style={{ fontSize: 13 }}>{describe(e)}</td>
                  <td className="mono faint hide-sm" style={{ fontSize: 12 }}>
                    {e.ip}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows && !rows.length && <Empty title={t("Nothing logged yet.")} />}
        {rows && more && rows.length > 0 && (
          <div className="pager">
            <span />
            <Button size="sm" onClick={() => void load(rows[rows.length - 1].id)}>
              {t("Load older")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
