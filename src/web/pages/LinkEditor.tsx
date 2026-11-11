import { ArrowRight, Plus, Shuffle, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { Button, Callout, Drawer, Field, Input, Sign, Switch, Tabs, useToast } from "../components/ui";
import { api, type Link, type Rule } from "../lib/api";
import { fromLocalInput, splitUrl, toLocalInput } from "../lib/format";
import { useDebounced } from "../lib/hooks";
import { useSession } from "../lib/session";
import { t } from "../lib/i18n";

type Tab = "basics" | "targeting" | "access" | "preview" | "utm";

interface Form {
  url: string;
  domain: string;
  slug: string;
  title: string;
  notes: string;
  tags: string;
  redirect_type: "" | "301" | "302" | "307" | "308";
  starts_at: string;
  expires_at: string;
  max_clicks: string;
  expired_url: string;
  password: string;
  removePassword: boolean;
  cloak: boolean;
  forward_query: boolean;
  utm: { source: string; medium: string; campaign: string; term: string; content: string };
  rules: Rule[];
  variants: { url: string; weight: number }[];
  og_title: string;
  og_description: string;
  og_image: string;
}

function initial(link: Link | undefined, defaultDomain: string): Form {
  return {
    url: link?.url ?? "",
    domain: link?.domain ?? defaultDomain,
    slug: link?.slug ?? "",
    title: link?.title ?? "",
    notes: link?.notes ?? "",
    tags: link?.tags.join(", ") ?? "",
    redirect_type: (link?.redirect_type ? String(link.redirect_type) : "") as Form["redirect_type"],
    starts_at: toLocalInput(link?.starts_at),
    expires_at: toLocalInput(link?.expires_at),
    max_clicks: link?.max_clicks ? String(link.max_clicks) : "",
    expired_url: link?.expired_url ?? "",
    password: "",
    removePassword: false,
    cloak: link?.cloak ?? false,
    forward_query: link?.forward_query ?? true,
    utm: { source: "", medium: "", campaign: "", term: "", content: "", ...(link?.utm ?? {}) },
    rules: link?.rules ?? [],
    variants: link?.variants ?? [],
    og_title: link?.og_title ?? "",
    og_description: link?.og_description ?? "",
    og_image: link?.og_image ?? "",
  };
}

const RULE_HINT: Record<Rule["type"], string> = {
  country: t("Country codes, e.g. DE, AT, CH"),
  device: "mobile, tablet, desktop",
  os: "ios, ipados, android, windows, macos, linux",
  language: t("Language codes, e.g. de, en, fr"),
};

export function LinkEditor({
  link,
  onClose,
  onSaved,
  prefill,
}: {
  link?: Link;
  onClose: () => void;
  onSaved: (l: Link) => void;
  prefill?: Partial<Pick<Form, "url">>;
}) {
  const { domains } = useSession();
  const toast = useToast();
  const defaultDomain = domains.find((d) => d.is_default)?.hostname ?? domains[0]?.hostname ?? "";
  const [f, setF] = useState<Form>(() => ({ ...initial(link, defaultDomain), ...prefill }));
  const [tab, setTab] = useState<Tab>("basics");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [slugState, setSlugState] = useState<{ available: boolean; reason: string | null } | null>(null);
  const formId = useId();
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const debouncedSlug = useDebounced(f.slug, 300);
  useEffect(() => {
    if (!debouncedSlug || (link && debouncedSlug === link.slug && f.domain === link.domain)) {
      setSlugState(null);
      return;
    }
    let live = true;
    api<{ available: boolean; reason: string | null }>(`/links/check-slug?domain=${encodeURIComponent(f.domain)}&slug=${encodeURIComponent(debouncedSlug)}`)
      .then((r) => live && setSlugState(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [debouncedSlug, f.domain, link]);

  const variantTotal = f.variants.reduce((s, v) => s + (Number(v.weight) || 0), 0);
  const tagList = f.tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const preview = useMemo(() => {
    if (!f.url) return null;
    try {
      const u = new URL(f.url);
      for (const [k, v] of Object.entries(f.utm)) if (v.trim() && !u.searchParams.has(`utm_${k}`)) u.searchParams.set(`utm_${k}`, v.trim());
      return u.toString();
    } catch {
      return null;
    }
  }, [f.url, f.utm]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (variantTotal > 100) {
      setTab("targeting");
      setError(t("Split weights add up to more than 100%."));
      return;
    }
    setBusy(true);
    const payload: Record<string, unknown> = {
      url: f.url.trim(),
      domain: f.domain || undefined,
      slug: f.slug.trim() || (link ? undefined : null),
      title: f.title,
      notes: f.notes,
      tags: tagList,
      redirect_type: f.redirect_type ? Number(f.redirect_type) : undefined,
      starts_at: fromLocalInput(f.starts_at),
      expires_at: fromLocalInput(f.expires_at),
      max_clicks: f.max_clicks ? Number(f.max_clicks) : null,
      expired_url: f.expired_url.trim() || null,
      cloak: f.cloak,
      forward_query: f.forward_query,
      utm: f.utm,
      rules: f.rules.filter((r) => r.url.trim() && r.values.length),
      variants: f.variants.filter((v) => v.url.trim()),
      og_title: f.og_title,
      og_description: f.og_description,
      og_image: f.og_image.trim() || null,
    };
    if (f.password) payload.password = f.password;
    else if (f.removePassword) payload.password = null;
    try {
      const saved = link ? await api<Link>(`/links/${link.id}`, { method: "PATCH", body: payload }) : await api<Link>("/links", { body: payload });
      toast(link ? t("Link saved") : t("Link created"));
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const counts = {
    targeting: f.rules.length + f.variants.length,
    access: [f.expires_at, f.max_clicks, f.starts_at, f.password || (link?.has_password && !f.removePassword) ? "x" : ""].filter(Boolean).length,
    preview: [f.og_title, f.og_description, f.og_image].filter(Boolean).length,
    utm: Object.values(f.utm).filter((v) => v.trim()).length,
  };

  const dest = splitUrl(f.url);

  return (
    <Drawer
      title={link ? t("Edit link") : t("New link")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button type="submit" form={formId} variant="primary" loading={busy}>
            {link ? t("Save changes") : t("Create link")}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="stack">
        <div className="trail" style={{ padding: "6px 0 10px", minHeight: 46 }}>
          <Sign host={f.domain} slug={f.slug || (link ? link.slug : t("random"))} size="md" muted={!f.slug && !link} />
          <ArrowRight className="icon faint" />
          <span className="dest">
            {f.url ? (
              <>
                <b>{dest.host}</b>
                {dest.rest}
              </>
            ) : (
              "destination"
            )}
          </span>
        </div>

        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "basics", label: t("Destination") },
            { value: "targeting", label: t("Targeting"), badge: counts.targeting || null },
            { value: "access", label: t("Limits & access"), badge: counts.access || null },
            { value: "preview", label: t("Social preview"), badge: counts.preview || null },
            { value: "utm", label: "UTM", badge: counts.utm || null },
          ]}
        />

        {tab === "basics" && (
          <div className="stack">
            <Input
              label={t("Destination URL")}
              type="url"
              required
              placeholder="https://"
              className="mono"
              value={f.url}
              onChange={(e) => set("url", e.target.value)}
              autoFocus
              hint={t("Any http(s) link, or an app link like spotify:track:…")}
            />
            <Field
              label={t("Short link")}
              error={slugState && !slugState.available ? slugState.reason : null}
              hint={!link ? t("Leave the slug empty for a random one.") : undefined}
            >
              <div className="input-group">
                <select className="select" value={f.domain} onChange={(e) => set("domain", e.target.value)} aria-label={t("Domain")}>
                  {domains.map((d) => (
                    <option key={d.id} value={d.hostname}>
                      {d.hostname}
                    </option>
                  ))}
                </select>
                <span className="addon">/</span>
                <input
                  className="input mono"
                  value={f.slug}
                  onChange={(e) => set("slug", e.target.value)}
                  placeholder={t("launch-2026")}
                  aria-label={t("Slug")}
                  spellCheck={false}
                />
              </div>
            </Field>
            <Input
              label={t("Title")}
              value={f.title}
              onChange={(e) => set("title", e.target.value)}
              hint={t("Only you see it. Helps you find the link later.")}
            />
            <Input
              label={t("Tags")}
              value={f.tags}
              onChange={(e) => set("tags", e.target.value)}
              placeholder={t("campaign, newsletter")}
              hint={t("Separate with commas.")}
            />
            <Field label={t("Notes")}>
              <textarea className="input" value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
            </Field>
            <div className="grid-2">
              <Field label={t("Redirect type")} hint={t("Default follows your settings.")}>
                <select className="select" value={f.redirect_type} onChange={(e) => set("redirect_type", e.target.value as Form["redirect_type"])}>
                  <option value="">{t("Default")}</option>
                  <option value="302">{t("302 · temporary")}</option>
                  <option value="301">{t("301 · permanent")}</option>
                  <option value="307">{t("307 · temporary, keeps method")}</option>
                  <option value="308">{t("308 · permanent, keeps method")}</option>
                </select>
              </Field>
            </div>
            <Switch
              checked={f.forward_query}
              onChange={(v) => set("forward_query", v)}
              label={t("Pass query parameters through")}
              description={t("?ref=newsletter on the short link is added to the destination.")}
            />
            <Switch
              checked={f.cloak}
              onChange={(v) => set("cloak", v)}
              label={t("Keep the short URL in the address bar")}
              description={t("Shows the destination in a frame. Many sites refuse to be framed, so test it.")}
            />
          </div>
        )}

        {tab === "targeting" && (
          <div className="stack">
            <div>
              <div className="section-title">{t("Rules")}</div>
              <p className="section-desc">
                {t(
                  "Send visitors elsewhere by country, device, operating system or language. The first matching rule wins; everyone else goes to the destination.",
                )}
              </p>
              <div className="stack-sm">
                {f.rules.map((r, i) => (
                  <div className="rule-row" key={i}>
                    <select
                      className="select"
                      value={r.type}
                      aria-label={t("Rule type")}
                      onChange={(e) =>
                        set(
                          "rules",
                          f.rules.map((x, j) => (j === i ? { ...x, type: e.target.value as Rule["type"] } : x)),
                        )
                      }
                    >
                      <option value="country">{t("Country")}</option>
                      <option value="device">{t("Device")}</option>
                      <option value="os">{t("OS")}</option>
                      <option value="language">{t("Language")}</option>
                    </select>
                    <input
                      className="input mono"
                      placeholder={t(RULE_HINT[r.type])}
                      aria-label={t("Values")}
                      value={r.values.join(", ")}
                      onChange={(e) =>
                        set(
                          "rules",
                          f.rules.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  values: e.target.value
                                    .split(",")
                                    .map((v) => v.trim())
                                    .filter(Boolean),
                                }
                              : x,
                          ),
                        )
                      }
                    />
                    <input
                      className="input mono"
                      placeholder="https://"
                      aria-label={t("Send to")}
                      value={r.url}
                      onChange={(e) =>
                        set(
                          "rules",
                          f.rules.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)),
                        )
                      }
                    />
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={t("Remove rule")}
                      onClick={() =>
                        set(
                          "rules",
                          f.rules.filter((_, j) => j !== i),
                        )
                      }
                    >
                      <Trash2 className="icon" />
                    </button>
                  </div>
                ))}
                <div className="row">
                  <Button size="sm" icon={<Plus className="icon" />} onClick={() => set("rules", [...f.rules, { type: "country", values: [], url: "" }])}>
                    {t("Add rule")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => set("rules", [...f.rules, { type: "os", values: ["ios", "ipados"], url: "" }, { type: "os", values: ["android"], url: "" }])}
                  >
                    {t("App store pair")}
                  </Button>
                </div>
              </div>
            </div>
            <hr className="divider" />
            <div>
              <div className="section-title">{t("Split traffic")}</div>
              <p className="section-desc">{t("A/B test destinations. The main destination receives what is left of 100%.")}</p>
              <div className="stack-sm">
                {f.variants.map((v, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 92px 30px", gap: 8 }}>
                    <input
                      className="input mono"
                      placeholder="https://"
                      aria-label={t("Variant URL")}
                      value={v.url}
                      onChange={(e) =>
                        set(
                          "variants",
                          f.variants.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)),
                        )
                      }
                    />
                    <div className="input-group">
                      <input
                        className="input num"
                        type="number"
                        min={1}
                        max={100}
                        aria-label={t("Weight in percent")}
                        value={v.weight}
                        onChange={(e) =>
                          set(
                            "variants",
                            f.variants.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)),
                          )
                        }
                      />
                      <span className="addon" style={{ paddingRight: 10 }}>
                        %
                      </span>
                    </div>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={t("Remove variant")}
                      onClick={() =>
                        set(
                          "variants",
                          f.variants.filter((_, j) => j !== i),
                        )
                      }
                    >
                      <Trash2 className="icon" />
                    </button>
                  </div>
                ))}
                {f.variants.length > 0 && (
                  <p className={variantTotal > 100 ? "error" : "faint"} style={{ fontSize: 12.5, color: variantTotal > 100 ? "var(--ember)" : undefined }}>
                    {t("Main destination: {main}% · variants: {v}%", { main: Math.max(0, 100 - variantTotal), v: variantTotal })}
                  </p>
                )}
                <div>
                  <Button
                    size="sm"
                    icon={<Shuffle className="icon" />}
                    onClick={() => set("variants", [...f.variants, { url: "", weight: 50 }])}
                    disabled={f.variants.length >= 10}
                  >
                    {t("Add variant")}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "access" && (
          <div className="stack">
            <div className="grid-2">
              <Input
                label={t("Active from")}
                type="datetime-local"
                value={f.starts_at}
                onChange={(e) => set("starts_at", e.target.value)}
                hint={t("Before this, the link answers 404.")}
              />
              <Input label={t("Expires at")} type="datetime-local" value={f.expires_at} onChange={(e) => set("expires_at", e.target.value)} />
            </div>
            <div className="grid-2">
              <Input
                label={t("Click limit")}
                type="number"
                min={1}
                value={f.max_clicks}
                onChange={(e) => set("max_clicks", e.target.value)}
                hint={t("Stops after this many visits.")}
              />
              <Input
                label={t("After expiry, send to")}
                type="url"
                className="mono"
                placeholder="https://"
                value={f.expired_url}
                onChange={(e) => set("expired_url", e.target.value)}
                hint={t("Empty shows an expiry page.")}
              />
            </div>
            <hr className="divider" />
            {link?.has_password && !f.removePassword ? (
              <Callout>
                {t("This link has a password.")}{" "}
                <button type="button" className="btn sm ghost" onClick={() => set("removePassword", true)}>
                  {t("Remove it")}
                </button>{" "}
                {t("or type a new one below to replace it.")}
              </Callout>
            ) : null}
            <Input
              label={link?.has_password ? t("New password") : t("Password")}
              type="password"
              autoComplete="new-password"
              value={f.password}
              onChange={(e) => set("password", e.target.value)}
              hint={t("Visitors must enter it before they are redirected.")}
            />
          </div>
        )}

        {tab === "preview" && (
          <div className="stack">
            <p className="section-desc" style={{ margin: 0 }}>
              {t("What chat apps and social networks show when someone shares the short link. Leave empty to use the destination's own preview.")}
            </p>
            <Input label={t("Title")} value={f.og_title} onChange={(e) => set("og_title", e.target.value)} />
            <Field label={t("Description")}>
              <textarea className="input" rows={2} value={f.og_description} onChange={(e) => set("og_description", e.target.value)} />
            </Field>
            <Input
              label={t("Image URL")}
              type="url"
              className="mono"
              placeholder="https://…/card.png"
              value={f.og_image}
              onChange={(e) => set("og_image", e.target.value)}
              hint={t("1200 × 630 works everywhere.")}
            />
            {(f.og_title || f.og_image) && (
              <div className="panel" style={{ overflow: "hidden", maxWidth: 420 }}>
                {f.og_image && (
                  <img
                    src={f.og_image}
                    alt=""
                    style={{ width: "100%", aspectRatio: "1.91", objectFit: "cover", display: "block", background: "var(--sunken)" }}
                  />
                )}
                <div style={{ padding: "10px 12px" }}>
                  <div className="faint" style={{ fontSize: 12 }}>
                    {f.domain}
                  </div>
                  <div style={{ fontWeight: 650 }}>{f.og_title}</div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {f.og_description}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "utm" && (
          <div className="stack">
            <p className="section-desc" style={{ margin: 0 }}>
              {t("Added to the destination on every redirect. Parameters already in the destination URL win.")}
            </p>
            <div className="grid-2">
              {(["source", "medium", "campaign", "term", "content"] as const).map((k) => (
                <Input key={k} label={`utm_${k}`} className="mono" value={f.utm[k]} onChange={(e) => set("utm", { ...f.utm, [k]: e.target.value })} />
              ))}
            </div>
            {preview && (
              <Field label={t("Result")}>
                <div className="secret">
                  <code>{preview}</code>
                </div>
              </Field>
            )}
          </div>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Drawer>
  );
}
