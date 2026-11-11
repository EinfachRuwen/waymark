# Waymark API

Base URL: `https://<your-domain>/api/v1`. All bodies and responses are JSON.

## Authentication

Create a key in the app under **API keys** and send it as either header:

```
Authorization: Bearer wm_…
X-API-Key: wm_…
```

A key has scopes (below), may be limited to certain domains and may expire. Its effective permissions are the intersection of its scopes and the role of the person who created it. Keys cannot manage settings or other keys.

| Scope | Allows |
|---|---|
| `links:read` | list and read links, tags, QR codes, slug checks |
| `links:write` | create, edit, bulk-create, tag and archive links, run imports |
| `links:delete` | delete links, reset click history |
| `analytics:read` | statistics and click exports |
| `domains:read` / `domains:write` | list / manage domains |
| `webhooks:write` | manage webhooks |
| `users:read` / `users:write` | list / invite and manage team members |
| `audit:read` | read the audit log |

## Errors

```json
{ "error": { "code": "slug_taken", "message": "go.example.com/launch already exists." } }
```

Common statuses: `401` missing or invalid key, `403` missing scope, `404` not found, `409` conflict, `422` validation, `429` rate limit.

Timestamps are milliseconds since the Unix epoch. Inputs also accept ISO 8601 strings.

## Links

### Create

`POST /links` · `links:write`

```json
{
  "url": "https://example.com/spring",
  "slug": "spring",
  "domain": "go.example.com",
  "title": "Spring sale",
  "notes": "Printed on the flyer",
  "tags": ["campaign", "print"],
  "redirect_type": 302,
  "starts_at": "2026-03-01T08:00:00Z",
  "expires_at": "2026-06-01T00:00:00Z",
  "max_clicks": 5000,
  "expired_url": "https://example.com/sale-over",
  "password": "optional secret",
  "cloak": false,
  "forward_query": true,
  "utm": { "source": "flyer", "medium": "print", "campaign": "spring" },
  "rules": [
    { "type": "country", "values": ["DE", "AT", "CH"], "url": "https://example.com/de/spring" },
    { "type": "os", "values": ["ios", "ipados"], "url": "https://apps.apple.com/app/id1" },
    { "type": "device", "values": ["desktop"], "url": "https://example.com/spring?desktop" },
    { "type": "language", "values": ["fr"], "url": "https://example.com/fr/printemps" }
  ],
  "variants": [{ "url": "https://example.com/spring-b", "weight": 50 }],
  "og_title": "Spring sale: 20% off",
  "og_description": "Until June.",
  "og_image": "https://example.com/card.png",
  "external_id": "crm-1234",
  "reuse": false
}
```

Only `url` is required. Without `slug`, a random slug of the domain's configured length is created. Without `domain`, the default domain is used. With `reuse: true` and no slug, an existing active link to the same URL on that domain is returned (status 200) instead of creating a duplicate.

Rule values: `country` takes ISO 3166 codes, `device` takes `mobile`, `tablet`, `desktop`, `os` takes `ios`, `ipados`, `android`, `windows`, `macos`, `linux`, `chromeos`, `language` takes primary language codes such as `de`. The first matching rule wins. Variant weights are percentages; the main URL gets what is left of 100.

Response `201`: the link object.

```json
{
  "id": "lnk_…",
  "domain": "go.example.com",
  "slug": "spring",
  "short_url": "https://go.example.com/spring",
  "url": "https://example.com/spring",
  "status": "active",
  "has_password": true,
  "clicks": 0,
  "created_at": 1794379563712,
  "…": "all other fields from the request"
}
```

`status` is `active`, `scheduled`, `expired` or `archived`.

### List

`GET /links` · `links:read`

| Query | |
|---|---|
| `q` | search in slug, URL, title, notes |
| `domain` | hostname or id |
| `tag` | tag name |
| `status` | `active` (default), `expired`, `protected`, `archived`, `any` (all but archived), `all` |
| `url`, `external_id` | exact match |
| `sort` | `created`, `clicks`, `last_click`, `slug`, `updated` |
| `order` | `desc` (default) or `asc` |
| `limit`, `offset` | up to 200 per page |

Response: `{ "data": [link…], "total": 123, "limit": 50, "offset": 0 }`.

### Read, update, delete

- `GET /links/{id}` · `links:read`
- `PATCH /links/{id}` · `links:write`: send any subset of the create fields. `"password": null` removes a password. Changing `domain` or `slug` moves the link.
- `DELETE /links/{id}` · `links:delete`: also deletes its click history.

