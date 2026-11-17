import { Bot, Unplug } from "lucide-react";
import { useState } from "react";
import { PageHead } from "../App";
import { Button, CopyButton, Empty, ErrorNote, Tabs, useConfirm, useToast } from "../components/ui";
import { api, type ApiKey } from "../lib/api";
import { ago, date } from "../lib/format";
import { useApi } from "../lib/hooks";
import { t } from "../lib/i18n";
import { Link } from "../lib/router";
import { useSession } from "../lib/session";

type Client = "claude" | "code" | "chatgpt" | "other";

const TOOL_LIST: [string, string][] = [
  ["create_link", "Shorten a URL, with slug, tags, expiry, password, UTM and routing rules"],
  ["create_links", "Shorten up to 200 URLs at once"],
  ["search_links", "Find links by text, tag, domain or status"],
  ["get_link", "Read every detail of one link"],
  ["update_link", "Change a destination, tags, expiry, rules or archive a link"],
  ["delete_link", "Delete a link (only with the delete permission)"],
  ["get_link_stats", "Clicks, countries, referrers and devices of one link"],
  ["get_overview_stats", "Clicks across all links and the most visited ones"],
  ["list_domains", "Short domains you can use"],
  ["list_tags", "All tags with their link counts"],
  ["check_slug", "Whether a custom slug is still free"],
];

export function Assistants() {
  const { me, isAdmin } = useSession();
  const { data, error, reload } = useApi<{ data: ApiKey[] }>("/api-keys");
  const [client, setClient] = useState<Client>("claude");
  const toast = useToast();
  const confirm = useConfirm();
  const url = `${location.origin}/mcp`;
  const apps = (data?.data ?? []).filter((k) => k.kind === "oauth" && !k.revoked_at);

  async function disconnect(k: ApiKey) {
    if (
      !(await confirm({
        title: t("Disconnect {app}?", { app: k.name }),
        body: t("The app loses access immediately. You can connect it again later."),
        confirm: t("Disconnect"),
        danger: true,
      }))
    )
      return;
    await api(`/api-keys/${k.id}`, { method: "DELETE" });
    toast(t("Disconnected"));
    void reload();
  }

  const claudeCode = `claude mcp add --transport http waymark ${url}`;
  const json = `{
  "mcpServers": {
    "waymark": {
      "url": "${url}",
      "headers": { "Authorization": "Bearer wm_…" }
    }
  }
}`;

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <PageHead
        title={t("AI assistants")}
        desc={t(
          "Connect Claude, ChatGPT, Cursor or any other MCP client. They can shorten links, find them and read statistics in your name, with only the permissions you allow.",
        )}
      />
      <div className="stack" style={{ gap: 18 }}>
        <section className="panel">
          <div className="panel-body stack">
            <div>
              <div className="section-title">{t("Your MCP address")}</div>
              <p className="section-desc" style={{ marginBottom: 8 }}>
                {t("Paste it into the app you want to connect. You approve the connection here, in Waymark.")}
              </p>
              <div className="secret">
                <code>{url}</code>
                <CopyButton text={url} iconOnly />
              </div>
            </div>
            <Tabs
              value={client}
              onChange={setClient}
              tabs={[
                { value: "claude", label: "Claude" },
                { value: "code", label: "Claude Code" },
                { value: "chatgpt", label: "ChatGPT" },
                { value: "other", label: t("Cursor & others") },
              ]}
            />
            {client === "claude" && (
              <ol className="muted" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
                <li>{t("In Claude (web, desktop or mobile), open Settings → Connectors and add a custom connector.")}</li>
                <li>{t("Name it Waymark and paste the address above.")}</li>
                <li>{t("Choose Connect. Claude opens Waymark; sign in if asked, pick the permissions and allow.")}</li>
                <li>{t("Ask Claude, for example: “Shorten https://example.com/spring as spring and tag it campaign.”")}</li>
              </ol>
            )}
            {client === "code" && (
              <div className="stack-sm">
                <p className="muted">
                  {t("Add the server once, then run /mcp inside Claude Code and choose to authenticate. Your browser opens Waymark to approve.")}
                </p>
                <div className="secret">
                  <code>{claudeCode}</code>
                  <CopyButton text={claudeCode} iconOnly />
                </div>
              </div>
            )}
            {client === "chatgpt" && (
              <ol className="muted" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
                <li>{t("In ChatGPT, add a custom connector (it may need developer mode, depending on your plan).")}</li>
                <li>{t("Paste the address above and choose OAuth as authentication.")}</li>
                <li>{t("ChatGPT opens Waymark; pick the permissions and allow.")}</li>
              </ol>
            )}
            {client === "other" && (
              <div className="stack-sm">
                <p className="muted">
                  {t("Clients that support OAuth only need the address. For clients that only take headers, create an")} <Link to="/keys">{t("API key")}</Link>{" "}
                  {t("and use it as a Bearer token:")}
                </p>
                <pre className="code">{json}</pre>
              </div>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>{t("Connected apps")}</h2>
          </div>
          {error && <ErrorNote error={error} retry={reload} />}
          <div className="list-rows" style={{ marginTop: 8 }}>
            {data && !apps.length && (
              <Empty title={t("No apps connected yet.")}>
                {t("Connections appear here after you allow them. Each app gets its own access that you can take back at any time.")}
              </Empty>
            )}
            {apps.map((k) => (
              <div className="list-row" key={k.id}>
                <Bot className="icon faint" />
                <div className="grow">
                  <div className="title">{k.name}</div>
                  <div className="sub">{k.scopes.join(", ")}</div>
                  <div className="sub">
                    {t("Connected {d} · used {ago}", { d: date(k.created_at), ago: ago(k.last_used_at) })}
                    {isAdmin && k.user_id !== me?.user.id ? t(" by {email}", { email: k.user_email }) : ""}
                  </div>
                </div>
                <Button size="sm" variant="danger" icon={<Unplug className="icon" />} onClick={() => void disconnect(k)}>
                  {t("Disconnect")}
                </Button>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>{t("What assistants can do")}</h2>
          </div>
          <div className="panel-body">
            <dl className="kv">
              {TOOL_LIST.map(([name, desc]) => (
                <div key={name} style={{ display: "contents" }}>
                  <dt>
                    <code style={{ color: "var(--ink)" }}>{name}</code>
                  </dt>
                  <dd className="muted">{t(desc)}</dd>
                </div>
              ))}
            </dl>
            <p className="faint" style={{ fontSize: 12.5, marginTop: 14 }}>
              {t(
                "Every action appears in the audit log with the app's name. An app never gets more rights than your role, and only the tools its permissions allow are offered.",
              )}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
