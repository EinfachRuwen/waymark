/**
 * A tiny SQL interface every storage backend implements.
 * All backends speak SQLite: Cloudflare D1, node:sqlite, libSQL/Turso.
 */
export type SqlValue = string | number | null;
export type Params = ReadonlyArray<SqlValue | boolean | undefined>;

export interface Statement {
  sql: string;
  params?: Params;
}

export interface Db {
  all<T = Record<string, unknown>>(sql: string, params?: Params): Promise<T[]>;
  first<T = Record<string, unknown>>(sql: string, params?: Params): Promise<T | null>;
  run(sql: string, params?: Params): Promise<{ changes: number }>;
  /** Runs statements atomically, in order. */
  batch(statements: Statement[]): Promise<void>;
  /** Runs a script of several statements (used by migrations). */
  exec(sql: string): Promise<void>;
}

export function normalize(params: Params = []): SqlValue[] {
  return params.map((p) => (p === undefined ? null : typeof p === "boolean" ? (p ? 1 : 0) : p));
}

/** Splits a migration script into statements. Our migrations contain no triggers. */
export function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
}
