import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { requireRole } from "../../auth/prehandlers.js";
import { writeAuditLog } from "../../audit/log.js";

const cardStatusEnum = z.enum(["NORMAL", "PAUSED", "LEFT", "CONTROLLED", "ABNORMAL"]);

const createCardBody = z.object({
  cardNo: z.string().min(1),
  activatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  planId: z.string().min(1),
  policyId: z.string().min(1).optional(),
  ownerAgentId: z.string().min(1),
  initialStatus: cardStatusEnum.optional(),
});

const updateCardBody = z.object({
  // Keep backward compatibility with old frontend payloads:
  // activatedAt may be empty string when user edits only plan/policy.
  activatedAt: z.string().optional(),
  planId: z.string().min(1).optional(),
  // policyId may be "" from old frontend when card has no policy.
  policyId: z.string().nullable().optional(),
});

const assignBody = z.object({
  ownerAgentId: z.string().min(1),
  effectiveAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
});

const statusEventBody = z.object({
  status: cardStatusEnum,
  // Accept either YYYY-MM-DD or full ISO datetime.
  happenedAt: z.string().min(1),
  reason: z.string().min(1).optional(),
});

function toCstStartOfDayIso(ymd: string): string {
  return `${ymd}T00:00:00+08:00`;
}

function normalizeStatusEventHappenedAt(raw: string): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/u.test(s)) return toCstStartOfDayIso(s);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function toCstYearMonth(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const direct = /^(\d{4})-(\d{2})/.exec(s);
  if (direct) return `${direct[1]}-${direct[2]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  // Convert instant to CST(+08:00) calendar month.
  const cst = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return `${cst.getUTCFullYear()}-${String(cst.getUTCMonth() + 1).padStart(2, "0")}`;
}

const listCardsQuery = z.object({
  withTotal: z
    .union([z.literal("1"), z.literal("true"), z.literal("0"), z.literal("false"), z.boolean()])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  keyword: z.string().optional(),
  status: cardStatusEnum.optional(),
  ownerAgentId: z.string().optional(),
});

function normalizeYmd(v: string): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const direct = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (direct) return `${direct[1]}-${direct[2]}-${direct[3]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export const adminCardRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireRole("ADMIN"));

  app.get("/cards", async (request, reply) => {
    const parsed = listCardsQuery.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const q = parsed.data;
    const withTotal = q.withTotal === true || q.withTotal === "1" || q.withTotal === "true";
    const limit = q.limit ?? 100;
    const offset = q.offset ?? 0;

    const where: string[] = [];
    const params: any[] = [];
    const keyword = String(q.keyword ?? "").trim();
    if (keyword) {
      const like = `%${keyword}%`;
      params.push(like, like, like, like, like);
      const i = params.length;
      where.push(
        `(c.card_no ilike $${i - 4} or c.id::text ilike $${i - 3} or coalesce(a.name, '') ilike $${i - 2} or coalesce(p.name, '') ilike $${i - 1} or coalesce(pol.name, '') ilike $${i})`,
      );
    }
    if (q.status) {
      params.push(q.status);
      where.push(`ls.status = $${params.length}`);
    }
    if (q.ownerAgentId) {
      params.push(q.ownerAgentId);
      where.push(`ca.owner_agent_id = $${params.length}`);
    }
    const sqlWhere = where.length > 0 ? `where ${where.join(" and ")}` : "";

    const baseSql = `
      from cards c
      left join plans p on p.id = c.plan_id
      left join policies pol on pol.id = c.policy_id
      left join card_assignments ca on ca.card_id = c.id and ca.end_at is null
      left join agents a on a.id = ca.owner_agent_id
      left join lateral (
        select e.status, e.happened_at
        from card_status_events e
        where e.card_id = c.id
        order by e.happened_at desc, e.created_at desc, e.id desc
        limit 1
      ) ls on true
      ${sqlWhere}
    `;

    let total = 0;
    if (withTotal) {
      const tr = await app.db.query<{ cnt: number }>(`select count(*)::int as cnt ${baseSql}`, params);
      total = Number(tr.rows[0]?.cnt ?? 0);
    }

    const listParams = [...params];
    const limitIdx = listParams.push(limit);
    const offsetIdx = listParams.push(offset);
    const r = await app.db.query<{
      id: string;
      card_no: string;
      activated_at: string;
      plan_id: string;
      plan_name: string | null;
      monthly_rent: string | number | null;
      policy_id: string | null;
      policy_name: string | null;
      owner_agent_id: string | null;
      owner_name: string | null;
      current_status: string | null;
      current_status_at: string | null;
      created_at: string;
    }>(
      `
        select
          c.id,
          c.card_no,
          c.activated_at::text as activated_at,
          c.plan_id,
          p.name as plan_name,
          p.monthly_rent,
          c.policy_id,
          pol.name as policy_name,
          ca.owner_agent_id,
          a.name as owner_name,
          ls.status as current_status,
          ls.happened_at::text as current_status_at,
          c.created_at
        ${baseSql}
        order by c.created_at desc
        limit $${limitIdx}
        offset $${offsetIdx}
      `,
      listParams,
    );

    const rows = r.rows.map((x) => ({
      id: x.id,
      cardNo: x.card_no,
      activatedAt: x.activated_at,
      planId: x.plan_id,
      planName: x.plan_name ?? "",
      monthlyRent: Number(x.monthly_rent ?? 0),
      policyId: x.policy_id ?? undefined,
      policyName: x.policy_name ?? undefined,
      ownerAgentId: x.owner_agent_id ?? undefined,
      ownerName: x.owner_name ?? undefined,
      currentStatus: x.current_status ?? undefined,
      currentStatusAt: x.current_status_at ?? undefined,
      createdAt: x.created_at,
    }));

    if (withTotal) return { rows, total, limit, offset };
    return rows;
  });

  app.get("/cards/:id", async (request, reply) => {
    const cardId = String((request.params as any).id ?? "");
    if (!cardId) return reply.code(400).send({ error: "BAD_REQUEST" });

    const r = await app.db.query<{
      id: string;
      card_no: string;
      activated_at: string;
      plan_id: string;
      plan_name: string | null;
      monthly_rent: string | number | null;
      policy_id: string | null;
      policy_name: string | null;
      owner_agent_id: string | null;
      owner_name: string | null;
      current_status: string | null;
      current_status_at: string | null;
      created_at: string;
    }>(
      `
        select
          c.id,
          c.card_no,
          c.activated_at::text as activated_at,
          c.plan_id,
          p.name as plan_name,
          p.monthly_rent,
          c.policy_id,
          pol.name as policy_name,
          ca.owner_agent_id,
          a.name as owner_name,
          ls.status as current_status,
          ls.happened_at::text as current_status_at,
          c.created_at
        from cards c
        left join plans p on p.id = c.plan_id
        left join policies pol on pol.id = c.policy_id
        left join card_assignments ca on ca.card_id = c.id and ca.end_at is null
        left join agents a on a.id = ca.owner_agent_id
        left join lateral (
          select e.status, e.happened_at
          from card_status_events e
          where e.card_id = c.id
          order by e.happened_at desc, e.created_at desc, e.id desc
          limit 1
        ) ls on true
        where c.id = $1
        limit 1
      `,
      [cardId],
    );
    const x = r.rows[0];
    if (!x) return reply.code(404).send({ error: "NOT_FOUND" });

    return {
      id: x.id,
      cardNo: x.card_no,
      activatedAt: x.activated_at,
      planId: x.plan_id,
      planName: x.plan_name ?? "",
      monthlyRent: Number(x.monthly_rent ?? 0),
      policyId: x.policy_id ?? undefined,
      policyName: x.policy_name ?? undefined,
      ownerAgentId: x.owner_agent_id ?? undefined,
      ownerName: x.owner_name ?? undefined,
      currentStatus: x.current_status ?? undefined,
      currentStatusAt: x.current_status_at ?? undefined,
      createdAt: x.created_at,
    };
  });

  app.post("/cards", async (request, reply) => {
    const parsed = createCardBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const b = parsed.data;

    await app.db.query("begin");
    try {
      const exists = await app.db.query<{ id: string }>("select id from cards where card_no = $1 limit 1", [b.cardNo]);
      if (exists.rows[0]) {
        await app.db.query("rollback");
        return reply.code(409).send({ error: "CARD_NO_TAKEN" });
      }

      const plan = await app.db.query<{ id: string }>("select id from plans where id = $1 limit 1", [b.planId]);
      if (!plan.rows[0]) {
        await app.db.query("rollback");
        return reply.code(400).send({ error: "PLAN_NOT_FOUND" });
      }

      if (b.policyId) {
        const pol = await app.db.query<{ id: string }>("select id from policies where id = $1 limit 1", [b.policyId]);
        if (!pol.rows[0]) {
          await app.db.query("rollback");
          return reply.code(400).send({ error: "POLICY_NOT_FOUND" });
        }
      }

      const owner = await app.db.query<{ id: string }>("select id from agents where id = $1 limit 1", [b.ownerAgentId]);
      if (!owner.rows[0]) {
        await app.db.query("rollback");
        return reply.code(400).send({ error: "OWNER_NOT_FOUND" });
      }

      const cardId = randomUUID();
      await app.db.query(
        `insert into cards (id, card_no, activated_at, plan_id, policy_id, created_by, created_at)
         values ($1, $2, $3, $4, $5, $6, now())`,
        [cardId, b.cardNo, b.activatedAt, b.planId, b.policyId ?? null, request.user.sub],
      );

      const assignmentId = randomUUID();
      await app.db.query(
        `insert into card_assignments (id, card_id, owner_agent_id, start_at, created_by, created_at)
         values ($1, $2, $3, $4, $5, now())`,
        [assignmentId, cardId, b.ownerAgentId, `${b.activatedAt}T00:00:00+08:00`, request.user.sub],
      );

      const statusEventId = randomUUID();
      // Default to NORMAL at activation midnight (+08:00).
      const happenedAt = toCstStartOfDayIso(b.activatedAt);
      await app.db.query(
        `insert into card_status_events (id, card_id, status, reason, happened_at, created_by, created_at)
         values ($1, $2, $3, $4, $5, $6, now())`,
        [statusEventId, cardId, b.initialStatus ?? "NORMAL", null, happenedAt, request.user.sub],
      );

      const cardAfter = await app.db.query(
        "select id, card_no, activated_at, plan_id, policy_id, created_by, created_at from cards where id = $1",
        [cardId],
      );
      await writeAuditLog(app.db, {
        actorUserId: request.user.sub,
        actorRole: "ADMIN",
        action: "CARD_CREATE",
        entityType: "cards",
        entityId: cardId,
        after: cardAfter.rows[0] ?? { id: cardId },
      });
      const assignAfter = await app.db.query(
        "select id, card_id, owner_agent_id, start_at, end_at, created_by, created_at from card_assignments where id = $1",
        [assignmentId],
      );
      await writeAuditLog(app.db, {
        actorUserId: request.user.sub,
        actorRole: "ADMIN",
        action: "CARD_ASSIGN",
        entityType: "card_assignments",
        entityId: assignmentId,
        after: assignAfter.rows[0] ?? { id: assignmentId },
        meta: { cardId, ownerAgentId: b.ownerAgentId },
      });
      const evAfter = await app.db.query(
        "select id, card_id, status, reason, happened_at, created_by, created_at from card_status_events where id = $1",
        [statusEventId],
      );
      await writeAuditLog(app.db, {
        actorUserId: request.user.sub,
        actorRole: "ADMIN",
        action: "CARD_STATUS_EVENT_CREATE",
        entityType: "card_status_events",
        entityId: statusEventId,
        after: evAfter.rows[0] ?? { id: statusEventId },
        meta: { cardId, status: b.initialStatus ?? "NORMAL" },
      });

      await app.db.query("commit");
      return reply.code(201).send({ id: cardId, assignmentId, statusEventId });
    } catch (err) {
      await app.db.query("rollback");
      throw err;
    }
  });

  app.put("/cards/:id", async (request, reply) => {
    const cardId = String((request.params as any).id ?? "");
    if (!cardId) return reply.code(400).send({ error: "BAD_REQUEST" });

    const parsed = updateCardBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const b = parsed.data;

    await app.db.query("begin");
    try {
      const before = await app.db.query(
        "select id, card_no, activated_at, plan_id, policy_id from cards where id = $1 limit 1",
        [cardId],
      );
      const card = before.rows[0];
      if (!card) {
        await app.db.query("rollback");
        return reply.code(404).send({ error: "NOT_FOUND" });
      }

      if (b.planId) {
        const plan = await app.db.query<{ id: string }>("select id from plans where id = $1 limit 1", [b.planId]);
        if (!plan.rows[0]) {
          await app.db.query("rollback");
          return reply.code(400).send({ error: "PLAN_NOT_FOUND" });
        }
      }

      if (b.policyId && b.policyId !== null) {
        const pol = await app.db.query<{ id: string }>("select id from policies where id = $1 limit 1", [b.policyId]);
        if (!pol.rows[0]) {
          await app.db.query("rollback");
          return reply.code(400).send({ error: "POLICY_NOT_FOUND" });
        }
      }

      const sets: string[] = [];
      const vals: any[] = [];
      const push = (col: string, v: any) => {
        vals.push(v);
        sets.push(`${col} = $${vals.length}`);
      };
      if (b.activatedAt !== undefined) {
        const raw = String(b.activatedAt ?? "").trim();
        if (raw.length > 0) {
          const activatedAt = normalizeYmd(raw);
          if (!activatedAt) {
            await app.db.query("rollback");
            return reply.code(400).send({ error: "BAD_REQUEST", message: "activatedAt must be YYYY-MM-DD" });
          }
          push("activated_at", activatedAt);
        }
      }
      if (b.planId !== undefined) push("plan_id", b.planId);
      if (b.policyId !== undefined) {
        const policyId = b.policyId === null ? null : String(b.policyId).trim();
        push("policy_id", policyId && policyId.length > 0 ? policyId : null);
      }
      if (sets.length === 0) {
        await app.db.query("rollback");
        return reply.code(400).send({ error: "NO_CHANGES" });
      }

      vals.push(cardId);
      const q = `update cards set ${sets.join(", ")} where id = $${vals.length}`;
      await app.db.query(q, vals);

      const after = await app.db.query(
        "select id, card_no, activated_at, plan_id, policy_id from cards where id = $1",
        [cardId],
      );
      await writeAuditLog(app.db, {
        actorUserId: request.user.sub,
        actorRole: "ADMIN",
        action: "CARD_UPDATE",
        entityType: "cards",
        entityId: cardId,
        before: card,
        after: after.rows[0] ?? { id: cardId },
      });

      await app.db.query("commit");
      return reply.send({ ok: true });
    } catch (err) {
      await app.db.query("rollback");
      throw err;
    }
  });

  app.delete("/cards/:id", async (request, reply) => {
    const cardId = String((request.params as any).id ?? "");
    if (!cardId) return reply.code(400).send({ error: "BAD_REQUEST" });

    await app.db.query("begin");
    try {
      const before = await app.db.query(
        "select id, card_no, activated_at, plan_id, policy_id, created_by, created_at from cards where id = $1 limit 1",
        [cardId],
      );
      const card = before.rows[0];
      if (!card) {
        await app.db.query("rollback");
        return reply.code(404).send({ error: "NOT_FOUND" });
      }

      const used = await app.db.query<{ id: string }>(
        "select id from settlement_items where card_id = $1 limit 1",
        [cardId],
      );
      if (used.rows[0]) {
        await app.db.query("rollback");
        return reply.code(409).send({ error: "CARD_HAS_SETTLEMENT_ITEMS" });
      }

      await app.db.query("delete from cards where id = $1", [cardId]);
      await writeAuditLog(app.db, {
        actorUserId: request.user.sub,
        actorRole: "ADMIN",
        action: "CARD_DELETE",
        entityType: "cards",
        entityId: cardId,
        before: card,
      });

      await app.db.query("commit");
      return reply.send({ ok: true });
    } catch (err) {
      await app.db.query("rollback");
      throw err;
    }
  });

  // Transfer card ownership (end current assignment, create new assignment).
  app.post("/cards/:id/assign", async (request, reply) => {
    const cardId = String((request.params as any).id ?? "");
    if (!cardId) return reply.code(400).send({ error: "BAD_REQUEST" });

    const parsed = assignBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const b = parsed.data;

    await app.db.query("begin");
    try {
      const card = await app.db.query<{ id: string }>("select id from cards where id = $1 limit 1", [cardId]);
      if (!card.rows[0]) {
        await app.db.query("rollback");
        return reply.code(404).send({ error: "CARD_NOT_FOUND" });
      }

      const owner = await app.db.query<{ id: string }>("select id from agents where id = $1 limit 1", [b.ownerAgentId]);
      if (!owner.rows[0]) {
        await app.db.query("rollback");
        return reply.code(400).send({ error: "OWNER_NOT_FOUND" });
      }

      const existing = await app.db.query<{ id: string; owner_agent_id: string; start_at: string }>(
        "select id, owner_agent_id, start_at::text as start_at from card_assignments where card_id = $1 and end_at is null limit 1",
        [cardId],
      );
      const ex = existing.rows[0];
      if (ex && ex.owner_agent_id === b.ownerAgentId) {
        await app.db.query("commit");
        return reply.send({ ok: true, assignmentId: ex.id });
      }

      const effectiveAt = b.effectiveAt ? toCstStartOfDayIso(b.effectiveAt) : null;
      const nextStartAt = effectiveAt ?? new Date().toISOString();

      const rewriteActiveAssignmentOwner = async () => {
        if (!ex) return null;
        const before = await app.db.query(
          "select id, card_id, owner_agent_id, start_at, end_at, created_by, created_at from card_assignments where id = $1",
          [ex.id],
        );
        await app.db.query("update card_assignments set owner_agent_id = $2 where id = $1", [ex.id, b.ownerAgentId]);
        const after = await app.db.query(
          "select id, card_id, owner_agent_id, start_at, end_at, created_by, created_at from card_assignments where id = $1",
          [ex.id],
        );
        await writeAuditLog(app.db, {
          actorUserId: request.user.sub,
          actorRole: "ADMIN",
          action: "CARD_ASSIGN",
          entityType: "card_assignments",
          entityId: ex.id,
          before: before.rows[0] ?? { id: ex.id },
          after: after.rows[0] ?? { id: ex.id },
          meta: { cardId, ownerAgentId: b.ownerAgentId, rewritten: true },
        });
        return ex.id;
      };

      if (ex) {
        const exStart = new Date(ex.start_at);
        const nextStart = new Date(nextStartAt);
        if (Number.isNaN(exStart.getTime()) || Number.isNaN(nextStart.getTime())) {
          await app.db.query("rollback");
          return reply.code(400).send({ error: "BAD_REQUEST", message: "invalid assignment time" });
        }

        if (nextStart.getTime() < exStart.getTime()) {
          if (!b.effectiveAt) {
            const rewrittenId = await rewriteActiveAssignmentOwner();
            await app.db.query("commit");
            return reply.send({ ok: true, assignmentId: rewrittenId, rewritten: true });
          }
          await app.db.query("rollback");
          return reply.code(400).send({
            error: "ASSIGN_EFFECTIVE_AT_BEFORE_CURRENT_START",
            message: "effectiveAt must be >= current assignment start_at",
          });
        }

        if (nextStart.getTime() === exStart.getTime()) {
          const rewrittenId = await rewriteActiveAssignmentOwner();
          await app.db.query("commit");
          return reply.send({ ok: true, assignmentId: rewrittenId, rewritten: true });
        }

        const before = await app.db.query(
          "select id, card_id, owner_agent_id, start_at, end_at, created_by, created_at from card_assignments where id = $1",
          [ex.id],
        );
        await app.db.query("update card_assignments set end_at = $2 where id = $1", [ex.id, nextStartAt]);
        const after = await app.db.query(
          "select id, card_id, owner_agent_id, start_at, end_at, created_by, created_at from card_assignments where id = $1",
          [ex.id],
        );
        await writeAuditLog(app.db, {
          actorUserId: request.user.sub,
          actorRole: "ADMIN",
          action: "CARD_ASSIGNMENT_END",
          entityType: "card_assignments",
          entityId: ex.id,
          before: before.rows[0] ?? { id: ex.id },
          after: after.rows[0] ?? { id: ex.id },
          meta: { cardId, newOwnerAgentId: b.ownerAgentId },
        });
      }

      const assignmentId = randomUUID();
      await app.db.query(
        `insert into card_assignments (id, card_id, owner_agent_id, start_at, created_by, created_at)
         values ($1, $2, $3, $4, $5, now())`,
        [assignmentId, cardId, b.ownerAgentId, nextStartAt, request.user.sub],
      );
      const after = await app.db.query(
        "select id, card_id, owner_agent_id, start_at, end_at, created_by, created_at from card_assignments where id = $1",
        [assignmentId],
      );
      await writeAuditLog(app.db, {
        actorUserId: request.user.sub,
        actorRole: "ADMIN",
        action: "CARD_ASSIGN",
        entityType: "card_assignments",
        entityId: assignmentId,
        after: after.rows[0] ?? { id: assignmentId },
        meta: { cardId, ownerAgentId: b.ownerAgentId },
      });

      await app.db.query("commit");
      return reply.code(201).send({ assignmentId });
    } catch (err) {
      await app.db.query("rollback");
      throw err;
    }
  });

  app.get("/cards/:id/status-events", async (request, reply) => {
    const cardId = String((request.params as any).id ?? "");
    if (!cardId) return reply.code(400).send({ error: "BAD_REQUEST" });

    const card = await app.db.query<{ id: string }>("select id from cards where id = $1 limit 1", [cardId]);
    if (!card.rows[0]) return reply.code(404).send({ error: "NOT_FOUND" });

    const r = await app.db.query<{
      id: string;
      status: string;
      reason: string | null;
      happened_at: string;
      created_at: string;
    }>(
      `select id, status, reason, happened_at, created_at
       from card_status_events
       where card_id = $1
       order by happened_at asc, created_at asc, id asc`,
      [cardId],
    );

    return r.rows.map((x) => ({
      id: x.id,
      status: x.status,
      reason: x.reason ?? undefined,
      happenedAt: x.happened_at,
      createdAt: x.created_at,
    }));
  });

  app.post("/cards/:id/status-events", async (request, reply) => {
    const cardId = String((request.params as any).id ?? "");
    if (!cardId) return reply.code(400).send({ error: "BAD_REQUEST" });

    const parsed = statusEventBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const b = parsed.data;

    const card = await app.db.query<{ id: string }>("select id from cards where id = $1 limit 1", [cardId]);
    if (!card.rows[0]) return reply.code(404).send({ error: "NOT_FOUND" });

    const happenedAt = normalizeStatusEventHappenedAt(b.happenedAt);
    if (!happenedAt) return reply.code(400).send({ error: "BAD_REQUEST", message: "invalid happenedAt" });

    const id = randomUUID();
    await app.db.query(
      `insert into card_status_events (id, card_id, status, reason, happened_at, created_by, created_at)
       values ($1, $2, $3, $4, $5, $6, now())`,
      [id, cardId, b.status, b.reason ?? null, happenedAt, request.user.sub],
    );
    const after = await app.db.query(
      "select id, card_id, status, reason, happened_at, created_by, created_at from card_status_events where id = $1",
      [id],
    );
    await writeAuditLog(app.db, {
      actorUserId: request.user.sub,
      actorRole: "ADMIN",
      action: "CARD_STATUS_EVENT_CREATE",
      entityType: "card_status_events",
      entityId: id,
      after: after.rows[0] ?? { id },
      meta: { cardId, status: b.status },
    });
    return reply.code(201).send({ id });
  });

  app.delete("/cards/:id/status-events/:eventId", async (request, reply) => {
    const cardId = String((request.params as any).id ?? "");
    const eventId = String((request.params as any).eventId ?? "");
    if (!cardId || !eventId) return reply.code(400).send({ error: "BAD_REQUEST" });

    await app.db.query("begin");
    try {
      const card = await app.db.query<{ id: string }>("select id from cards where id = $1 limit 1", [cardId]);
      if (!card.rows[0]) {
        await app.db.query("rollback");
        return reply.code(404).send({ error: "NOT_FOUND" });
      }

      const eventBefore = await app.db.query<{
        id: string;
        card_id: string;
        status: string;
        reason: string | null;
        happened_at: string | Date;
        created_by: string | null;
        created_at: string;
      }>(
        `select id, card_id, status, reason, happened_at, created_by, created_at
         from card_status_events
         where id = $1 and card_id = $2
         limit 1`,
        [eventId, cardId],
      );
      const ev = eventBefore.rows[0];
      if (!ev) {
        await app.db.query("rollback");
        return reply.code(404).send({ error: "NOT_FOUND" });
      }

      const count = await app.db.query<{ cnt: number }>("select count(*)::int as cnt from card_status_events where card_id = $1", [cardId]);
      if (Number(count.rows[0]?.cnt ?? 0) <= 1) {
        await app.db.query("rollback");
        return reply.code(409).send({ error: "LAST_STATUS_EVENT_CANNOT_DELETE" });
      }

      const eventYm = toCstYearMonth(ev.happened_at);
      if (!eventYm) {
        await app.db.query("rollback");
        return reply.code(400).send({ error: "BAD_REQUEST", message: "invalid happened_at" });
      }
      const postedAffected = await app.db.query<{ id: string }>(
        `select id
         from settlement_runs
         where status = 'POSTED'
           and commission_month >= $1
         limit 1`,
        [eventYm],
      );
      if (postedAffected.rows[0]) {
        await app.db.query("rollback");
        return reply.code(409).send({ error: "STATUS_EVENT_LOCKED_BY_POSTED_SETTLEMENT" });
      }

      await app.db.query("delete from card_status_events where id = $1", [eventId]);
      await writeAuditLog(app.db, {
        actorUserId: request.user.sub,
        actorRole: "ADMIN",
        action: "CARD_STATUS_EVENT_DELETE",
        entityType: "card_status_events",
        entityId: eventId,
        before: ev,
        meta: { cardId, happenedAt: ev.happened_at, status: ev.status },
      });

      await app.db.query("commit");
      return reply.send({ ok: true });
    } catch (err) {
      await app.db.query("rollback");
      throw err;
    }
  });
};
