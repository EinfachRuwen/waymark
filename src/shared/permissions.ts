/**
 * Permissions are shared by user roles and API keys. An API key can never do
 * more than the user who created it: its effective scopes are the intersection
 * of the key's scopes and the creator's role.
 */
export const SCOPES = {
  "links:read": "List and read links",
  "links:write": "Create and edit links",
  "links:delete": "Delete links",
  "analytics:read": "Read click statistics",
  "domains:read": "List domains",
  "domains:write": "Add, edit and remove domains",
  "webhooks:write": "Manage webhooks",
  "users:read": "List team members",
  "users:write": "Invite, edit and remove team members",
  "audit:read": "Read the audit log",
} as const;

export type Scope = keyof typeof SCOPES;
export const ALL_SCOPES = Object.keys(SCOPES) as Scope[];

export type Role = "owner" | "admin" | "editor" | "viewer";

export const ROLE_INFO: Record<Role, { label: string; summary: string }> = {
  owner: { label: "Owner", summary: "Everything, including instance settings and other admins." },
  admin: { label: "Admin", summary: "Manages links, domains, team, keys and webhooks." },
  editor: { label: "Editor", summary: "Creates and edits links, reads analytics." },
  viewer: { label: "Viewer", summary: "Reads links and analytics. Changes nothing." },
};

export const ROLE_SCOPES: Record<Role, Scope[]> = {
  owner: ALL_SCOPES,
  admin: ALL_SCOPES,
  editor: ["links:read", "links:write", "links:delete", "analytics:read", "domains:read"],
  viewer: ["links:read", "analytics:read", "domains:read"],
};

/** Scopes that only make sense for people, never for keys (settings, keys, ownership). */
export const SESSION_ONLY = ["settings", "api-keys"] as const;

export const WEBHOOK_EVENTS = {
  "link.created": "A link was created",
  "link.updated": "A link was changed",
  "link.deleted": "A link was deleted",
  "link.clicked": "A link was opened (one call per human click)",
} as const;
export type WebhookEvent = keyof typeof WEBHOOK_EVENTS;
