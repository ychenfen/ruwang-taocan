import fs from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

export type DbKind = "pg" | "pglite";

export type DbQueryResult<T> = Readonly<{
  rows: T[];
  rowCount: number;
}>;

export type Db = Readonly<{
  kind: DbKind;
  query<T>(text: string, params?: any[]): Promise<DbQueryResult<T>>;
  // Execute SQL that may contain multiple statements. Intended for migrations/DDL.
  exec(text: string): Promise<void>;
  close(): Promise<void>;
}>;

export async function createDb(opts: { databaseUrl?: string; pglitePath: string }): Promise<Db> {
  if (opts.databaseUrl && opts.databaseUrl.length > 0) {
    const pool = new pg.Pool({ connectionString: opts.databaseUrl });
    return {
      kind: "pg",
      async query<T>(text: string, params?: any[]) {
        const r = await pool.query(text, params);
        return { rows: r.rows as T[], rowCount: r.rowCount ?? r.rows.length };
      },
      async exec(text: string) {
        await pool.query(text);
      },
      async close() {
        await pool.end();
      },
    };
  }

  const dataDir = path.resolve(process.cwd(), opts.pglitePath);
  await fs.mkdir(dataDir, { recursive: true });
  const db = new PGlite(dataDir);
  await db.waitReady;

  return {
    kind: "pglite",
    async query<T>(text: string, params?: any[]) {
      const r = await db.query<T>(text, params);
      return { rows: r.rows as T[], rowCount: r.affectedRows ?? r.rows.length };
    },
    async exec(text: string) {
      await db.exec(text);
    },
    async close() {
      await db.close();
    },
  };
}
