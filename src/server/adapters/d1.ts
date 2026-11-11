import { type Db, normalize, splitStatements } from "../db";

export function d1Adapter(d1: D1Database): Db {
  const prep = (sql: string, params?: Parameters<typeof normalize>[0]) =>
    d1.prepare(sql).bind(...normalize(params));
  return {
    async all(sql, params) {
      const r = await prep(sql, params).all();
      return r.results as never[];
    },
    async first(sql, params) {
      return ((await prep(sql, params).first()) ?? null) as never;
    },
    async run(sql, params) {
      const r = await prep(sql, params).run();
      return { changes: r.meta?.changes ?? 0 };
    },
    async batch(statements) {
      if (!statements.length) return;
      await d1.batch(statements.map((s) => prep(s.sql, s.params)));
    },
    async exec(sql) {
      const stmts = splitStatements(sql);
      if (stmts.length) await d1.batch(stmts.map((s) => d1.prepare(s)));
    },
  };
}
