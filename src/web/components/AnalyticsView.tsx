import { Download } from "lucide-react";
import { useState } from "react";
import type { Analytics } from "../lib/api";
import { country, language, num } from "../lib/format";
import { useApi } from "../lib/hooks";
import { Link, useQueryState } from "../lib/router";
import { BarList, ElevationChart, HourStrip } from "./charts";
import { ErrorNote, Segmented, Sign } from "./ui";

export const RANGES = {
  "24h": { label: "24 h", ms: 864e5 },
  "7d": { label: "7 days", ms: 7 * 864e5 },
  "30d": { label: "30 days", ms: 30 * 864e5 },
  "90d": { label: "90 days", ms: 90 * 864e5 },
  "365d": { label: "12 months", ms: 365 * 864e5 },
} as const;
export type RangeKey = keyof typeof RANGES;

export function useRange() {
  const [range, setRange] = useQueryState("range", "30d");
  const key = (range in RANGES ? range : "30d") as RangeKey;
  return [key, setRange as (r: RangeKey) => void] as const;
}

export function RangePicker({ value, onChange }: { value: RangeKey; onChange: (r: RangeKey) => void }) {
  return <Segmented label="Time range" value={value} onChange={onChange} options={(Object.keys(RANGES) as RangeKey[]).map((k) => ({ value: k, label: RANGES[k].label }))} />;
}

function Breakdown({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        {aside}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

const TARGET_LABEL = (k: string | null) => (k === "main" || !k ? "Main destination" : k.startsWith("rule:") ? `Rule ${Number(k.slice(5)) + 1}` : `Variant ${Number(k.slice(8)) + 1}`);

export function AnalyticsView({ linkId, range, showTop, showTargets }: { linkId?: string; range: RangeKey; showTop?: boolean; showTargets?: boolean }) {
  const [tech, setTech] = useState<"devices" | "os" | "browsers">("devices");
  const [place, setPlace] = useState<"countries" | "cities">("countries");
  const now = Date.now();
  // Round to the minute so re-renders do not refetch.
  const to = Math.ceil(now / 60_000) * 60_000;
  const from = to - RANGES[range].ms;
  const qs = new URLSearchParams({ from: String(from), to: String(to), tz: String(-new Date().getTimezoneOffset()), limit: "8" });
  if (linkId) qs.set("link_id", linkId);
  const { data, error, reload } = useApi<Analytics>(`/analytics?${qs}`);

  if (error) return <ErrorNote error={error} retry={reload} />;
  const a = data;
  const dl = `/api/v1/analytics/export.csv?${qs}`;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <section className="panel">
        <div className="panel-body" style={{ paddingTop: 18 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", marginBottom: 14, flexWrap: "wrap", gap: 16 }}>
            <div className="readout">
              <div className="r">
                <b>{a ? num(a.totals.clicks) : "—"}</b>
                <span>Clicks</span>
              </div>
              <div className="r">
                <b>{a ? num(a.totals.visitors) : "—"}</b>
                <span>Unique visitors</span>
              </div>
              <div className="r small">
                <b>{a ? num(a.totals.qr) : "—"}</b>
                <span>QR scans</span>
              </div>
            </div>
            <a className="btn sm ghost" href={dl} download>
              <Download className="icon" /> CSV
            </a>
          </div>
          {a ? <ElevationChart series={a.series} bucket={a.bucket} /> : <div className="skeleton" style={{ height: 220 }} />}
          <div className="row faint" style={{ fontSize: 12, gap: 16, marginTop: 6 }}>
            <span className="row" style={{ gap: 6 }}>
              <span style={{ width: 14, height: 8, background: "var(--chart-fill)", borderTop: "2px solid var(--chart-line)" }} /> Clicks
            </span>
            <span className="row" style={{ gap: 6 }}>
              <span style={{ width: 14, borderTop: "1.5px dashed var(--ink-3)" }} /> Unique visitors
            </span>
          </div>
        </div>
      </section>

      {showTop && (
        <Breakdown title="Most visited links">
          {a ? (
            a.top_links.length ? (
              <div className="barlist">
                {a.top_links.map((t) => {
                  const max = a.top_links[0].clicks || 1;
                  return (
                    <Link key={t.id} to={`/links/${t.id}`} className="item" style={{ ["--w" as string]: `${(t.clicks / max) * 100}%`, textDecoration: "none" }}>
                      <span className="k">
                        <Sign slug={t.slug ?? "deleted"} muted={!t.slug} />
                        <span className="muted" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{t.title || t.url}</span>
                      </span>
                      <span className="v">{num(t.clicks)}</span>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p className="faint" style={{ fontSize: 13 }}>No clicks in this period yet.</p>
            )
          ) : (
            <div className="skeleton" style={{ height: 120 }} />
          )}
        </Breakdown>
      )}

      <div className="cards-2">
        <Breakdown
          title="Where"
          aside={<Segmented label="Place" value={place} onChange={setPlace} options={[{ value: "countries", label: "Countries" }, { value: "cities", label: "Cities" }]} />}
        >
          {a &&
            (place === "countries" ? (
              <BarList
                items={a.countries}
                render={(k) => (
                  <>
                    <span className="code">{k ?? "··"}</span>
                    {country(k)}
                  </>
                )}
              />
            ) : (
              <BarList
                items={a.cities.map((c) => ({ key: `${c.key}|${c.country ?? ""}`, clicks: c.clicks }))}
                render={(k) => {
                  const [city, cc] = (k ?? "").split("|");
                  return (
                    <>
                      <span className="code">{cc || "··"}</span>
                      {city}
                    </>
                  );
                }}
                empty="City data needs Cloudflare or a proxy that sends city headers."
              />
            ))}
        </Breakdown>
        <Breakdown title="Came from">
          {a && <BarList items={a.referrers} render={(k) => k ?? "Direct, apps & QR"} />}
        </Breakdown>
        <Breakdown
          title="Technology"
          aside={
            <Segmented
              label="Technology"
              value={tech}
              onChange={setTech}
              options={[
                { value: "devices", label: "Device" },
                { value: "os", label: "OS" },
                { value: "browsers", label: "Browser" },
              ]}
            />
          }
        >
          {a && <BarList items={a[tech]} render={(k) => (k ? k[0].toUpperCase() + k.slice(1) : "Unknown")} />}
        </Breakdown>
        <Breakdown title="Languages">{a && <BarList items={a.languages} render={(k) => language(k)} />}</Breakdown>
        <Breakdown title="Time of day">{a && <HourStrip hourly={a.hourly} />}</Breakdown>
        {showTargets && <Breakdown title="Routes taken">{a && <BarList items={a.targets} render={TARGET_LABEL} />}</Breakdown>}
      </div>
    </div>
  );
}
