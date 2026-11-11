import type { Client } from "@libsql/client";
import { type Db, normalize, splitStatements } from "../db";

/** Turso / libSQL over HTTP. Lets Waymark run on hosts without a persistent disk. */
export function libsqlAdapter(client: Client): Db {
  const toObj = (r: { columns: string[]; rows: ArrayLike<unknown>[] }) =>
    Array.from(r.rows, (row) => {
      const o: Record<string, unknown> = {};
      r.columns.forEach((c, i) => {
        const v = (row as unknown[])[i];
        o[c] = typeof v === "bigint" ? Number(v) : v;
      });
      return o;
    });
  return {
    async all(sql, params) {
      return toObj(await client.execute({ sql, args: normalize(params) })) as never[];
    },
    async first(sql, params) {
      return (toObj(await client.execute({ sql, args: normalize(params) }))[0] ?? null) as never;
    },
    async run(sql, params) {
      const r = await client.execute({ sql, args: normalize(params) });
      return { changes: r.rowsAffected };
    },
    async batch(statements) {
      if (!statements.length) return;
      await client.batch(
        statements.map((s) => ({ sql: s.sql, args: normalize(s.params) })),
        "write",
      );
    },
    async exec(sql) {
      await client.batch(
        splitStatements(sql).map((s) => ({ sql: s, args: [] })),
        "write",
      );
    },
  };
}
