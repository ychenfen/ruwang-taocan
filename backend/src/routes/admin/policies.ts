import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { requireRole } from "../../auth/prehandlers.js";
import { writeAuditLog } from "../../audit/log.js";

const policyBody = z.object({
  name: z.string().min(1),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});

export const adminPolicyRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireRole("ADMIN"));

  app.get("/policies", async () => {
    const r = await app.db.query<{
      id: string;
      name: string;
      status: "ACTIVE" | "DISABLED";
      created_at: string;
    }>("select id, name, status, created_at from policies order by created_at asc");

    return r.rows.map((x) => ({
      id: x.id,
      name: x.name,
      status: x.status,
      createdAt: x.created_at,
    }));
  });

  app.post("/policies", async (request, reply) => {
    const parsed = policyBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });

    const b = parsed.data;
    const id = randomUUID();
    await app.db.query(
      `insert into policies (id, name, status, created_at)
       values ($1, $2, $3, now())`,
      [id, b.name, b.status ?? "ACTIVE"],
    );
    const after = await app.db.query("select id, name, status from policies where id = $1", [id]);
    await writeAuditLog(app.db, {
      actorUserId: request.user.sub,
      actorRole: "ADMIN",
      action: "POLICY_CREATE",
      entityType: "policies",
      entityId: id,
      after: after.rows[0] ?? { id },
    });
    return reply.code(201).send({ id });
  });

  app.put("/policies/:id", async (request, reply) => {
    const id = String((request.params as any).id ?? "");
    if (!id) return reply.code(400).send({ error: "BAD_REQUEST" });

    const parsed = policyBody.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const b = parsed.data;

    const before = await app.db.query("select id, name, status from policies where id = $1 limit 1", [id]);
    const ex = before.rows[0];
    if (!ex) return reply.code(404).send({ error: "NOT_FOUND" });

    const sets: string[] = [];
    const vals: any[] = [];
    const push = (col: string, v: any) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (b.name !== undefined) push("name", b.name);
    if (b.status !== undefined) push("status", b.status);
    if (sets.length === 0) return reply.code(400).send({ error: "NO_CHANGES" });

    vals.push(id);
    const q = `update policies set ${sets.join(", ")} where id = $${vals.length}`;
    const res = await app.db.query(q, vals);
    if (res.rowCount === 0) return reply.code(404).send({ error: "NOT_FOUND" });

    const after = await app.db.query("select id, name, status from policies where id = $1", [id]);
    await writeAuditLog(app.db, {
      actorUserId: request.user.sub,
      actorRole: "ADMIN",
      action: "POLICY_UPDATE",
      entityType: "policies",
      entityId: id,
      before: ex,
      after: after.rows[0] ?? { id },
    });
    return reply.send({ ok: true });
  });
};
