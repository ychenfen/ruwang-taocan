import type { FastifyReply, FastifyRequest } from "fastify";
import type { UserRole } from "./types.js";

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    await reply.code(401).send({ error: "UNAUTHORIZED" });
  }
}

export function requireRole(role: UserRole) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await requireAuth(request, reply);
    // If reply already sent by requireAuth, just stop.
    if (reply.sent) return;

    if (request.user.role !== role) {
      await reply.code(403).send({ error: "FORBIDDEN" });
    }
  };
}

