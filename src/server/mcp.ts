/**
 * Model Context Protocol endpoint (Streamable HTTP, stateless JSON responses).
 *
 * Every tool call is forwarded to Waymark's own REST API with the caller's
 * token, so validation, permissions, domain limits, the audit log and webhooks
 * behave exactly as they do for the app and for API keys.
 */
import type { Scope } from "../shared/permissions";
import type { Ctx } from "./auth";
import { originOf } from "./oauth";

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const VERSION = "1.1.0";

type Json = Record<string, unknown>;
type Call = (method: string, path: string, body?: unknown) => Promise<{ status: number; data: any }>;

interface Tool {
  name: string;
  title: string;
  description: string;
  scope: Scope;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  inputSchema: Json;
  run: (args: any, call: Call) => Promise<unknown>;
}

const RANGES: Record<string, number> = { "24h": 864e5, "7d": 7 * 864e5, "30d": 30 * 864e5, "90d": 90 * 864e5, "365d": 365 * 864e5 };

const linkRef = {
  link: { type: "string", description: "The link's id (lnk_…), its short URL, or domain/slug." },
};

const linkFields = {
  url: { type: "string", description: "Destination URL." },
  slug: { type: "string", description: "Custom path after the domain. Omit for a random one." },
  domain: { type: "string", description: "Short domain hostname. Omit for the default domain." },
  title: { type: "string" },
  notes: { type: "string" },
  tags: { type: "array", items: { type: "string" } },
  expires_at: { type: "string", description: "ISO 8601 date-time after which the link stops working." },
  starts_at: { type: "string", description: "ISO 8601 date-time before which the link answers 404." },
  max_clicks: { type: "integer", minimum: 1 },
  expired_url: { type: "string", description: "Where to send visitors after expiry." },
  password: { type: "string", description: "Visitors must enter it before the redirect." },
  redirect_type: { type: "integer", enum: [301, 302, 307, 308] },
  utm: {
    type: "object",
    properties: { source: { type: "string" }, medium: { type: "string" }, campaign: { type: "string" }, term: { type: "string" }, content: { type: "string" } },
  },
  rules: {
    type: "array",
    description: "Routing rules; the first match wins.",
    items: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["country", "device", "os", "language"] },
        values: { type: "array", items: { type: "string" }, description: 'e.g. ["DE","AT"], ["mobile"], ["ios","ipados"], ["de"]' },
        url: { type: "string" },
      },
      required: ["type", "values", "url"],
    },
  },
  og_title: { type: "string", description: "Title shown in social and chat previews." },
  og_description: { type: "string" },
  og_image: { type: "string" },
};

/** Accepts an id, a short URL or "domain/slug" and returns the link id. */
async function resolveLinkId(ref: string, call: Call): Promise<string> {
  const r = String(ref || "").trim();
  if (!r) throw new Error("Give the link as an id, a short URL or domain/slug.");
  if (/^lnk_[a-z0-9]+$/i.test(r)) return r;
  let host = "";
  let slug = r;
  try {
    const u = new URL(r.includes("://") ? r : `https://${r}`);
    if (u.hostname.includes(".") || u.hostname === "localhost") {
      host = u.host;
      slug = decodeURIComponent(u.pathname.replace(/^\/+|\/+$/g, ""));
    }
  } catch {
    /* treat as slug */
  }
  const qs = new URLSearchParams({ q: slug, status: "all", limit: "50" });
  if (host) qs.set("domain", host);
  const res = await call("GET", `/api/v1/links?${qs}`);
  const match = (res.data?.data ?? []).find((l: Json) => String(l.slug).toLowerCase() === slug.toLowerCase());
  if (!match) throw new Error(`No link found for "${r}".`);
  return String(match.id);
}

