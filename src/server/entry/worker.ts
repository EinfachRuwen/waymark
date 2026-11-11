import { createApp, housekeeping } from "../app";
import { d1Adapter } from "../adapters/d1";
import type { Platform } from "../platform";

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SETUP_TOKEN?: string;
}

const app = createApp((c) => {
  const env = c.env as Env;
  const ctx = c.executionCtx;
  const platform: Platform = {
    db: d1Adapter(env.DB),
    waitUntil: (p) => ctx.waitUntil(p),
    asset: (path, req) => env.ASSETS.fetch(new URL(path, req.url).toString()) as unknown as Promise<Response>,
    clientIp: (req) => req.headers.get("cf-connecting-ip"),
    geo: (req) => {
      const cf = (req as unknown as { cf?: IncomingRequestCfProperties }).cf;
      return { country: cf?.country ?? null, region: cf?.regionCode ?? null, city: cf?.city ?? null };
    },
    env: { SETUP_TOKEN: env.SETUP_TOKEN },
  };
  return platform;
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(housekeeping(d1Adapter(env.DB)));
  },
} satisfies ExportedHandler<Env>;
