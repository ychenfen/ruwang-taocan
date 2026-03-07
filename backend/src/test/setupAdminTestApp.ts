import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../config.js";
import { createDb, type Db } from "../db.js";
import { hashPassword } from "../security/password.js";
import { buildApp } from "../app.js";

export type AdminTestApp = Readonly<{
  app: FastifyInstance;
  db: Db;
  token: string;
  pgliteDir: string;
}>;

export async function setupAdminTestApp(): Promise<AdminTestApp> {
  const pgliteDir = await fs.mkdtemp(path.join(os.tmpdir(), "ruwang-pglite-"));
  const db = await createDb({ pglitePath: pgliteDir });

  const migrationsDir = path.resolve(process.cwd(), "migrations");
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
  for (const f of files) {
    const sql = await fs.readFile(path.join(migrationsDir, f), "utf-8");
    await db.exec(sql);
  }

  const adminUsername = "admin";
  const adminPassword = "admin123456";
  await db.query("insert into users (id, username, password_hash, role) values ($1, $2, $3, 'ADMIN')", [
    randomUUID(),
    adminUsername,
    hashPassword(adminPassword),
  ]);

  const config: AppConfig = {
    PORT: 3000,
    JWT_SECRET: "1234567890abcdef",
    DATABASE_URL: undefined,
    PGLITE_PATH: pgliteDir,
    TZ: "Asia/Shanghai",
  };
  const app = await buildApp({ config, db, logger: false });

  const loginRes = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { username: adminUsername, password: adminPassword },
  });
  if (loginRes.statusCode !== 200) {
    throw new Error(`failed to login test admin: ${loginRes.statusCode} ${loginRes.body}`);
  }
  const token = loginRes.json().token;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("invalid test admin token");
  }

  return { app, db, token, pgliteDir };
}