function compactLink(l: Json) {
  const keep = [
    "id",
    "short_url",
    "url",
    "title",
    "tags",
    "status",
    "clicks",
    "last_click_at",
    "created_at",
    "expires_at",
    "max_clicks",
    "has_password",
    "rules",
    "variants",
    "utm",
    "notes",
  ];
  const out: Json = {};
  for (const k of keep) {
    const v = l[k];
    if (v === null || v === undefined || (Array.isArray(v) && !v.length)) continue;
    out[k] = typeof v === "number" && k.endsWith("_at") ? new Date(v).toISOString() : v;
  }
  return out;
}

function summarizeStats(a: Json) {
  const top = (k: string) => ((a[k] as { key: string | null; clicks: number }[]) || []).map((x) => ({ [String(x.key ?? "unknown")]: x.clicks }));
  const series = (a.series as { t: number; clicks: number; visitors: number }[]) || [];
  return {
    period: { from: new Date(a.from as number).toISOString(), to: new Date(a.to as number).toISOString(), bucket: a.bucket },
    totals: a.totals,
    series: series.map((s) => [new Date(s.t).toISOString().slice(0, a.bucket === "hour" ? 13 : 10), s.clicks]),
    countries: top("countries"),
    referrers: top("referrers"),
    devices: top("devices"),
    os: top("os"),
    browsers: top("browsers"),
    languages: top("languages"),
    routes: top("targets"),
    ...(Array.isArray(a.top_links) && a.top_links.length
      ? { top_links: (a.top_links as Json[]).map((t) => ({ short_url: t.short_url, title: t.title, clicks: t.clicks })) }
      : {}),
  };
}

async function stats(args: { link?: string; range?: string; tag?: string; domain?: string }, call: Call) {
  const span = RANGES[args.range || "30d"] ?? RANGES["30d"];
  const to = Date.now();
  const qs = new URLSearchParams({ from: String(to - span), to: String(to), limit: "8" });
  if (args.link) qs.set("link_id", await resolveLinkId(args.link, call));
  if (args.tag) qs.set("tag", args.tag);
  if (args.domain) qs.set("domain", args.domain);
  const r = await call("GET", `/api/v1/analytics?${qs}`);
  return summarizeStats(r.data);
}

const rangeProp = { type: "string", enum: Object.keys(RANGES), description: "Time range, default 30d." };

