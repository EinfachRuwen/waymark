import { Download } from "lucide-react";
import { useState } from "react";
import type { Analytics } from "../lib/api";
import { country, language, num } from "../lib/format";
import { useApi } from "../lib/hooks";
import { Link, useQueryState } from "../lib/router";
import { BarList, ElevationChart, HourStrip } from "./charts";
import { ErrorNote, Segmented, Sign } from "./ui";
import { t } from "../lib/i18n";

export const RANGES = {
  "24h": { label: t("24 h"), ms: 864e5 },
  "7d": { label: t("7 days"), ms: 7 * 864e5 },
  "30d": { label: t("30 days"), ms: 30 * 864e5 },
  "90d": { label: t("90 days"), ms: 90 * 864e5 },
  "365d": { label: t("12 months"), ms: 365 * 864e5 },
} as const;
export type RangeKey = keyof typeof RANGES;

export function useRange() {
  const [range, setRange] = useQueryState("range", "30d");
  const key = (range in RANGES ? range : "30d") as RangeKey;
  return [key, setRange as (r: RangeKey) => void] as const;
}

export function RangePicker({ value, onChange }: { value: RangeKey; onChange: (r: RangeKey) => void }) {
  return (
    <Segmented
      label={t("Time range")}
      value={value}
      onChange={onChange}
      options={(Object.keys(RANGES) as RangeKey[]).map((k) => ({ value: k, label: RANGES[k].label }))}
    />
  );
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

const TARGET_LABEL = (k: string | null) =>
  k === "main" || !k
    ? t("Main destination")
    : k.startsWith("rule:")
      ? t("Rule {n}", { n: Number(k.slice(5)) + 1 })
      : t("Variant {n}", { n: Number(k.slice(8)) + 1 });

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
                <span>{t("Clicks")}</span>
              </div>
              <div className="r">
                <b>{a ? num(a.totals.visitors) : "—"}</b>
                <span>{t("Unique visitors")}</span>
              </div>
              <div className="r small">
                <b>{a ? num(a.totals.qr) : "—"}</b>
                <span>{t("QR scans")}</span>
              </div>
            </div>
            <a className="btn sm ghost" href={dl} download>
              <Download className="icon" /> {t("CSV")}
            </a>
          </div>
          {a ? <ElevationChart series={a.series} bucket={a.bucket} /> : <div className="skeleton" style={{ height: 220 }} />}
          <div className="row faint" style={{ fontSize: 12, gap: 16, marginTop: 6 }}>
            <span className="row" style={{ gap: 6 }}>
              <span style={{ width: 14, height: 8, background: "var(--chart-fill)", borderTop: "2px solid var(--chart-line)" }} /> {t("Clicks")}
            </span>
            <span className="row" style={{ gap: 6 }}>
              <span style={{ width: 14, borderTop: "1.5px dashed var(--ink-3)" }} /> {t("Unique visitors")}
            </span>
          </div>
        </div>
      </section>

      {showTop && (
        <Breakdown title={t("Most visited links")}>
          {a ? (
            a.top_links.length ? (
              <div className="barlist">
                {a.top_links.map((t) => {
                  const max = a.top_links[0].clicks || 1;
                  return (
                    <Link key={t.id} to={`/links/${t.id}`} className="item" style={{ ["--w" as string]: `${(t.clicks / max) * 100}%`, textDecoration: "none" }}>
                      <span className="k">
                        <Sign slug={t.slug ?? "deleted"} muted={!t.slug} />
                        <span className="muted" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                          {t.title || t.url}
                        </span>
                      </span>
                      <span className="v">{num(t.clicks)}</span>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p className="faint" style={{ fontSize: 13 }}>
                {t("No clicks in this period yet.")}
              </p>
            )
          ) : (
            <div className="skeleton" style={{ height: 120 }} />
          )}
        </Breakdown>
      )}

      <div className="cards-2">
        <Breakdown
          title={t("Where")}
          aside={
            <Segmented
              label={t("Place")}
              value={place}
              onChange={setPlace}
              options={[
                { value: "countries", label: t("Countries") },
                { value: "cities", label: t("Cities") },
              ]}
            />
          }
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
                empty={t("City data needs Cloudflare or a proxy that sends city headers.")}
              />
            ))}
        </Breakdown>
        <Breakdown title={t("Came from")}>{a && <BarList items={a.referrers} render={(k) => k ?? t("Direct, apps & QR")} />}</Breakdown>
        <Breakdown
          title={t("Technology")}
          aside={
            <Segmented
              label={t("Technology")}
              value={tech}
              onChange={setTech}
              options={[
                { value: "devices", label: t("Device") },
                { value: "os", label: "OS" },
                { value: "browsers", label: t("Browser") },
              ]}
            />
          }
        >
          {a && <BarList items={a[tech]} render={(k) => (k ? t(k[0].toUpperCase() + k.slice(1)) : t("Unknown"))} />}
        </Breakdown>
        <Breakdown title={t("Languages")}>{a && <BarList items={a.languages} render={(k) => language(k)} />}</Breakdown>
        <Breakdown title={t("Time of day")}>{a && <HourStrip hourly={a.hourly} />}</Breakdown>
        {showTargets && <Breakdown title={t("Routes taken")}>{a && <BarList items={a.targets} render={TARGET_LABEL} />}</Breakdown>}
      </div>
    </div>
  );
}
