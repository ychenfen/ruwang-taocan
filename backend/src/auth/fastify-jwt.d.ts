import "@fastify/jwt";

import type { JwtUser } from "./types.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtUser;
    user: JwtUser;
  }
}