export const TOOLS: Tool[] = [
  {
    name: "create_link",
    title: "Create short link",
    description:
      "Create a short link. Returns the short URL. Set reuse=true to get an existing link to the same URL instead of a duplicate. Supports custom slugs, tags, expiry, click limits, passwords, UTM parameters, social previews and routing rules by country, device, OS or language.",
    scope: "links:write",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: { type: "object", properties: { ...linkFields, reuse: { type: "boolean" } }, required: ["url"] },
    run: async (args, call) => compactLink((await call("POST", "/api/v1/links", args)).data),
  },
  {
    name: "create_links",
    title: "Create many short links",
    description: "Create up to 200 short links at once. Existing slugs are skipped. Returns the short URLs and any errors.",
    scope: "links:write",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        links: { type: "array", maxItems: 200, items: { type: "object", properties: linkFields, required: ["url"] } },
        domain: { type: "string" },
      },
      required: ["links"],
    },
    run: async (args, call) => {
      const r = (await call("POST", "/api/v1/links/bulk", { links: args.links, domain: args.domain, on_conflict: "skip", source: "mcp" })).data;
      return { created: r.created, skipped: r.skipped, failed: r.failed, links: r.data, errors: r.errors };
    },
  },
  {
    name: "search_links",
    title: "Find links",
    description: "List or search links by text (slug, destination, title, notes), tag, domain or status. Sort by created, clicks or last_click.",
    scope: "links:read",
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        tag: { type: "string" },
        domain: { type: "string" },
        status: { type: "string", enum: ["active", "expired", "protected", "archived", "any", "all"] },
        sort: { type: "string", enum: ["created", "clicks", "last_click", "slug", "updated"] },
        order: { type: "string", enum: ["desc", "asc"] },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        offset: { type: "integer", minimum: 0 },
      },
    },
    run: async (args, call) => {
      const qs = new URLSearchParams();
      if (args.query) qs.set("q", args.query);
      for (const k of ["tag", "domain", "status", "sort", "order"]) if (args[k]) qs.set(k, args[k]);
      qs.set("limit", String(args.limit ?? 25));
      if (args.offset) qs.set("offset", String(args.offset));
      const r = (await call("GET", `/api/v1/links?${qs}`)).data;
      return { total: r.total, links: (r.data as Json[]).map(compactLink) };
    },
  },
  {
    name: "get_link",
    title: "Get link details",
    description: "Full details of one link, by id, short URL or domain/slug.",
    scope: "links:read",
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: { type: "object", properties: linkRef, required: ["link"] },
    run: async (args, call) => (await call("GET", `/api/v1/links/${await resolveLinkId(args.link, call)}`)).data,
  },
  {
    name: "update_link",
    title: "Update link",
    description: "Change any field of a link: destination, slug, tags, expiry, password (null removes it), rules, UTM, preview. Only the given fields change.",
    scope: "links:write",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: { ...linkRef, ...linkFields, archived: { type: "boolean", description: "true archives the link (it then answers 404)." } },
      required: ["link"],
    },
    run: async (args, call) => {
      const { link, ...patch } = args;
      return compactLink((await call("PATCH", `/api/v1/links/${await resolveLinkId(link, call)}`, patch)).data);
    },
  },
  {
    name: "delete_link",
    title: "Delete link",
    description: "Permanently delete a link and its click history. Prefer update_link with archived=true when the link may be needed again.",
    scope: "links:delete",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: "object", properties: linkRef, required: ["link"] },
    run: async (args, call) => {
      const id = await resolveLinkId(args.link, call);
      await call("DELETE", `/api/v1/links/${id}`);
      return { deleted: id };
    },
  },
  {
    name: "check_slug",
    title: "Check slug",
    description: "Check whether a custom slug is still free on a domain.",
    scope: "links:read",
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: { type: "object", properties: { slug: { type: "string" }, domain: { type: "string" } }, required: ["slug"] },
    run: async (args, call) => {
      const qs = new URLSearchParams({ slug: args.slug });
      if (args.domain) qs.set("domain", args.domain);
      return (await call("GET", `/api/v1/links/check-slug?${qs}`)).data;
    },
  },
  {
    name: "get_link_stats",
    title: "Link statistics",
    description:
      "Clicks, unique visitors, QR scans and breakdowns (countries, referrers, devices, OS, browsers, languages, routes taken) for one link over a time range.",
    scope: "analytics:read",
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: { type: "object", properties: { ...linkRef, range: rangeProp }, required: ["link"] },
    run: (args, call) => stats(args, call),
  },
  {
    name: "get_overview_stats",
    title: "Workspace statistics",
    description: "Clicks across all links (optionally one tag or domain) with the most visited links and breakdowns over a time range.",
    scope: "analytics:read",
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: { type: "object", properties: { range: rangeProp, tag: { type: "string" }, domain: { type: "string" } } },
    run: (args, call) => stats(args, call),
  },
  {
    name: "list_domains",
    title: "List domains",
    description: "Short domains available for new links, with the default domain and link counts.",
    scope: "domains:read",
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: { type: "object", properties: {} },
    run: async (_a, call) =>
      ((await call("GET", "/api/v1/domains")).data.data as Json[]).map((d) => ({ hostname: d.hostname, default: d.is_default, links: d.links })),
  },
  {
    name: "list_tags",
    title: "List tags",
    description: "All tags with the number of links using them.",
    scope: "links:read",
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: { type: "object", properties: {} },
    run: async (_a, call) => ((await call("GET", "/api/v1/tags")).data.data as Json[]).map((t) => ({ name: t.name, links: t.links })),
  },
];

const INSTRUCTIONS =
  "Waymark is the user's private link shortener. Use create_link to shorten URLs (reuse=true avoids duplicates), search_links to find existing ones, " +
  "get_link_stats or get_overview_stats for clicks. Links can be referenced by short URL. Short URLs are public: never put secrets in slugs or titles. " +
  "Ask before deleting; archiving with update_link is reversible.";

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

