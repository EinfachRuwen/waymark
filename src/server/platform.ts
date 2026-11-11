import type { Db } from "./db";

export interface Geo {
  country?: string | null;
  region?: string | null;
  city?: string | null;
}

/** Everything the app needs from the runtime it is deployed on. */
export interface Platform {
  db: Db;
  /** Keeps background work (click logging, webhooks) alive after the response is sent. */
  waitUntil(p: Promise<unknown>): void;
  /** Serves a file of the built admin UI, or null when the runtime cannot. */
  asset(path: string, req: Request): Promise<Response | null>;
  clientIp(req: Request): string | null;
  geo(req: Request): Geo;
  env: {
    SETUP_TOKEN?: string;
    /** "1" while developing locally: relaxes the Secure cookie flag. */
    DEV?: string;
  };
}

/** Geo headers set by common edge networks, used when the runtime itself has no geo data. */
export function geoFromHeaders(h: Headers): Geo {
  const country =
    h.get("cf-ipcountry") || h.get("x-vercel-ip-country") || h.get("x-country-code") || h.get("cloudfront-viewer-country") || h.get("fly-client-country");
  const city = h.get("cf-ipcity") || h.get("x-vercel-ip-city") || h.get("cloudfront-viewer-city");
  const region = h.get("cf-region-code") || h.get("x-vercel-ip-country-region") || h.get("cloudfront-viewer-country-region");
  return {
    country: country && country !== "XX" && country !== "T1" ? country.toUpperCase() : null,
    city: city ? safeDecode(city) : null,
    region: region || null,
  };
}

export function ipFromHeaders(h: Headers): string | null {
  return (
    h.get("cf-connecting-ip") ||
    h.get("x-real-ip") ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    null
  );
}

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
