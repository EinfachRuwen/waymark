# Waymark for AI assistants (MCP)

Waymark has a built-in [Model Context Protocol](https://modelcontextprotocol.io) server. Claude, ChatGPT, Cursor and other MCP clients can shorten links, find them and read statistics with your account.

**Address:** `https://<your-domain>/mcp` (Streamable HTTP, stateless JSON). The admin app shows it under **AI assistants**.

## Connecting

- **OAuth (recommended):** paste the address into the client. It registers itself, opens Waymark, and you choose which permissions it gets. Each app shows up under *AI assistants → Connected apps* and can be disconnected at any time.
- **API key:** clients that only support headers send `Authorization: Bearer wm_…`. The key's scopes decide which tools are offered.

Examples: Claude → Settings → Connectors → add a custom connector. Claude Code: `claude mcp add --transport http waymark https://<your-domain>/mcp`, then `/mcp` to sign in.

## Tools

| Tool | Scope | |
|---|---|---|
| `create_link` | links:write | Shorten a URL with slug, tags, expiry, password, UTM, rules; `reuse` avoids duplicates |
| `create_links` | links:write | Up to 200 at once |
| `search_links` | links:read | By text, tag, domain, status, sorted |
| `get_link` | links:read | Full details; accepts id, short URL or domain/slug |
| `update_link` | links:write | Change fields or archive |
| `delete_link` | links:delete | Permanent delete (marked destructive) |
| `check_slug` | links:read | Is a slug free? |
| `get_link_stats` | analytics:read | Clicks and breakdowns for one link |
| `get_overview_stats` | analytics:read | Workspace totals and top links |
| `list_domains` | domains:read | Usable short domains |
| `list_tags` | links:read | Tags with counts |

Only tools the connection's scopes allow are listed. Every call goes through the normal API, so permissions, domain limits, the audit log and webhooks apply.

## OAuth details

- Metadata: `/.well-known/oauth-protected-resource` (RFC 9728) and `/.well-known/oauth-authorization-server` (RFC 8414).
- Dynamic client registration at `/oauth/register` (RFC 7591), rate-limited. Redirect URIs must be https, a custom app scheme, or http on localhost.
- Authorization code flow with PKCE S256 only. Codes are single-use and live 10 minutes.
- Access tokens live 1 hour; refresh tokens 90 days and rotate on every use. Revocation at `/oauth/revoke` or by disconnecting in the app.
- Tokens are stored only as SHA-256 hashes. An app never receives more rights than the approving person's role.
