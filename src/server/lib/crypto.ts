const enc = new TextEncoder();

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

export function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Unbiased random string from an alphabet. */
export function randomString(len: number, alphabet = B62): string {
  const out: string[] = [];
  const max = 256 - (256 % alphabet.length);
  while (out.length < len) {
    for (const b of randomBytes(len * 2)) {
      if (b < max) out.push(alphabet[b % alphabet.length]);
      if (out.length === len) break;
    }
  }
  return out.join("");
}

/** Short id: time prefix + randomness. */
export function newId(prefix = ""): string {
  return prefix + Date.now().toString(36) + randomString(10).toLowerCase();
}

export async function sha256(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

export async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/**
 * PBKDF2-SHA256. The iteration count is stored with the hash so it can be raised
 * later without invalidating existing passwords. 60k keeps a login inside the
 * CPU budget of the Cloudflare free plan; login attempts are throttled.
 */
const ITERATIONS = 60_000;

export async function hashPassword(password: string, iterations = ITERATIONS): Promise<string> {
  const salt = randomBytes(16);
  const bits = await derive(password, salt, iterations);
  return `pbkdf2$${iterations}$${toHex(salt)}$${toHex(bits)}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [scheme, iter, saltHex, hashHex] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !saltHex || !hashHex) return false;
  const bits = await derive(password, fromHex(saltHex), Number(iter));
  return timingSafeEqual(toHex(bits), hashHex);
}

async function derive(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, 256);
}