/** Handles POST /mcp. `internal` performs an in-process request against the app. */
export async function handleMcp(c: Ctx, internal: (req: Request) => Promise<Response>): Promise<Response> {
  const origin = originOf(c);
  const auth = c.req.header("authorization") || "";
  const cors = { "access-control-allow-origin": "*", "access-control-expose-headers": "www-authenticate, mcp-session-id" };
  const unauthorized = (msg: string) =>
    c.json(rpcError(null, -32001, msg), 401, {
      ...cors,
      "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", error="invalid_token"`,
    });

  if (!/^bearer\s+\S+/i.test(auth)) return unauthorized("Sign in: connect this app to Waymark (OAuth) or send an API key as a Bearer token.");

  const call: Call = async (method, path, body) => {
    const res = await internal(
      new Request(origin + path, {
        method,
        headers: { authorization: auth, "content-type": "application/json", "user-agent": "Waymark-MCP" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const data = await res.json().catch(() => null);
    if (res.status >= 400) {
      const err = new Error((data as any)?.error?.message || `Request failed (${res.status}).`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return { status: res.status, data };
  };

  let me: { scopes: Scope[]; user: { email: string; name: string; role: string }; settings: { instance_name: string } };
  try {
    me = (await call("GET", "/api/v1/me")).data;
  } catch (e) {
    if ((e as { status?: number }).status === 401) return unauthorized("The token is invalid or expired.");
    throw e;
  }
  const allowed = TOOLS.filter((t) => me.scopes.includes(t.scope));

  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json(rpcError(null, -32700, "Parse error"), 400, cors);
  }

  const handle = async (msg: Json): Promise<Json | null> => {
    const id = msg.id;
    const isNotification = id === undefined;
    const method = String(msg.method || "");
    const params = (msg.params || {}) as Json;
    if (msg.jsonrpc !== "2.0" || !method) return isNotification ? null : rpcError(id, -32600, "Invalid request");
    if (isNotification) return null;

    switch (method) {
      case "initialize": {
        const asked = String(params.protocolVersion || "");
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "waymark", title: me.settings.instance_name || "Waymark", version: VERSION },
            instructions: INSTRUCTIONS,
          },
        };
      }
      case "ping":
        return { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: allowed.map((t) => ({
              name: t.name,
              title: t.title,
              description: t.description,
              inputSchema: t.inputSchema,
              annotations: { title: t.title, ...t.annotations },
            })),
          },
        };
      case "tools/call": {
        const tool = TOOLS.find((t) => t.name === params.name);
        if (!tool) return rpcError(id, -32602, `Unknown tool: ${String(params.name)}`);
        if (!me.scopes.includes(tool.scope)) {
          return {
            jsonrpc: "2.0",
            id,
            result: {
              isError: true,
              content: [
                {
                  type: "text",
                  text: `This connection is not allowed to ${tool.title.toLowerCase()} (needs ${tool.scope}). Reconnect the app and grant that permission.`,
                },
              ],
            },
          };
        }
        try {
          const out = await tool.run((params.arguments as Json) || {}, call);
          const structured = Array.isArray(out) ? { items: out } : (out as Json);
          return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(out, null, 1) }], structuredContent: structured } };
        } catch (e) {
          return { jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: (e as Error).message }] } };
        }
      }
      case "resources/list":
        return { jsonrpc: "2.0", id, result: { resources: [] } };
      case "prompts/list":
        return { jsonrpc: "2.0", id, result: { prompts: [] } };
      default:
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  };

  if (Array.isArray(payload)) {
    const out = (await Promise.all(payload.map((m) => handle(m as Json)))).filter(Boolean);
    return out.length ? c.json(out, 200, cors) : c.body(null, 202, cors);
  }
  const out = await handle(payload as Json);
  return out ? c.json(out, 200, cors) : c.body(null, 202, cors);
}
