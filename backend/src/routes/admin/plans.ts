import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { requireRole } from "../../auth/prehandlers.js";
import { writeAuditLog } from "../../audit/log.js";

const planBody = z.object({
  name: z.string().min(1),
  monthlyRent: z.number().min(0),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});

export const adminPlanRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireRole("ADMIN"));

  app.get("/plans", async () => {
    const r = await app.db.query<{
      id: string;
      name: string;
      monthly_rent: string;
      status: "ACTIVE" | "DISABLED";
      created_at: string;
    }>("select id, name, monthly_rent, status, created_at from plans order by created_at asc");

    return r.rows.map((x) => ({
      id: x.id,
      name: x.name,
      monthlyRent: Number(x.monthly_rent),
      status: x.status,
      createdAt: x.created_at,
    }));
  });

  app.post("/plans", async (request, reply) => {
    const parsed = planBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });

    const b = parsed.data;
    const id = randomUUID();
    await app.db.query(
      `insert into plans (id, name, monthly_rent, status)
       values ($1, $2, $3, $4)`,
      [id, b.name, b.monthlyRent, b.status ?? "ACTIVE"],
    );
    const after = await app.db.query("select id, name, monthly_rent, status from plans where id = $1", [id]);
    await writeAuditLog(app.db, {
      actorUserId: request.user.sub,
      actorRole: "ADMIN",
      action: "PLAN_CREATE",
      entityType: "plans",
      entityId: id,
      after: after.rows[0] ?? { id },
    });
    return reply.code(201).send({ id });
  });

  app.put("/plans/:id", async (request, reply) => {
    const id = String((request.params as any).id ?? "");
    if (!id) return reply.code(400).send({ error: "BAD_REQUEST" });

    const parsed = planBody.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const b = parsed.data;

    const before = await app.db.query("select id, name, monthly_rent, status from plans where id = $1 limit 1", [id]);
    const ex = before.rows[0];
    if (!ex) return reply.code(404).send({ error: "NOT_FOUND" });

    const sets: string[] = [];
    const vals: any[] = [];
    const push = (col: string, v: any) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (b.name !== undefined) push("name", b.name);
    if (b.monthlyRent !== undefined) push("monthly_rent", b.monthlyRent);
    if (b.status !== undefined) push("status", b.status);
    if (sets.length === 0) return reply.code(400).send({ error: "NO_CHANGES" });

    vals.push(id);
    const q = `update plans set ${sets.join(", ")} where id = $${vals.length}`;
    const res = await app.db.query(q, vals);
    if (res.rowCount === 0) return reply.code(404).send({ error: "NOT_FOUND" });

    const after = await app.db.query("select id, name, monthly_rent, status from plans where id = $1", [id]);
    await writeAuditLog(app.db, {
      actorUserId: request.user.sub,
      actorRole: "ADMIN",
      action: "PLAN_UPDATE",
      entityType: "plans",
      entityId: id,
      before: ex,
      after: after.rows[0] ?? { id },
    });
    return reply.send({ ok: true });
  });

  app.delete("/plans/:id", async (request, reply) => {
    const id = String((request.params as any).id ?? "");
    if (!id) return reply.code(400).send({ error: "BAD_REQUEST" });

    const before = await app.db.query("select id, name, monthly_rent, status from plans where id = $1 limit 1", [id]);
    const ex = before.rows[0];
    if (!ex) return reply.code(404).send({ error: "NOT_FOUND" });

    const usedByCard = await app.db.query<{ id: string }>("select id from cards where plan_id = $1 limit 1", [id]);
    if (usedByCard.rows[0]) return reply.code(409).send({ error: "PLAN_IN_USE" });

    const del = await app.db.query("delete from plans where id = $1", [id]);
    if (del.rowCount === 0) return reply.code(404).send({ error: "NOT_FOUND" });

    await writeAuditLog(app.db, {
      actorUserId: request.user.sub,
      actorRole: "ADMIN",
      action: "PLAN_DELETE",
      entityType: "plans",
      entityId: id,
      before: ex,
    });
    return reply.send({ ok: true });
  });
};
