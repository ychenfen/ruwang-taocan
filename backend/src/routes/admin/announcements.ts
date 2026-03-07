import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { requireRole } from "../../auth/prehandlers.js";
import { writeAuditLog } from "../../audit/log.js";

const createBody = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  startsAt: z.string().min(1).optional(), // ISO timestamptz
  endsAt: z.string().min(1).nullable().optional(), // ISO timestamptz or null
});

const updateBody = createBody.partial();

export const adminAnnouncementRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireRole("ADMIN"));

  app.get("/announcements", async () => {
    const r = await app.db.query<{
      id: string;
      title: string;
      body: string;
      status: "ACTIVE" | "DISABLED";
      starts_at: string;
      ends_at: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `
        select id, title, body, status, starts_at, ends_at, created_at, updated_at
        from announcements
        order by starts_at desc, created_at desc
      `,
    );
    return r.rows.map((x) => ({
      id: x.id,
      title: x.title,
      body: x.body,
      status: x.status,
      startsAt: x.starts_at,
      endsAt: x.ends_at ?? undefined,
      createdAt: x.created_at,
      updatedAt: x.updated_at,
    }));
  });

  app.post("/announcements", async (request, reply) => {
    const parsed = createBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const b = parsed.data;

    const id = randomUUID();
    await app.db.query(
      `
        insert into announcements (id, title, body, status, starts_at, ends_at, created_by, created_at, updated_by, updated_at)
        values ($1,$2,$3,$4,coalesce($5::timestamptz, now()),$6::timestamptz,$7,now(),$7,now())
      `,
      [
        id,
        b.title,
        b.body,
        b.status ?? "ACTIVE",
        b.startsAt ?? null,
        b.endsAt === undefined ? null : b.endsAt,
        request.user.sub,
      ],
    );

    const row = await app.db.query<{
      id: string;
      title: string;
      body: string;
      status: "ACTIVE" | "DISABLED";
      starts_at: string;
      ends_at: string | null;
    }>("select id, title, body, status, starts_at, ends_at from announcements where id = $1", [id]);

    await writeAuditLog(app.db, {
      actorUserId: request.user.sub,
      actorRole: "ADMIN",
      action: "ANNOUNCEMENT_CREATE",
      entityType: "announcements",
      entityId: id,
      after: row.rows[0] ?? { id },
    });

    return reply.code(201).send({ id });
  });

  app.put("/announcements/:id", async (request, reply) => {
    const id = String((request.params as any).id ?? "");
    if (!id) return reply.code(400).send({ error: "BAD_REQUEST" });

    const parsed = updateBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const b = parsed.data;

    const before = await app.db.query<{
      id: string;
      title: string;
      body: string;
      status: "ACTIVE" | "DISABLED";
      starts_at: string;
      ends_at: string | null;
    }>("select id, title, body, status, starts_at, ends_at from announcements where id = $1 limit 1", [id]);
    const ex = before.rows[0];
    if (!ex) return reply.code(404).send({ error: "NOT_FOUND" });

    const sets: string[] = [];
    const vals: any[] = [];
    const push = (sql: string, v: any) => {
      vals.push(v);
      sets.push(sql.replaceAll("?", `$${vals.length}`));
    };

    if (b.title !== undefined) push("title = ?", b.title);
    if (b.body !== undefined) push("body = ?", b.body);
    if (b.status !== undefined) push("status = ?", b.status);
    if (b.startsAt !== undefined) push("starts_at = ?::timestamptz", b.startsAt);
    if (b.endsAt !== undefined) push("ends_at = ?::timestamptz", b.endsAt);

    if (sets.length === 0) return reply.code(400).send({ error: "NO_CHANGES" });

    // Touch updated fields only if there are real changes.
    push("updated_by = ?", request.user.sub);
    sets.push("updated_at = now()");

    vals.push(id);
    const q = `update announcements set ${sets.join(", ")} where id = $${vals.length}`;
    await app.db.query(q, vals);

    const after = await app.db.query<{
      id: string;
      title: string;
      body: string;
      status: "ACTIVE" | "DISABLED";
      starts_at: string;
      ends_at: string | null;
    }>("select id, title, body, status, starts_at, ends_at from announcements where id = $1", [id]);

    await writeAuditLog(app.db, {
      actorUserId: request.user.sub,
      actorRole: "ADMIN",
      action: "ANNOUNCEMENT_UPDATE",
      entityType: "announcements",
      entityId: id,
      before: ex,
      after: after.rows[0] ?? { id },
    });

    return reply.send({ ok: true });
  });

  app.delete("/announcements/:id", async (request, reply) => {
    const id = String((request.params as any).id ?? "");
    if (!id) return reply.code(400).send({ error: "BAD_REQUEST" });

    const before = await app.db.query<{
      id: string;
      title: string;
      body: string;
      status: "ACTIVE" | "DISABLED";
      starts_at: string;
      ends_at: string | null;
    }>("select id, title, body, status, starts_at, ends_at from announcements where id = $1 limit 1", [id]);
    const ex = before.rows[0];
    if (!ex) return reply.code(404).send({ error: "NOT_FOUND" });

    await app.db.query("delete from announcements where id = $1", [id]);
    await writeAuditLog(app.db, {
      actorUserId: request.user.sub,
      actorRole: "ADMIN",
      action: "ANNOUNCEMENT_DELETE",
      entityType: "announcements",
      entityId: id,
      before: ex,
    });
    return reply.send({ ok: true });
  });
};
