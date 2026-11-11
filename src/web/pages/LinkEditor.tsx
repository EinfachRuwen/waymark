import { ArrowRight, Plus, Shuffle, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { Button, Callout, Drawer, Field, Input, Sign, Switch, Tabs, useToast } from "../components/ui";
import { api, type Link, type Rule } from "../lib/api";
import { fromLocalInput, splitUrl, toLocalInput } from "../lib/format";
import { useDebounced } from "../lib/hooks";
import { useSession } from "../lib/session";

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
  country: "Country codes, e.g. DE, AT, CH",
  device: "mobile, tablet, desktop",
  os: "ios, ipados, android, windows, macos, linux",
  language: "Language codes, e.g. de, en, fr",
};

export function LinkEditor({ link, onClose, onSaved, prefill }: { link?: Link; onClose: () => void; onSaved: (l: Link) => void; prefill?: Partial<Pick<Form, "url">> }) {
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
      setError("Split weights add up to more than 100%.");
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
      toast(link ? "Link saved" : "Link created");
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
      title={link ? "Edit link" : "New link"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" loading={busy}>
            {link ? "Save changes" : "Create link"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="stack">
        <div className="trail" style={{ padding: "6px 0 10px", minHeight: 46 }}>
          <Sign host={f.domain} slug={f.slug || (link ? link.slug : "random")} size="md" muted={!f.slug && !link} />
          <ArrowRight className="icon faint" />
          <span className="dest">{f.url ? <><b>{dest.host}</b>{dest.rest}</> : "destination"}</span>
        </div>

        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "basics", label: "Destination" },
            { value: "targeting", label: "Targeting", badge: counts.targeting || null },
            { value: "access", label: "Limits & access", badge: counts.access || null },
            { value: "preview", label: "Social preview", badge: counts.preview || null },
            { value: "utm", label: "UTM", badge: counts.utm || null },
          ]}
        />

        {tab === "basics" && (
          <div className="stack">
            <Input
              label="Destination URL"
              type="url"
              required
              placeholder="https://"
              className="mono"
              value={f.url}
              onChange={(e) => set("url", e.target.value)}
              autoFocus
              hint="Any http(s) link, or an app link like spotify:track:…"
            />
            <Field label="Short link" error={slugState && !slugState.available ? slugState.reason : null} hint={!link ? "Leave the slug empty for a random one." : undefined}>
              <div className="input-group">
                <select className="select" value={f.domain} onChange={(e) => set("domain", e.target.value)} aria-label="Domain">
                  {domains.map((d) => (
                    <option key={d.id} value={d.hostname}>
                      {d.hostname}
                    </option>
                  ))}
                </select>
                <span className="addon">/</span>
                <input className="input mono" value={f.slug} onChange={(e) => set("slug", e.target.value)} placeholder="launch-2026" aria-label="Slug" spellCheck={false} />
              </div>
            </Field>
            <Input label="Title" value={f.title} onChange={(e) => set("title", e.target.value)} hint="Only you see it. Helps you find the link later." />
            <Input label="Tags" value={f.tags} onChange={(e) => set("tags", e.target.value)} placeholder="campaign, newsletter" hint="Separate with commas." />
            <Field label="Notes">
              <textarea className="input" value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
            </Field>
            <div className="grid-2">
              <Field label="Redirect type" hint="Default follows your settings.">
                <select className="select" value={f.redirect_type} onChange={(e) => set("redirect_type", e.target.value as Form["redirect_type"])}>
                  <option value="">Default</option>
                  <option value="302">302 · temporary</option>
                  <option value="301">301 · permanent</option>
                  <option value="307">307 · temporary, keeps method</option>
                  <option value="308">308 · permanent, keeps method</option>
                </select>
              </Field>
            </div>
            <Switch checked={f.forward_query} onChange={(v) => set("forward_query", v)} label="Pass query parameters through" description="?ref=newsletter on the short link is added to the destination." />
            <Switch checked={f.cloak} onChange={(v) => set("cloak", v)} label="Keep the short URL in the address bar" description="Shows the destination in a frame. Many sites refuse to be framed, so test it." />
          </div>
        )}

        {tab === "targeting" && (
          <div className="stack">
            <div>
              <div className="section-title">Rules</div>
              <p className="section-desc">Send visitors elsewhere by country, device, operating system or language. The first matching rule wins; everyone else goes to the destination.</p>
              <div className="stack-sm">
                {f.rules.map((r, i) => (
                  <div className="rule-row" key={i}>
                    <select
                      className="select"
                      value={r.type}
                      aria-label="Rule type"
                      onChange={(e) => set("rules", f.rules.map((x, j) => (j === i ? { ...x, type: e.target.value as Rule["type"] } : x)))}
                    >
                      <option value="country">Country</option>
                      <option value="device">Device</option>
                      <option value="os">OS</option>
                      <option value="language">Language</option>
                    </select>
                    <input
                      className="input mono"
                      placeholder={RULE_HINT[r.type]}
                      aria-label="Values"
                      value={r.values.join(", ")}
                      onChange={(e) =>
                        set(
                          "rules",
                          f.rules.map((x, j) => (j === i ? { ...x, values: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) } : x)),
                        )
                      }
                    />
                    <input
                      className="input mono"
                      placeholder="https://"
                      aria-label="Send to"
                      value={r.url}
                      onChange={(e) => set("rules", f.rules.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                    />
                    <button type="button" className="icon-btn" aria-label="Remove rule" onClick={() => set("rules", f.rules.filter((_, j) => j !== i))}>
                      <Trash2 className="icon" />
                    </button>
                  </div>
                ))}
                <div className="row">
                  <Button size="sm" icon={<Plus className="icon" />} onClick={() => set("rules", [...f.rules, { type: "country", values: [], url: "" }])}>
                    Add rule
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      set("rules", [...f.rules, { type: "os", values: ["ios", "ipados"], url: "" }, { type: "os", values: ["android"], url: "" }])
                    }
                  >
                    App store pair
                  </Button>
                </div>
              </div>
            </div>
            <hr className="divider" />
            <div>
              <div className="section-title">Split traffic</div>
              <p className="section-desc">A/B test destinations. The main destination receives what is left of 100%.</p>
              <div className="stack-sm">
                {f.variants.map((v, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 92px 30px", gap: 8 }}>
                    <input className="input mono" placeholder="https://" aria-label="Variant URL" value={v.url} onChange={(e) => set("variants", f.variants.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
                    <div className="input-group">
                      <input
                        className="input num"
                        type="number"
                        min={1}
                        max={100}
                        aria-label="Weight in percent"
                        value={v.weight}
                        onChange={(e) => set("variants", f.variants.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)))}
                      />
                      <span className="addon" style={{ paddingRight: 10 }}>%</span>
                    </div>
                    <button type="button" className="icon-btn" aria-label="Remove variant" onClick={() => set("variants", f.variants.filter((_, j) => j !== i))}>
                      <Trash2 className="icon" />
                    </button>
                  </div>
                ))}
                {f.variants.length > 0 && (
                  <p className={variantTotal > 100 ? "error" : "faint"} style={{ fontSize: 12.5, color: variantTotal > 100 ? "var(--ember)" : undefined }}>
                    Main destination: {Math.max(0, 100 - variantTotal)}% · variants: {variantTotal}%
                  </p>
                )}
                <div>
                  <Button size="sm" icon={<Shuffle className="icon" />} onClick={() => set("variants", [...f.variants, { url: "", weight: 50 }])} disabled={f.variants.length >= 10}>
                    Add variant
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "access" && (
          <div className="stack">
            <div className="grid-2">
              <Input label="Active from" type="datetime-local" value={f.starts_at} onChange={(e) => set("starts_at", e.target.value)} hint="Before this, the link answers 404." />
              <Input label="Expires at" type="datetime-local" value={f.expires_at} onChange={(e) => set("expires_at", e.target.value)} />
            </div>
            <div className="grid-2">
              <Input label="Click limit" type="number" min={1} value={f.max_clicks} onChange={(e) => set("max_clicks", e.target.value)} hint="Stops after this many visits." />
              <Input label="After expiry, send to" type="url" className="mono" placeholder="https://" value={f.expired_url} onChange={(e) => set("expired_url", e.target.value)} hint="Empty shows an expiry page." />
            </div>
            <hr className="divider" />
            {link?.has_password && !f.removePassword ? (
              <Callout>
                This link has a password.{" "}
                <button type="button" className="btn sm ghost" onClick={() => set("removePassword", true)}>
                  Remove it
                </button>{" "}
                or type a new one below to replace it.
              </Callout>
            ) : null}
            <Input
              label={link?.has_password ? "New password" : "Password"}
              type="password"
              autoComplete="new-password"
              value={f.password}
              onChange={(e) => set("password", e.target.value)}
              hint="Visitors must enter it before they are redirected."
            />
          </div>
        )}

        {tab === "preview" && (
          <div className="stack">
            <p className="section-desc" style={{ margin: 0 }}>
              What chat apps and social networks show when someone shares the short link. Leave empty to use the destination's own preview.
            </p>
            <Input label="Title" value={f.og_title} onChange={(e) => set("og_title", e.target.value)} />
            <Field label="Description">
              <textarea className="input" rows={2} value={f.og_description} onChange={(e) => set("og_description", e.target.value)} />
            </Field>
            <Input label="Image URL" type="url" className="mono" placeholder="https://…/card.png" value={f.og_image} onChange={(e) => set("og_image", e.target.value)} hint="1200 × 630 works everywhere." />
            {(f.og_title || f.og_image) && (
              <div className="panel" style={{ overflow: "hidden", maxWidth: 420 }}>
                {f.og_image && <img src={f.og_image} alt="" style={{ width: "100%", aspectRatio: "1.91", objectFit: "cover", display: "block", background: "var(--sunken)" }} />}
                <div style={{ padding: "10px 12px" }}>
                  <div className="faint" style={{ fontSize: 12 }}>{f.domain}</div>
                  <div style={{ fontWeight: 650 }}>{f.og_title}</div>
                  <div className="muted" style={{ fontSize: 13 }}>{f.og_description}</div>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "utm" && (
          <div className="stack">
            <p className="section-desc" style={{ margin: 0 }}>Added to the destination on every redirect. Parameters already in the destination URL win.</p>
            <div className="grid-2">
              {(["source", "medium", "campaign", "term", "content"] as const).map((k) => (
                <Input key={k} label={`utm_${k}`} className="mono" value={f.utm[k]} onChange={(e) => set("utm", { ...f.utm, [k]: e.target.value })} />
              ))}
            </div>
            {preview && (
              <Field label="Result">
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
