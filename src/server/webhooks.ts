import type { WebhookEvent } from "../shared/permissions";
import type { Db } from "./db";
import { hmac } from "./lib/crypto";

interface HookRow {
  id: string;
  url: string;
  secret: string;
  events: string;
}

let cache: { at: number; rows: HookRow[] } | null = null;

export function invalidateWebhooks() {
  cache = null;
}

async function activeHooks(db: Db) {
  if (cache && Date.now() - cache.at < 30_000) return cache.rows;
  const rows = await db.all<HookRow>("SELECT id, url, secret, events FROM webhooks WHERE active = 1");
  cache = { at: Date.now(), rows };
  return rows;
}

/** Sends a signed JSON POST to every active webhook subscribed to the event. */
export async function emit(db: Db, event: WebhookEvent, data: unknown) {
  const hooks = (await activeHooks(db)).filter((h) => (JSON.parse(h.events) as string[]).includes(event));
  await Promise.all(hooks.map((h) => deliver(db, h, event, data)));
}

export async function deliver(db: Db, h: HookRow, event: string, data: unknown) {
  const body = JSON.stringify({ event, created_at: new Date().toISOString(), data });
  let status = 0;
  try {
    const res = await fetch(h.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Waymark-Webhook/1",
        "x-waymark-event": event,
        "x-waymark-signature": "sha256=" + (await hmac(h.secret, body)),
      },
      body,
      signal: AbortSignal.timeout(8000),
    });
    status = res.status;
  } catch {
    status = 0;
  }
  const ok = status >= 200 && status < 300;
  await db
    .run(
      `UPDATE webhooks SET last_status = ?, last_delivery_at = ?, failures = ${ok ? "0" : "failures + 1"},
       active = CASE WHEN ? = 0 AND failures + 1 >= 50 THEN 0 ELSE active END WHERE id = ?`,
      [status, Date.now(), ok ? 1 : 0, h.id],
    )
    .catch(() => {});
  return status;
}
