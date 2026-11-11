import { useEffect, useState } from "react";
import { PageHead } from "../App";
import { Button, Callout, Field, Input, Switch, useToast } from "../components/ui";
import { api, type Settings } from "../lib/api";
import { useApi } from "../lib/hooks";
import { useSession } from "../lib/session";
import { t } from "../lib/i18n";

export function SettingsPage() {
  const { data, reload } = useApi<Settings>("/settings");
  const { domains, refresh } = useSession();
  const toast = useToast();
  const [f, setF] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setF(data), [data]);
  if (!f)
    return (
      <div className="page">
        <div className="skeleton" style={{ height: 300 }} />
      </div>
    );
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setF({ ...f, [k]: v });
  const dirty = JSON.stringify(f) !== JSON.stringify(data);

  async function save() {
    setBusy(true);
    try {
      await api("/settings", { method: "PATCH", body: f });
      toast(t("Settings saved"));
      await reload();
      await refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 940 }}>
      <PageHead
        title={t("Settings")}
        desc={t("Applies to everyone in this Waymark.")}
        actions={
          <Button variant="primary" disabled={!dirty} loading={busy} onClick={() => void save()}>
            {t("Save changes")}
          </Button>
        }
      />
      <div className="stack" style={{ gap: 18 }}>
        <Section title={t("Workspace")}>
          <Input
            label={t("Name")}
            value={f.instance_name}
            onChange={(e) => set("instance_name", e.target.value)}
            hint={t("Shown in the sidebar, the sign-in screen and the neutral root page.")}
          />
          <Field
            label={t("Default redirect")}
            hint={t("Links without their own redirect type use this. 302 lets you change destinations later without browsers caching the old one.")}
          >
            <select
              className="select"
              value={f.default_redirect}
              onChange={(e) => set("default_redirect", Number(e.target.value) as Settings["default_redirect"])}
            >
              <option value={302}>{t("302 · temporary")}</option>
              <option value={301}>{t("301 · permanent")}</option>
              <option value={307}>{t("307 · temporary, keeps method")}</option>
              <option value={308}>{t("308 · permanent, keeps method")}</option>
            </select>
          </Field>
        </Section>

        <Section title={t("Analytics")} desc={t("Waymark never stores IP addresses. Unique visitors are counted with a salted hash that changes every day.")}>
          <Switch
            checked={f.track_clicks}
            onChange={(v) => set("track_clicks", v)}
            label={t("Record clicks")}
            description={t("Off: links still redirect, but nothing is logged.")}
          />
          <Switch
            checked={f.count_bots}
            onChange={(v) => set("count_bots", v)}
            label={t("Record bots and link previews")}
            description={t("Crawlers, uptime monitors and chat previews. They are filtered from charts either way.")}
          />
          <Input
            label={t("Keep click history for")}
            type="number"
            min={0}
            max={3650}
            value={f.click_retention_days}
            onChange={(e) => set("click_retention_days", Number(e.target.value))}
            hint={t("Days. 0 keeps everything. Totals on links are never deleted.")}
          />
        </Section>

        <Section title={t("Public API")} desc={t("Waymark is private. These switches open small, controlled doors.")}>
          <Switch
            checked={f.public_shorten}
            onChange={(v) => set("public_shorten", v)}
            label={t("Allow anonymous shortening")}
            description={t("POST /api/v1/public/shorten creates random links without a key. Use for a public form on your site.")}
          />
          {f.public_shorten && (
            <>
              <Callout kind="warn">{t("Anyone can create links on this domain. Watch for abuse; spam links can get a domain blocklisted.")}</Callout>
              <div className="grid-2">
                <Field label={t("Domain for public links")}>
                  <select className="select" value={f.public_shorten_domain ?? ""} onChange={(e) => set("public_shorten_domain", e.target.value || null)}>
                    <option value="">{t("Default domain")}</option>
                    {domains.map((d) => (
                      <option key={d.id} value={d.hostname}>
                        {d.hostname}
                      </option>
                    ))}
                  </select>
                </Field>
                <Input
                  label={t("Links per hour per visitor")}
                  type="number"
                  min={1}
                  value={f.public_rate_limit}
                  onChange={(e) => set("public_rate_limit", Number(e.target.value))}
                />
              </div>
            </>
          )}
          <Input
            label={t("Allowed browser origins (CORS)")}
            className="mono"
            placeholder="https://app.example.com"
            value={f.cors_origins}
            onChange={(e) => set("cors_origins", e.target.value)}
            hint={t("Websites that may call the API with a key from the browser. Separate with commas; * allows all. Cookies never work cross-origin.")}
          />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-body settings-section">
        <div>
          <div className="section-title">{title}</div>
          {desc && <p className="section-desc">{desc}</p>}
        </div>
        <div className="stack">{children}</div>
      </div>
    </section>
  );
}
