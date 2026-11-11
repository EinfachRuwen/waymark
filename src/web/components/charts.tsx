import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { num } from "../lib/format";
import { lang, t, tn } from "../lib/i18n";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Rounds up so the four contour lines land on whole, readable numbers. */
function niceMax(v: number) {
  const raw = Math.max(1, v / 4);
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  return Math.max(4, step * 4);
}

/**
 * Clicks over time drawn as a trail's elevation profile: the ground is the
 * click count, contour lines mark the scale, and the highest point is the
 * summit, labelled with its date.
 */
export function ElevationChart({
  series,
  bucket,
  height = 220,
}: {
  series: { t: number; clicks: number; visitors: number }[];
  bucket: "day" | "hour";
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 8, r: 44, t: 26, b: 26 };
  const w = Math.max(0, width - pad.l - pad.r);
  const h = height - pad.t - pad.b;
  const max = niceMax(Math.max(1, ...series.map((s) => s.clicks)));
  const n = series.length;
  const x = (i: number) => pad.l + (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => pad.t + h - (v / max) * h;

  const { area, line, vline, peak } = useMemo(() => {
    if (!n || !w) return { area: "", line: "", vline: "", peak: -1 };
    let line = "";
    let vline = "";
    let peak = 0;
    series.forEach((s, i) => {
      line += `${i ? "L" : "M"}${x(i).toFixed(1)},${y(s.clicks).toFixed(1)}`;
      vline += `${i ? "L" : "M"}${x(i).toFixed(1)},${y(s.visitors).toFixed(1)}`;
      if (s.clicks > series[peak].clicks) peak = i;
    });
    const area = `${line}L${x(n - 1).toFixed(1)},${pad.t + h}L${x(0).toFixed(1)},${pad.t + h}Z`;
    return { area, line, vline, peak: series[peak]?.clicks ? peak : -1 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, w, h, max]);

  const fmt = (t: number) =>
    bucket === "hour"
      ? new Date(t).toLocaleTimeString(lang(), { hour: "2-digit", minute: "2-digit" })
      : new Date(t).toLocaleDateString(lang(), { day: "numeric", month: "short" });
  const fmtLong = (t: number) =>
    bucket === "hour"
      ? new Date(t).toLocaleString(lang(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
      : new Date(t).toLocaleDateString(lang(), { weekday: "short", day: "numeric", month: "long" });

  const ticks = [0.25, 0.5, 0.75, 1].map((f) => f * max);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 90))));
  const total = series.reduce((s, x) => s + x.clicks, 0);

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left - pad.l;
    const i = Math.round((px / Math.max(1, w)) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  }

  const hv = hover !== null ? series[hover] : null;

  return (
    <div className="chart-wrap" ref={ref}>
      {width > 0 && (
        <svg
          height={height}
          role="img"
          aria-label={
            tn(total, "{n} click over {span}", "{n} clicks over {span}", {
              span: tn(n, bucket === "day" ? "{n} day" : "{n} hour", bucket === "day" ? "{n} days" : "{n} hours"),
            }) + (peak >= 0 ? t(", peak of {c} on {d}", { c: num(series[peak].clicks), d: fmtLong(series[peak].t) }) : "")
          }
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={pad.l + w} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray={v === max ? "0" : "2 4"} strokeWidth={1} />
              <text x={pad.l + w + 8} y={y(v) + 4} fontSize="11" fill="var(--ink-3)" style={{ fontVariantNumeric: "tabular-nums" }}>
                {num(v)}
              </text>
            </g>
          ))}
          <line x1={pad.l} x2={pad.l + w} y1={pad.t + h} y2={pad.t + h} stroke="var(--ink-3)" strokeWidth={1} />
          <path d={area} fill="var(--chart-fill)" />
          <path d={vline} fill="none" stroke="var(--ink-3)" strokeWidth={1.25} strokeDasharray="3 3" strokeLinejoin="round" />
          <path d={line} fill="none" stroke="var(--chart-line)" strokeWidth={1.75} strokeLinejoin="round" />
          {peak >= 0 && hover === null && (
            <g transform={`translate(${x(peak)},${y(series[peak].clicks)})`}>
              <path d="M0,-4 L5,-13 L-5,-13 Z" fill="var(--ember)" />
              <text
                y={-18}
                fontSize="11.5"
                fontWeight={600}
                fill="var(--ink)"
                textAnchor={x(peak) > pad.l + w - 60 ? "end" : x(peak) < pad.l + 60 ? "start" : "middle"}
              >
                {t("Peak")} {num(series[peak].clicks)} · {fmt(series[peak].t)}
              </text>
            </g>
          )}
          {series.map((s, i) =>
            i % labelEvery === 0 ? (
              <text key={s.t} x={x(i)} y={height - 6} fontSize="11" fill="var(--ink-3)" textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>
                {fmt(s.t)}
              </text>
            ) : null,
          )}
          {hv && hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + h} stroke="var(--ink)" strokeWidth={1} />
              <circle cx={x(hover)} cy={y(hv.clicks)} r={4} fill="var(--blaze)" stroke="var(--ink)" strokeWidth={1.5} />
            </g>
          )}
        </svg>
      )}
      {hv && hover !== null && (
        <div className="chart-tip" style={{ left: x(hover), top: y(hv.clicks) }}>
          {fmtLong(hv.t)}
          <br />
          <b>{num(hv.clicks)}</b> {t("clicks ·")} <b>{num(hv.visitors)}</b> {t("visitors")}
        </div>
      )}
    </div>
  );
}

export function BarList({
  items,
  render,
  empty = t("No data in this period."),
}: {
  items: { key: string | null; clicks: number }[];
  render?: (key: string | null) => ReactNode;
  empty?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.clicks));
  if (!items.length)
    return (
      <p className="faint" style={{ fontSize: 13, padding: "6px 0" }}>
        {empty}
      </p>
    );
  return (
    <div className="barlist">
      {items.map((i) => (
        <div className="item" key={String(i.key)} style={{ ["--w" as string]: `${(i.clicks / max) * 100}%` }}>
          <span className="k">{render ? render(i.key) : (i.key ?? t("Unknown"))}</span>
          <span className="v">{num(i.clicks)}</span>
        </div>
      ))}
    </div>
  );
}

/** 24 hourly cells. Darker means busier. */
export function HourStrip({ hourly }: { hourly: number[] }) {
  const max = Math.max(1, ...hourly);
  const best = hourly.indexOf(Math.max(...hourly));
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 2 }} role="img" aria-label={t("Busiest hour: {h}:00", { h: best })}>
        {hourly.map((v, h) => (
          <div
            key={h}
            title={`${String(h).padStart(2, "0")}:00 — ${num(v)} ${t("clicks")}`}
            style={{
              height: 28,
              borderRadius: 3,
              background: v ? `color-mix(in oklab, var(--chart-line) ${Math.round(12 + (v / max) * 88)}%, var(--sunken))` : "var(--sunken)",
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--ink-3)", marginTop: 6 }}>
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
    </div>
  );
}
