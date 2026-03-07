import "fastify";

import type { AppConfig } from "./config.js";
import type { Db } from "./db.js";

declare module "fastify" {
  interface FastifyInstance {
    config: AppConfig;
    db: Db;
  }
}

