import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireRole } from "../../auth/prehandlers.js";
import { writeAuditLog } from "../../audit/log.js";
import { hashPassword, verifyPassword } from "../../security/password.js";

const adminChangePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

export const adminAccountRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireRole("ADMIN"));

  app.post("/account/password", async (request, reply) => {
    const parsed = adminChangePasswordBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "invalid payload" });
    }

    const { currentPassword, newPassword } = parsed.data;
    if (currentPassword === newPassword) {
      return reply.code(400).send({ error: "NEW_PASSWORD_SAME_AS_OLD" });
    }

    await app.db.query("begin");
    try {
      const u = await app.db.query<{
        id: string;
        username: string;
        role: "ADMIN" | "AGENT";
        status: "ACTIVE" | "DISABLED";
        password_hash: string;
      }>(
        `
          select id, username, role, status, password_hash
          from users
          where id = $1
          limit 1
        `,
        [request.user.sub],
      );
      const user = u.rows[0];
      if (!user || user.role !== "ADMIN") {
        await app.db.query("rollback");
        return reply.code(403).send({ error: "FORBIDDEN" });
      }
      if (user.status !== "ACTIVE") {
        await app.db.query("rollback");
        return reply.code(403).send({ error: "DISABLED" });
      }
      if (!verifyPassword(currentPassword, user.password_hash)) {
        await app.db.query("rollback");
        return reply.code(400).send({ error: "CURRENT_PASSWORD_INVALID" });
      }

      await app.db.query("update users set password_hash = $1 where id = $2", [hashPassword(newPassword), user.id]);

      await writeAuditLog(app.db, {
        actorUserId: user.id,
        actorRole: "ADMIN",
        action: "ADMIN_PASSWORD_CHANGE",
        entityType: "users",
        entityId: user.id,
        meta: { username: user.username },
      });

      await app.db.query("commit");
      return reply.send({ ok: true });
    } catch (err) {
      await app.db.query("rollback");
      throw err;
    }
  });
};

