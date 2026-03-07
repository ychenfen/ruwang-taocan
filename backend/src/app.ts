import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";

import { loadConfig, type AppConfig } from "./config.js";
import { createDb, type Db } from "./db.js";
import { authRoutes } from "./routes/auth.js";
import { agentRoutes } from "./routes/agent/index.js";
import { adminRoutes } from "./routes/admin/index.js";

export type BuildAppOptions = Readonly<{
  config?: AppConfig;
  db?: Db;
  logger?: boolean;
}>;

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = opts.config ?? loadConfig(process.env);
  const db = opts.db ?? (await createDb({ databaseUrl: config.DATABASE_URL, pglitePath: config.PGLITE_PATH }));

  const app = Fastify({
    logger: opts.logger ?? true,
  });

  app.decorate("config", config);
  app.decorate("db", db);

  app.addHook("onClose", async () => {
    await db.close();
  });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(jwt, { secret: config.JWT_SECRET });

  await app.register(authRoutes);
  await app.register(agentRoutes, { prefix: "/agent" });
  await app.register(adminRoutes, { prefix: "/admin" });

  app.get("/health", async () => {
    return { ok: true };
  });

  app.get("/health/db", async () => {
    const r = await db.query<{ ok: number }>("select 1 as ok");
    return { ok: r.rows[0]?.ok === 1 };
  });

  return app;
}
