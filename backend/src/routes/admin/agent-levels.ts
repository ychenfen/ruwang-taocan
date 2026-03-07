import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { requireRole } from "../../auth/prehandlers.js";
import { writeAuditLog } from "../../audit/log.js";

const levelBody = z.object({
  name: z.string().min(1),
  supportRate: z.number().min(0).max(1),
  stableRate: z.number().min(0).max(1),
  stableMonths: z.number().int().min(0),
});

export const adminAgentLevelRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireRole("ADMIN"));

  app.get("/agent-levels", async () => {
    const r = await app.db.query<{
      id: string;
      name: string;
      support_rate: string;
      stable_rate: string;
      stable_months: number;
      created_at: string;
      updated_at: string;
    }>("select id, name, support_rate, stable_rate, stable_months, created_at, updated_at from agent_levels order by created_at asc");

    return r.rows.map((x) => ({
      id: x.id,
      name: x.name,
      supportRate: Number(x.support_rate),
      stableRate: Number(x.stable_rate),
      stableMonths: x.stable_months,
      createdAt: x.created_at,
      updatedAt: x.updated_at,
    }));
  });

  app.post("/agent-levels", async (request, reply) => {
    const parsed = levelBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });

    const b = parsed.data;
    const id = randomUUID();
    const r = await app.db.query<{ id: string }>(
      `insert into agent_levels (id, name, support_rate, stable_rate, stable_months)
       values ($1, $2, $3, $4, $5)`,
      [id, b.name, b.supportRate, b.stableRate, b.stableMonths],
    );
    void r;

    const after = await app.db.query(
      "select id, name, support_rate, stable_rate, stable_months from agent_levels where id = $1",
      [id],
    );
    await writeAuditLog(app.db, {
      actorUserId: request.user.sub,
      actorRole: "ADMIN",
      action: "AGENT_LEVEL_CREATE",
      entityType: "agent_levels",
      entityId: id,
      after: after.rows[0] ?? { id },
    });
    return reply.code(201).send({ id });
  });

  app.put("/agent-levels/:id", async (request, reply) => {
    const id = String((request.params as any).id ?? "");
    if (!id) return reply.code(400).send({ error: "BAD_REQUEST" });

    const parsed = levelBody.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const b = parsed.data;

    const before = await app.db.query(
      "select id, name, support_rate, stable_rate, stable_months from agent_levels where id = $1 limit 1",
      [id],
    );
    const ex = before.rows[0];
    if (!ex) return reply.code(404).send({ error: "NOT_FOUND" });

    // Build a small dynamic UPDATE to keep patch semantics.
    const sets: string[] = [];
    const vals: any[] = [];
    const push = (col: string, v: any) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (b.name !== undefined) push("name", b.name);
    if (b.supportRate !== undefined) push("support_rate", b.supportRate);
    if (b.stableRate !== undefined) push("stable_rate", b.stableRate);
    if (b.stableMonths !== undefined) push("stable_months", b.stableMonths);
    if (sets.length === 0) return reply.code(400).send({ error: "NO_CHANGES" });

    vals.push(id);
    const q = `update agent_levels set ${sets.join(", ")}, updated_at = now() where id = $${vals.length}`;
    const res = await app.db.query(q, vals);
    if (res.rowCount === 0) return reply.code(404).send({ error: "NOT_FOUND" });

    const after = await app.db.query(
      "select id, name, support_rate, stable_rate, stable_months from agent_levels where id = $1",
      [id],
    );
    await writeAuditLog(app.db, {
      actorUserId: request.user.sub,
      actorRole: "ADMIN",
      action: "AGENT_LEVEL_UPDATE",
      entityType: "agent_levels",
      entityId: id,
      before: ex,
      after: after.rows[0] ?? { id },
    });
    return reply.send({ ok: true });
  });

  app.delete("/agent-levels/:id", async (request, reply) => {
    const id = String((request.params as any).id ?? "");
    if (!id) return reply.code(400).send({ error: "BAD_REQUEST" });

    const before = await app.db.query(
      "select id, name, support_rate, stable_rate, stable_months from agent_levels where id = $1 limit 1",
      [id],
    );
    const ex = before.rows[0];
    if (!ex) return reply.code(404).send({ error: "NOT_FOUND" });

    const usingAgents = await app.db.query<{ id: string }>(
      "select id from agents where current_level_id = $1 limit 1",
      [id],
    );
    if (usingAgents.rows[0]) return reply.code(409).send({ error: "AGENT_LEVEL_IN_USE" });

    const del = await app.db.query("delete from agent_levels where id = $1", [id]);
    if (del.rowCount === 0) return reply.code(404).send({ error: "NOT_FOUND" });

    await writeAuditLog(app.db, {
      actorUserId: request.user.sub,
      actorRole: "ADMIN",
      action: "AGENT_LEVEL_DELETE",
      entityType: "agent_levels",
      entityId: id,
      before: ex,
    });
    return reply.send({ ok: true });
  });
};
