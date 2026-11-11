import { Plus, Send, Trash2, Webhook } from "lucide-react";
import { useState, type FormEvent } from "react";
import { WEBHOOK_EVENTS, type WebhookEvent } from "../../shared/permissions";
import { PageHead } from "../App";
import { Button, CopyButton, Dialog, Empty, ErrorNote, Field, Input, Switch, useConfirm, useToast } from "../components/ui";
import { api, type Webhook as Hook } from "../lib/api";
import { ago } from "../lib/format";
import { useApi } from "../lib/hooks";
import { t } from "../lib/i18n";

export function Webhooks() {
  const { data, error, reload } = useApi<{ data: Hook[] }>("/webhooks");
  const [creating, setCreating] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const toast = useToast();
  const confirm = useConfirm();

  async function test(h: Hook) {
    const r = await api<{ ok: boolean; status: number }>(`/webhooks/${h.id}/test`, { method: "POST", body: {} });
    toast(
      r.ok
        ? t("Delivered, endpoint answered {s}", { s: r.status })
        : r.status
          ? t("Endpoint answered {s}", { s: r.status })
          : t("Could not reach the endpoint"),
      r.ok ? "ok" : "error",
    );
    void reload();
  }
  async function toggle(h: Hook) {
    await api(`/webhooks/${h.id}`, { method: "PATCH", body: { active: !h.active } });
    void reload();
  }
  async function remove(h: Hook) {
    if (!(await confirm({ title: t("Delete this webhook?"), body: h.url, confirm: t("Delete"), danger: true }))) return;
    await api(`/webhooks/${h.id}`, { method: "DELETE" });
    void reload();
  }

  return (
    <div className="page">
      <PageHead
        title={t("Webhooks")}
        desc={t("Waymark POSTs signed JSON to these URLs when links change or get clicked. Verify the X-Waymark-Signature header with the secret.")}
        actions={
          <Button variant="primary" icon={<Plus className="icon" />} onClick={() => setCreating(true)}>
            {t("Add webhook")}
          </Button>
        }
      />
      {error && <ErrorNote error={error} retry={reload} />}
      <div className="panel list-rows">
        {data && !data.data.length && (
          <Empty sign={t("POST")} title={t("No webhooks yet.")}>
            {t("Connect Slack, a spreadsheet, n8n or your own backend to link events.")}
          </Empty>
        )}
        {data?.data.map((h) => (
          <div className="list-row" key={h.id} style={{ alignItems: "flex-start" }}>
            <Webhook className="icon faint" style={{ marginTop: 3 }} />
            <div className="grow">
              <div className="title mono" style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis" }}>
                {h.url}
              </div>
              <div className="sub">{h.events.join(", ")}</div>
              <div className="sub">
                {h.last_delivery_at
                  ? t("Last delivery {ago}: {s}", { ago: ago(h.last_delivery_at), s: h.last_status || t("no answer") })
                  : t("Not delivered yet")}
                {h.failures > 0 && <span style={{ color: "var(--ember)" }}> · {t("{n} failed in a row", { n: h.failures })}</span>}
                {!h.active && ` · ${t("paused")}`}
              </div>
              {shown === h.id ? (
                <div className="secret" style={{ marginTop: 8 }}>
                  <code>{h.secret}</code>
                  <CopyButton text={h.secret} iconOnly />
                </div>
              ) : (
                <button className="btn sm ghost" style={{ marginTop: 4, paddingLeft: 0 }} onClick={() => setShown(h.id)}>
                  {t("Show signing secret")}
                </button>
              )}
            </div>
            <div className="row" style={{ gap: 4 }}>
              <Switch checked={h.active} onChange={() => void toggle(h)} label={<span className="sr-only">{t("Active")}</span>} />
              <Button size="sm" icon={<Send className="icon" />} onClick={() => void test(h)}>
                {t("Test")}
              </Button>
              <Button size="sm" variant="ghost" icon={<Trash2 className="icon" />} aria-label={t("Delete")} onClick={() => void remove(h)} />
            </div>
          </div>
        ))}
      </div>

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h2>{t("Verifying deliveries")}</h2>
        </div>
        <div className="panel-body">
          <pre className="code">{`// Node.js
import { createHmac, timingSafeEqual } from "node:crypto";
import { t } from "../lib/i18n";
const expected = "sha256=" + createHmac("sha256", SECRET).update(rawBody).digest("hex");
const ok = timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers["x-waymark-signature"]));`}</pre>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
            {t("After 50 failed deliveries in a row a webhook is paused automatically.")}
          </p>
        </div>
      </section>
      {creating && (
        <CreateHook
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}

function CreateHook({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<Set<WebhookEvent>>(new Set(["link.created", "link.updated", "link.deleted"]));
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/webhooks", { body: { url, events: [...events] } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Dialog
      title={t("Add a webhook")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button type="submit" form="hook-form" variant="dark" disabled={!events.size}>
            {t("Add")}
          </Button>
        </>
      }
    >
      <form id="hook-form" onSubmit={submit} className="stack" style={{ paddingTop: 12 }}>
        <Input
          label={t("Endpoint URL")}
          type="url"
          required
          className="mono"
          placeholder="https://hooks.example.com/waymark"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoFocus
        />
        <Field label={t("Events")}>
          <div className="stack-sm">
            {(Object.keys(WEBHOOK_EVENTS) as WebhookEvent[]).map((ev) => (
              <label key={ev} className="check">
                <input
                  type="checkbox"
                  className="box"
                  checked={events.has(ev)}
                  onChange={() =>
                    setEvents((x) => {
                      const n = new Set(x);
                      if (n.has(ev)) n.delete(ev);
                      else n.add(ev);
                      return n;
                    })
                  }
                />
                <span>
                  <code style={{ fontSize: 12.5 }}>{ev}</code> <span className="muted">— {t(WEBHOOK_EVENTS[ev])}</span>
                </span>
              </label>
            ))}
          </div>
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
