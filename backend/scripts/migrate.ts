import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import { createDb, type Db } from "../src/db.js";

async function ensureMigrationsTable(db: Db) {
  await db.query(`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    );
  `);
}

async function listMigrationFiles(migrationsDir: string): Promise<string[]> {
  const entries = await fs.promises.readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

async function main() {
  const migrationsDir = path.resolve(process.cwd(), "migrations");

  const databaseUrl = process.env.DATABASE_URL;
  const pglitePath = process.env.PGLITE_PATH ?? "./.data/pglite";
  const db = await createDb({ databaseUrl, pglitePath });

  try {
    await ensureMigrationsTable(db);

    const files = await listMigrationFiles(migrationsDir);
    const applied = new Set<string>(
      (await db.query<{ id: string }>("select id from schema_migrations order by id asc")).rows.map((r) => r.id),
    );

    for (const f of files) {
      if (applied.has(f)) continue;
      const full = path.join(migrationsDir, f);
      const sql = await fs.promises.readFile(full, "utf-8");

      // Apply in a single transaction.
      // If a migration needs to be non-transactional, split it into smaller steps.
      await db.query("begin");
      try {
        await db.exec(sql);
        await db.query("insert into schema_migrations (id) values ($1)", [f]);
        await db.query("commit");
        // eslint-disable-next-line no-console
        console.log(`applied: ${f}`);
      } catch (err) {
        await db.query("rollback");
        throw err;
      }
    }
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
