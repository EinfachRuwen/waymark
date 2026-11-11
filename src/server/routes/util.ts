import type { z } from "zod";
import { HttpError } from "../errors";
import type { Ctx } from "../auth";

export async function body<T extends z.ZodType>(c: Ctx, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(400, "invalid_json", "The request body is not valid JSON.");
  }
  return parse(schema, raw);
}

export function parse<T extends z.ZodType>(schema: T, raw: unknown): z.infer<T> {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const first = r.error.issues[0];
    const where = first?.path?.length ? first.path.join(".") + ": " : "";
    throw new HttpError(422, "validation_failed", where + (first?.message ?? "Invalid input."), r.error.issues);
  }
  return r.data;
}

export function intParam(v: string | undefined, def: number, min: number, max: number) {
  const n = v === undefined ? def : Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function csvEscape(v: unknown) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
