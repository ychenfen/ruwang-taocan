import "dotenv/config";

import { randomUUID } from "node:crypto";

import { hashPassword } from "../src/security/password.js";
import { createDb } from "../src/db.js";

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing env: ${name}`);
}

async function main() {
  const adminUsername = env("SEED_ADMIN_USERNAME", "admin");
  const adminPassword = env("SEED_ADMIN_PASSWORD", "admin123456");

  const databaseUrl = process.env.DATABASE_URL;
  const pglitePath = process.env.PGLITE_PATH ?? "./.data/pglite";
  const db = await createDb({ databaseUrl, pglitePath });
  try {
    const existing = await db.query<{ id: string }>("select id from users where username = $1 limit 1", [
      adminUsername,
    ]);
    if (existing.rows[0]) {
      // eslint-disable-next-line no-console
      console.log(`admin user exists: ${adminUsername}`);
      return;
    }

    const passwordHash = hashPassword(adminPassword);
    const id = randomUUID();
    await db.query("insert into users (id, username, password_hash, role) values ($1, $2, $3, 'ADMIN')", [
      id,
      adminUsername,
      passwordHash,
    ]);
    // eslint-disable-next-line no-console
    console.log(`created admin user: ${adminUsername} (id=${id})`);
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
