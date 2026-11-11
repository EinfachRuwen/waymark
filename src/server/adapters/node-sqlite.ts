import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type Db, normalize } from "../db";

/** Local SQLite file via Node's built-in driver. No native modules to compile. */
export function nodeSqliteAdapter(file: string): Db {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  const cache = new Map<string, ReturnType<DatabaseSync["prepare"]>>();
  const stmt = (sql: string) => {
    let s = cache.get(sql);
    if (!s) {
      s = db.prepare(sql);
      if (cache.size > 500) cache.clear();
      cache.set(sql, s);
    }
    return s;
  };
  return {
    async all(sql, params) {
      return stmt(sql).all(...normalize(params)) as never[];
    },
    async first(sql, params) {
      return (stmt(sql).get(...normalize(params)) ?? null) as never;
    },
    async run(sql, params) {
      const r = stmt(sql).run(...normalize(params));
      return { changes: Number(r.changes) };
    },
    async batch(statements) {
      db.exec("BEGIN");
      try {
        for (const s of statements) stmt(s.sql).run(...normalize(s.params));
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    async exec(sql) {
      db.exec(sql);
    },
  };
}
