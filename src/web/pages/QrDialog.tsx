import { Download } from "lucide-react";
import { useMemo, useState } from "react";
import { renderSVG } from "uqr";
import { Button, Dialog, Field, Switch } from "../components/ui";
import type { Link } from "../lib/api";
import { download } from "../lib/format";
import { t } from "../lib/i18n";

const PRESETS = [
  { fg: "#000000", bg: "#ffffff", label: t("Black") },
  { fg: "#1c2a22", bg: "#ffffff", label: t("Spruce") },
  { fg: "#1b1a10", bg: "#f2c230", label: t("Signpost") },
  { fg: "#2f5f9b", bg: "#ffffff", label: t("Alpine") },
];

export function qrSvg(text: string, fg: string, bg: string) {
  return renderSVG(text, { ecc: "M", border: 2, pixelSize: 10, blackColor: fg, whiteColor: bg });
}

export function QrDialog({ link, onClose }: { link: Link; onClose: () => void }) {
  const [track, setTrack] = useState(true);
  const [preset, setPreset] = useState(0);
  const [fg, setFg] = useState(PRESETS[0].fg);
  const [bg, setBg] = useState(PRESETS[0].bg);
  const target = (link.short_url ?? "") + (track ? "?qr" : "");
  const svg = useMemo(() => qrSvg(target, fg, bg), [target, fg, bg]);
  const name = link.slug.replace(/[^\w-]+/g, "_");

  async function png(size = 1200) {
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, size, size);
    c.toBlob((b) => b && download(`${name}.png`, b, "image/png"), "image/png");
  }

  return (
    <Dialog
      title={t("QR code")}
      onClose={onClose}
      footer={
        <>
          <Button icon={<Download className="icon" />} onClick={() => download(`${name}.svg`, svg, "image/svg+xml")}>
            {t("SVG")}
          </Button>
          <Button variant="dark" icon={<Download className="icon" />} onClick={() => void png()}>
            {t("PNG")}
          </Button>
        </>
      }
    >
      <div className="stack" style={{ paddingTop: 10 }}>
        <div className="qr-box">
          <div className="qr" style={{ background: bg }} dangerouslySetInnerHTML={{ __html: svg }} />
          <code className="faint" style={{ fontSize: 12 }}>
            {target}
          </code>
        </div>
        <Field label={t("Colors")}>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {PRESETS.map((p, i) => (
              <button
                key={p.label}
                type="button"
                className="btn sm"
                aria-pressed={preset === i}
                style={preset === i ? { borderColor: "var(--ink)" } : undefined}
                onClick={() => {
                  setPreset(i);
                  setFg(p.fg);
                  setBg(p.bg);
                }}
              >
                <span className="dot" style={{ background: p.fg, outline: `3px solid ${p.bg}`, outlineOffset: -1 }} />
                {t(p.label)}
              </button>
            ))}
            <label className="row" style={{ gap: 6, fontSize: 12.5 }}>
              <input
                type="color"
                value={fg}
                onChange={(e) => {
                  setFg(e.target.value);
                  setPreset(-1);
                }}
                aria-label={t("Foreground")}
              />
              <input
                type="color"
                value={bg}
                onChange={(e) => {
                  setBg(e.target.value);
                  setPreset(-1);
                }}
                aria-label={t("Background")}
              />
            </label>
          </div>
        </Field>
        <Switch
          checked={track}
          onChange={setTrack}
          label={t("Count scans separately")}
          description={t("Adds ?qr so scans show up as QR traffic in analytics.")}
        />
      </div>
    </Dialog>
  );
}