### Bulk

`POST /links/bulk` · `links:write`

```json
{ "links": [{ "url": "https://a.example", "slug": "a" }, { "url": "https://b.example" }], "domain": "go.example.com", "on_conflict": "skip" }
```

Up to 500 links. `on_conflict`: `skip` (default), `overwrite` or `fail`. Items may also carry `created_at` and `clicks` to preserve history from another service. Response: `{ created, updated, skipped, failed, errors: [{ index, slug, message }], data: [{ index, id, short_url }] }`.

`POST /links/actions` · `links:write` (`links:delete` for delete and reset)

```json
{ "ids": ["lnk_1", "lnk_2"], "action": "add_tags", "tags": ["q4"] }
```

Actions: `archive`, `unarchive`, `delete`, `add_tags`, `remove_tags`, `reset_clicks`.

### Helpers

- `GET /links/check-slug?domain=go.example.com&slug=spring` → `{ "available": false, "reason": "…" }`
- `GET /links/{id}/qr?fg=1c2a22&bg=ffffff` → SVG. Encodes `short_url?qr` so scans are counted as QR traffic; `track=0` omits it.
- `POST /links/{id}/check` → `{ ok, status, location, ms }` for the destination.

## Analytics

`GET /analytics` · `analytics:read`

| Query | |
|---|---|
| `link_id` | one link; otherwise all links you can see |
| `domain`, `tag` | narrow to a domain or tag |
| `from`, `to` | ms or ISO; default the last 30 days |
| `tz` | client offset in minutes east of UTC, for day buckets |
| `bots` | `1` includes bots |
| `limit` | rows per breakdown, default 10 |

Response: `totals { clicks, visitors, qr }`, `series [{ t, clicks, visitors }]` (hourly up to 2 days, daily beyond), `hourly` (24 numbers), and breakdowns `countries`, `cities`, `referrers`, `browsers`, `os`, `devices`, `languages`, `targets` as `[{ key, clicks }]`, plus `top_links` without `link_id`.

- `GET /analytics/clicks` raw events, newest first, paged with `before=<id>`.
- `GET /analytics/export.csv` events as CSV.

## Domains

- `GET /domains` · `domains:read`
- `POST /domains` · `domains:write` `{ hostname, is_default?, root_redirect?, not_found_redirect?, slug_length?, case_sensitive? }`
- `PATCH /domains/{id}`, `DELETE /domains/{id}` (only without links)

## Tags

- `GET /tags` → `[{ name, color, links }]`
- `PATCH /tags/{name}` `{ name?, color? }` renames across all links. Colors: `moss`, `blaze`, `sky`, `ember`, `slate`, `heather`.
- `DELETE /tags/{name}` removes it from all links.

## Team

- `GET /users` · `users:read`
- `POST /users` · `users:write` `{ email, name?, role }` → includes `invite_url` (valid 7 days)
- `PATCH /users/{id}` `{ name?, role?, disabled? }`
- `POST /users/{id}/invite` → new invite or password reset link
- `DELETE /users/{id}`

## Webhooks

`POST /webhooks` · `webhooks:write` `{ "url": "https://…", "events": ["link.created", "link.clicked"] }` returns the signing `secret`.

Each delivery is a `POST` with:

```
Content-Type: application/json
X-Waymark-Event: link.created
X-Waymark-Signature: sha256=<hex HMAC-SHA256 of the raw body with the secret>
```

```json
{ "event": "link.created", "created_at": "2026-11-11T08:00:00.000Z", "data": { "…": "the link object" } }
```

`link.clicked` carries `{ link_id, slug, country, device, referrer, qr, target }` and fires only for human visitors. Deliveries time out after 8 seconds; after 50 consecutive failures the webhook is paused. `POST /webhooks/{id}/test` sends a `ping`.

## Other

- `GET /me` the authenticated user or key owner, effective scopes and settings.
- `GET /audit` · `audit:read` with `before`, `action` (prefix like `link.`), `limit`.
- `GET /export/links.csv` · `links:read`.
- `POST /public/shorten` `{ "url": "…" }` without authentication, only when enabled in Settings; rate-limited per IP per hour.
- `GET /api/health` (outside `/v1`) for uptime monitors.

## CORS

Browser apps on other origins can call the API with a key once their origin is listed under Settings → Allowed browser origins. Session cookies are never accepted cross-origin.
