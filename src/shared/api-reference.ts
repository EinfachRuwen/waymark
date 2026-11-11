/** The public API surface, used by the in-app reference. Keep in sync with docs/API.md. */
export interface Endpoint {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  scope: string | null;
  summary: string;
  body?: string;
  example?: string;
}

export const API_GROUPS: { title: string; intro?: string; endpoints: Endpoint[] }[] = [
  {
    title: "Links",
    endpoints: [
      {
        method: "POST",
        path: "/api/v1/links",
        scope: "links:write",
        summary:
          "Create a link. Without slug a random one is generated. reuse: true returns an existing link with the same destination instead of creating a duplicate.",
        body: `{
  "url": "https://example.com/spring-sale",
  "slug": "spring",            // optional
  "domain": "go.example.com",  // optional, default domain otherwise
  "title": "Spring sale",
  "tags": ["campaign"],
  "expires_at": "2026-12-31T23:00:00Z",
  "max_clicks": 1000,
  "password": "optional",
  "utm": { "source": "newsletter", "medium": "email" },
  "rules": [{ "type": "country", "values": ["DE","AT"], "url": "https://example.de" }],
  "variants": [{ "url": "https://example.com/b", "weight": 50 }],
  "reuse": false
}`,
      },
      {
        method: "GET",
        path: "/api/v1/links",
        scope: "links:read",
        summary:
          "List links. Query: q, domain, tag, status (active|expired|archived|protected|all), url, external_id, sort (created|clicks|last_click|slug|updated), order, limit (≤200), offset.",
      },
      { method: "GET", path: "/api/v1/links/{id}", scope: "links:read", summary: "Read one link." },
      { method: "PATCH", path: "/api/v1/links/{id}", scope: "links:write", summary: "Change any field of a link. Send password: null to remove a password." },
      { method: "DELETE", path: "/api/v1/links/{id}", scope: "links:delete", summary: "Delete a link and its click history." },
      {
        method: "POST",
        path: "/api/v1/links/bulk",
        scope: "links:write",
        summary: "Create up to 500 links in one call.",
        body: `{ "links": [{ "url": "…", "slug": "…" }], "on_conflict": "skip" }`,
      },
      {
        method: "POST",
        path: "/api/v1/links/actions",
        scope: "links:write",
        summary: "Archive, unarchive, delete, add_tags, remove_tags or reset_clicks for many links.",
        body: `{ "ids": ["lnk_…"], "action": "add_tags", "tags": ["q4"] }`,
      },
      { method: "GET", path: "/api/v1/links/check-slug", scope: "links:read", summary: "Is a slug free? Query: domain, slug." },
      { method: "GET", path: "/api/v1/links/{id}/qr", scope: "links:read", summary: "QR code as SVG. Query: fg, bg (hex without #), track=0 to omit ?qr." },
    ],
  },
  {
    title: "Analytics",
    endpoints: [
      {
        method: "GET",
        path: "/api/v1/analytics",
        scope: "analytics:read",
        summary: "Totals, time series and breakdowns. Query: link_id, domain, tag, from, to (ms or ISO), tz (minutes east of UTC), bots=1, limit.",
      },
      {
        method: "GET",
        path: "/api/v1/analytics/clicks",
        scope: "analytics:read",
        summary: "Raw click events, newest first. Query like above plus before (cursor) and limit (≤500).",
      },
      { method: "GET", path: "/api/v1/analytics/export.csv", scope: "analytics:read", summary: "Click events as CSV." },
    ],
  },
  {
    title: "Domains, tags, team",
    endpoints: [
      { method: "GET", path: "/api/v1/domains", scope: "domains:read", summary: "List domains with link counts." },
      {
        method: "POST",
        path: "/api/v1/domains",
        scope: "domains:write",
        summary: "Add a domain.",
        body: `{ "hostname": "go.example.com", "root_redirect": "https://example.com" }`,
      },
      { method: "PATCH", path: "/api/v1/domains/{id}", scope: "domains:write", summary: "Edit a domain." },
      { method: "DELETE", path: "/api/v1/domains/{id}", scope: "domains:write", summary: "Remove a domain without links." },
      { method: "GET", path: "/api/v1/tags", scope: "links:read", summary: "List tags with link counts." },
      { method: "GET", path: "/api/v1/users", scope: "users:read", summary: "List team members." },
      {
        method: "POST",
        path: "/api/v1/users",
        scope: "users:write",
        summary: "Invite someone; returns invite_url.",
        body: `{ "email": "sam@example.com", "role": "editor" }`,
      },
      { method: "GET", path: "/api/v1/audit", scope: "audit:read", summary: "Audit log, newest first. Query: before, action, limit." },
    ],
  },
  {
    title: "Webhooks & misc",
    endpoints: [
      {
        method: "POST",
        path: "/api/v1/webhooks",
        scope: "webhooks:write",
        summary: "Subscribe a URL to link.created, link.updated, link.deleted, link.clicked.",
      },
      { method: "GET", path: "/api/v1/me", scope: null, summary: "Who am I: the key's owner, its effective scopes and instance settings." },
      {
        method: "POST",
        path: "/api/v1/public/shorten",
        scope: null,
        summary: "Anonymous shortening, only when enabled in Settings. Rate-limited per IP.",
        body: `{ "url": "https://example.com" }`,
      },
      { method: "GET", path: "/api/health", scope: null, summary: "Liveness check for monitors." },
    ],
  },
];
