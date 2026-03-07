import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { requireRole } from "../../auth/prehandlers.js";
import { hashPassword } from "../../security/password.js";
import type { Db, DbQueryResult } from "../../db.js";
import { writeAuditLog } from "../../audit/log.js";

const agentCreateBody = z.object({
  username: z.string().min(1),
  password: z.string().min(6),
  name: z.string().min(1),
  phone: z.string().min(1).optional(),
  employeeNo: z.string().min(1).optional(),
  province: z.string().min(1).optional(),
  channel: z.string().min(1).optional(),
  levelId: z.string().min(1),
  teamId: z.string().min(1).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});

const agentUpdateBody = z.object({
  name: z.string().min(1).optional(),
  password: z.string().min(6).optional(),
  phone: z.string().min(1).optional(),
  employeeNo: z.string().min(1).optional(),
  province: z.string().min(1).optional(),
  channel: z.string().min(1).optional(),
  levelId: z.string().min(1).optional(),
  // null = remove from team
  teamId: z.string().min(1).nullable().optional(),
  userStatus: z.enum(["ACTIVE", "DISABLED"]).optional(),
});

const setUplineBody = z.object({
  uplineAgentId: z.string().min(1).nullable(),
  effectiveAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
});

const listAgentsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

type AppWithDb = Readonly<{ db: Db }>;

function toCstStartOfDayIso(ymd: string): string {
  return `${ymd}T00:00:00+08:00`;
}

async function assertAgentExists(app: AppWithDb, agentId: string) {
  const r = await app.db.query<{ id: string; user_id: string }>("select id, user_id from agents where id = $1 limit 1", [
    agentId,
  ]);
  return r.rows[0] ?? null;
}

async function wouldCreateCycle(app: AppWithDb, childAgentId: string, newUplineId: string): Promise<boolean> {
  let current: string | null = newUplineId;
  const seen = new Set<string>();
  for (let i = 0; i < 200 && current; i += 1) {
    if (current === childAgentId) return true;
    if (seen.has(current)) return true;
    seen.add(current);
    const r: DbQueryResult<{ upline_agent_id: string }> = await app.db.query(
      "select upline_agent_id from agent_relations where agent_id = $1 and end_at is null limit 1",
      [current],
    );
    current = r.rows[0]?.upline_agent_id ?? null;
  }
  return false;
}

async function setTeamMembership(app: AppWithDb, actorUserId: string, agentId: string, teamId: string | null) {
  if (teamId === null) {
    const existing = await app.db.query<{ id: string }>(
      "select id from team_memberships where agent_id = $1 and end_at is null limit 1",
      [agentId],
    );
    if (existing.rows[0]) {
      const before = await app.db.query(
        "select id, team_id, agent_id, start_at, end_at, created_by, created_at from team_memberships where id = $1",
        [existing.rows[0].id],
      );
      await app.db.query("update team_memberships set end_at = now() where id = $1", [existing.rows[0].id]);
      const after = await app.db.query(
        "select id, team_id, agent_id, start_at, end_at, created_by, created_at from team_memberships where id = $1",
        [existing.rows[0].id],
      );
      await writeAuditLog(app.db, {
        actorUserId,
        actorRole: "ADMIN",
        action: "TEAM_MEMBER_REMOVE",
        entityType: "team_memberships",
        entityId: existing.rows[0].id,
        before: before.rows[0] ?? { id: existing.rows[0].id },
        after: after.rows[0] ?? { id: existing.rows[0].id },
        meta: { agentId },
      });
    }
    await app.db.query("update agents set current_team_id = null where id = $1", [agentId]);
    return;
  }

  const team = await app.db.query<{ id: string }>("select id from teams where id = $1 limit 1", [teamId]);
  if (!team.rows[0]) throw new Error("TEAM_NOT_FOUND");

  const existing = await app.db.query<{ id: string; team_id: string }>(
    "select id, team_id from team_memberships where agent_id = $1 and end_at is null limit 1",
    [agentId],
  );
  const ex = existing.rows[0];
  if (ex && ex.team_id === teamId) {
    await app.db.query("update agents set current_team_id = $1 where id = $2", [teamId, agentId]);
    return;
  }
  if (ex) {
    const before = await app.db.query(
      "select id, team_id, agent_id, start_at, end_at, created_by, created_at from team_memberships where id = $1",
      [ex.id],
    );
    await app.db.query("update team_memberships set end_at = now() where id = $1", [ex.id]);
    const after = await app.db.query(
      "select id, team_id, agent_id, start_at, end_at, created_by, created_at from team_memberships where id = $1",
      [ex.id],
    );
    await writeAuditLog(app.db, {
      actorUserId,
      actorRole: "ADMIN",
      action: "TEAM_MEMBER_TRANSFER_END",
      entityType: "team_memberships",
      entityId: ex.id,
      before: before.rows[0] ?? { id: ex.id },
      after: after.rows[0] ?? { id: ex.id },
      meta: { agentId, fromTeamId: ex.team_id, toTeamId: teamId },
    });
  }

  const membershipId = randomUUID();
  await app.db.query(
    `insert into team_memberships (id, team_id, agent_id, start_at, created_by)
     values ($1, $2, $3, now(), $4)`,
    [membershipId, teamId, agentId, actorUserId],
  );
  const after = await app.db.query(
    "select id, team_id, agent_id, start_at, end_at, created_by, created_at from team_memberships where id = $1",
    [membershipId],
  );
  await writeAuditLog(app.db, {
    actorUserId,
    actorRole: "ADMIN",
    action: "TEAM_MEMBER_ADD",
    entityType: "team_memberships",
    entityId: membershipId,
    after: after.rows[0] ?? { id: membershipId },
    meta: { teamId, agentId },
  });
  await app.db.query("update agents set current_team_id = $1 where id = $2", [teamId, agentId]);
}

async function setAgentLevelHistory(args: Readonly<{
  app: AppWithDb;
  actorUserId: string;
  agentId: string;
  levelId: string;
  actionPrefix: "AGENT_LEVEL_INIT" | "AGENT_LEVEL_CHANGE";
}>): Promise<void> {
  const { app, actorUserId, agentId, levelId, actionPrefix } = args;

  const active = await app.db.query<{
    id: string;
    level_id: string;
    start_at: string;
    end_at: string | null;
    changed_by: string | null;
    created_at: string;
  }>(
    `
      select id, level_id, start_at, end_at, changed_by, created_at
      from agent_level_histories
      where agent_id = $1 and end_at is null
      limit 1
    `,
    [agentId],
  );
  const ex = active.rows[0];
  if (ex && ex.level_id === levelId) {
    await app.db.query("update agents set current_level_id = $1 where id = $2", [levelId, agentId]);
    return;
  }

  if (ex) {
    const before = ex;
    await app.db.query("update agent_level_histories set end_at = now() where id = $1", [ex.id]);
    const after = await app.db.query(
      "select id, level_id, start_at, end_at, changed_by, created_at from agent_level_histories where id = $1",
      [ex.id],
    );
    await writeAuditLog(app.db, {
      actorUserId,
      actorRole: "ADMIN",
      action: `${actionPrefix}_END_PREV`,
      entityType: "agent_level_histories",
      entityId: ex.id,
      before,
      after: after.rows[0] ?? { id: ex.id },
      meta: { agentId, toLevelId: levelId },
    });
  }

  const id = randomUUID();
  await app.db.query(
    `insert into agent_level_histories (id, agent_id, level_id, start_at, changed_by)
     values ($1, $2, $3, now(), $4)`,
    [id, agentId, levelId, actorUserId],
  );
  await app.db.query("update agents set current_level_id = $1 where id = $2", [levelId, agentId]);

  const created = await app.db.query(
    "select id, level_id, start_at, end_at, changed_by, created_at from agent_level_histories where id = $1",
    [id],
  );
  await writeAuditLog(app.db, {
    actorUserId,
    actorRole: "ADMIN",
    action: actionPrefix,
    entityType: "agent_level_histories",
    entityId: id,
    after: created.rows[0] ?? { id },
    meta: { agentId, levelId },
  });
}

export const adminAgentRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireRole("ADMIN"));

  app.get("/agents", async (request, reply) => {
    const parsed = listAgentsQuery.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "invalid query" });
    }
    const q = parsed.data;
    const paged = q.limit !== undefined || q.offset !== undefined;
    const limit = q.limit ?? 100;
    const offset = q.offset ?? 0;

    const r = await app.db.query<{
      id: string;
      user_id: string;
      username: string;
      user_status: "ACTIVE" | "DISABLED";
      name: string;
      phone: string | null;
      employee_no: string | null;
      province: string | null;
      channel: string | null;
      current_level_id: string;
      level_name: string;
      current_team_id: string | null;
      team_name: string | null;
      created_at: string;
    }>(`
      select
        a.id,
        a.user_id,
        u.username,
        u.status as user_status,
        a.name,
        a.phone,
        a.employee_no,
        a.province,
        a.channel,
        a.current_level_id,
        al.name as level_name,
        a.current_team_id,
        t.name as team_name,
        a.created_at
      from agents a
      join users u on u.id = a.user_id
      join agent_levels al on al.id = a.current_level_id
      left join teams t on t.id = a.current_team_id
      order by a.created_at asc
      ${paged ? "limit $1 offset $2" : ""}
    `, paged ? [limit, offset] : undefined);

    return r.rows.map((x) => ({
      id: x.id,
      userId: x.user_id,
      username: x.username,
      userStatus: x.user_status,
      name: x.name,
      phone: x.phone ?? undefined,
      employeeNo: x.employee_no ?? undefined,
      province: x.province ?? undefined,
      channel: x.channel ?? undefined,
      levelId: x.current_level_id,
      levelName: x.level_name,
      teamId: x.current_team_id ?? undefined,
      teamName: x.team_name ?? undefined,
      createdAt: x.created_at,
    }));
  });

  app.post("/agents", async (request, reply) => {
    const parsed = agentCreateBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "invalid payload" });
    }

    const b = parsed.data;

    await app.db.query("begin");
    try {
      const level = await app.db.query<{ id: string }>("select id from agent_levels where id = $1 limit 1", [b.levelId]);
      if (!level.rows[0]) {
        await app.db.query("rollback");
        return reply.code(400).send({ error: "LEVEL_NOT_FOUND" });
      }

      if (b.teamId) {
        const team = await app.db.query<{ id: string }>("select id from teams where id = $1 limit 1", [b.teamId]);
        if (!team.rows[0]) {
          await app.db.query("rollback");
          return reply.code(400).send({ error: "TEAM_NOT_FOUND" });
        }
      }

      const existingUser = await app.db.query<{ id: string }>("select id from users where username = $1 limit 1", [
        b.username,
      ]);
      if (existingUser.rows[0]) {
        await app.db.query("rollback");
        return reply.code(409).send({ error: "USERNAME_TAKEN" });
      }

      const userId = randomUUID();
      await app.db.query(
        `insert into users (id, username, password_hash, role, status)
         values ($1, $2, $3, 'AGENT', $4)`,
        [userId, b.username, hashPassword(b.password), b.status ?? "ACTIVE"],
      );

      const agentId = randomUUID();
      await app.db.query(
        `insert into agents (
          id, user_id, name, phone, employee_no, province, channel,
          current_level_id, current_team_id, created_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
        [
          agentId,
          userId,
          b.name,
          b.phone ?? null,
          b.employeeNo ?? null,
          b.province ?? null,
          b.channel ?? null,
          b.levelId,
          b.teamId ?? null,
        ],
      );

      await setAgentLevelHistory({
        app,
        actorUserId: request.user.sub,
        agentId,
        levelId: b.levelId,
        actionPrefix: "AGENT_LEVEL_INIT",
      });

      if (b.teamId) {
        const membershipId = randomUUID();
        await app.db.query(
          `insert into team_memberships (id, team_id, agent_id, start_at, created_by)
           values ($1, $2, $3, now(), $4)`,
          [membershipId, b.teamId, agentId, request.user.sub],
        );
        const after = await app.db.query(
          "select id, team_id, agent_id, start_at, end_at, created_by, created_at from team_memberships where id = $1",
          [membershipId],
        );
        await writeAuditLog(app.db, {
          actorUserId: request.user.sub,
          actorRole: "ADMIN",
          action: "TEAM_MEMBER_ADD",
          entityType: "team_memberships",
          entityId: membershipId,
          after: after.rows[0] ?? { id: membershipId },
          meta: { teamId: b.teamId, agentId },
        });
      }

      const after = await app.db.query(
        `
          select
            a.id,
            a.user_id,
            u.username,
            u.status as user_status,
            a.name,
            a.phone,
            a.employee_no,
            a.province,
            a.channel,
            a.current_level_id,
            a.current_team_id
          from agents a
          join users u on u.id = a.user_id
          where a.id = $1
        `,
        [agentId],
      );
      await writeAuditLog(app.db, {
        actorUserId: request.user.sub,
        actorRole: "ADMIN",
        action: "AGENT_CREATE",
        entityType: "agents",
        entityId: agentId,
        after: after.rows[0] ?? { id: agentId, userId },
      });

      await app.db.query("commit");
      return reply.code(201).send({ id: agentId, userId });
    } catch (err) {
      await app.db.query("rollback");
      throw err;
    }
  });

  app.put("/agents/:id", async (request, reply) => {
    const agentId = String((request.params as any).id ?? "");
    if (!agentId) return reply.code(400).send({ error: "BAD_REQUEST" });

    const parsed = agentUpdateBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "invalid payload" });
    }

    const b = parsed.data;

    await app.db.query("begin");
    try {
      const agent = await assertAgentExists(app, agentId);
      if (!agent) {
        await app.db.query("rollback");
        return reply.code(404).send({ error: "NOT_FOUND" });
      }

      const before = await app.db.query<{
        id: string;
        user_id: string;
        username: string;
        user_status: "ACTIVE" | "DISABLED";
        name: string;
        phone: string | null;
        employee_no: string | null;
        province: string | null;
        channel: string | null;
        current_level_id: string;
        current_team_id: string | null;
      }>(
        `
          select
            a.id,
            a.user_id,
            u.username,
            u.status as user_status,
            a.name,
            a.phone,
            a.employee_no,
            a.province,
            a.channel,
            a.current_level_id,
            a.current_team_id
          from agents a
          join users u on u.id = a.user_id
          where a.id = $1
        `,
        [agentId],
      );

      if (b.levelId) {
        const level = await app.db.query<{ id: string }>("select id from agent_levels where id = $1 limit 1", [b.levelId]);
        if (!level.rows[0]) {
          await app.db.query("rollback");
          return reply.code(400).send({ error: "LEVEL_NOT_FOUND" });
        }
      }

      if (b.teamId !== undefined) {
        try {
          await setTeamMembership(app, request.user.sub, agentId, b.teamId);
        } catch (e: any) {
          if (e?.message === "TEAM_NOT_FOUND") {
            await app.db.query("rollback");
            return reply.code(400).send({ error: "TEAM_NOT_FOUND" });
          }
          throw e;
        }
      }

      if (b.userStatus) {
        await app.db.query("update users set status = $1 where id = $2", [b.userStatus, agent.user_id]);
      }
      if (b.password !== undefined) {
        await app.db.query("update users set password_hash = $1 where id = $2", [hashPassword(b.password), agent.user_id]);
      }

      const sets: string[] = [];
      const vals: any[] = [];
      const push = (col: string, v: any) => {
        vals.push(v);
        sets.push(`${col} = $${vals.length}`);
      };
      if (b.name !== undefined) push("name", b.name);
      if (b.phone !== undefined) push("phone", b.phone);
      if (b.employeeNo !== undefined) push("employee_no", b.employeeNo);
      if (b.province !== undefined) push("province", b.province);
      if (b.channel !== undefined) push("channel", b.channel);
      if (b.levelId !== undefined) push("current_level_id", b.levelId);

      if (sets.length > 0) {
        vals.push(agentId);
        const q = `update agents set ${sets.join(", ")} where id = $${vals.length}`;
        await app.db.query(q, vals);
      }

      if (b.levelId !== undefined) {
        const beforeLevelId = String(before.rows[0]?.current_level_id ?? "");
        if (beforeLevelId !== b.levelId) {
          await setAgentLevelHistory({
            app,
            actorUserId: request.user.sub,
            agentId,
            levelId: b.levelId,
            actionPrefix: "AGENT_LEVEL_CHANGE",
          });
        }
      }

      const after = await app.db.query<{
        id: string;
        user_id: string;
        username: string;
        user_status: "ACTIVE" | "DISABLED";
        name: string;
        phone: string | null;
        employee_no: string | null;
        province: string | null;
        channel: string | null;
        current_level_id: string;
        current_team_id: string | null;
      }>(
        `
          select
            a.id,
            a.user_id,
            u.username,
            u.status as user_status,
            a.name,
            a.phone,
            a.employee_no,
            a.province,
            a.channel,
            a.current_level_id,
            a.current_team_id
          from agents a
          join users u on u.id = a.user_id
          where a.id = $1
        `,
        [agentId],
      );
      await writeAuditLog(app.db, {
        actorUserId: request.user.sub,
        actorRole: "ADMIN",
        action: "AGENT_UPDATE",
        entityType: "agents",
        entityId: agentId,
        before: before.rows[0] ?? { id: agentId },
        after: after.rows[0] ?? { id: agentId },
        meta: { passwordChanged: b.password !== undefined },
      });

      await app.db.query("commit");
      return reply.send({ ok: true });
    } catch (err) {
      await app.db.query("rollback");
      throw err;
    }
  });

  app.delete("/agents/:id", async (request, reply) => {
    const agentId = String((request.params as any).id ?? "");
    if (!agentId) return reply.code(400).send({ error: "BAD_REQUEST" });

    await app.db.query("begin");
    try {
      const agent = await assertAgentExists(app, agentId);
      if (!agent) {
        await app.db.query("rollback");
        return reply.code(404).send({ error: "NOT_FOUND" });
      }

      const before = await app.db.query(
        `
          select
            a.id,
            a.user_id,
            u.username,
            u.status as user_status,
            a.name,
            a.phone,
            a.employee_no,
            a.province,
            a.channel,
            a.current_level_id,
            a.current_team_id,
            a.created_at
          from agents a
          join users u on u.id = a.user_id
          where a.id = $1
          limit 1
        `,
        [agentId],
      );

      const teamLeader = await app.db.query<{ id: string }>("select id from teams where leader_agent_id = $1 limit 1", [agentId]);
      if (teamLeader.rows[0]) {
        await app.db.query("rollback");
        return reply.code(409).send({ error: "AGENT_IS_TEAM_LEADER" });
      }

      const activeDownline = await app.db.query<{ id: string }>(
        "select id from agent_relations where upline_agent_id = $1 and end_at is null limit 1",
        [agentId],
      );
      if (activeDownline.rows[0]) {
        await app.db.query("rollback");
        return reply.code(409).send({ error: "AGENT_HAS_ACTIVE_DOWNLINES" });
      }

      const hasCards = await app.db.query<{ id: string }>(
        "select id from card_assignments where owner_agent_id = $1 limit 1",
        [agentId],
      );
      if (hasCards.rows[0]) {
        await app.db.query("rollback");
        return reply.code(409).send({ error: "AGENT_HAS_CARDS" });
      }

      const hasSettlementItems = await app.db.query<{ id: string }>(
        "select id from settlement_items where beneficiary_agent_id = $1 limit 1",
        [agentId],
      );
      if (hasSettlementItems.rows[0]) {
        await app.db.query("rollback");
        return reply.code(409).send({ error: "AGENT_HAS_SETTLEMENT_ITEMS" });
      }

      const hasLedgerLines = await app.db.query<{ id: string }>(
        "select id from ledger_entry_lines where beneficiary_agent_id = $1 limit 1",
        [agentId],
      );
      if (hasLedgerLines.rows[0]) {
        await app.db.query("rollback");
        return reply.code(409).send({ error: "AGENT_HAS_LEDGER_LINES" });
      }

      const delRelations = await app.db.query("delete from agent_relations where agent_id = $1 or upline_agent_id = $1", [agentId]);
      const delMemberships = await app.db.query("delete from team_memberships where agent_id = $1", [agentId]);
      const delHistories = await app.db.query("delete from agent_level_histories where agent_id = $1", [agentId]);
      const delAgent = await app.db.query("delete from agents where id = $1", [agentId]);
      if ((delAgent.rowCount ?? 0) === 0) {
        await app.db.query("rollback");
        return reply.code(404).send({ error: "NOT_FOUND" });
      }
      const delUser = await app.db.query("delete from users where id = $1", [agent.user_id]);

      await writeAuditLog(app.db, {
        actorUserId: request.user.sub,
        actorRole: "ADMIN",
        action: "AGENT_DELETE",
        entityType: "agents",
        entityId: agentId,
        before: before.rows[0] ?? { id: agentId, userId: agent.user_id },
        meta: {
          deletedRelationCount: delRelations.rowCount ?? 0,
          deletedTeamMembershipCount: delMemberships.rowCount ?? 0,
          deletedLevelHistoryCount: delHistories.rowCount ?? 0,
          deletedUserCount: delUser.rowCount ?? 0,
        },
      });

      await app.db.query("commit");
      return reply.send({
        ok: true,
        id: agentId,
      });
    } catch (err) {
      await app.db.query("rollback");
      throw err;
    }
  });

  app.get("/agents/:id/upline", async (request, reply) => {
    const agentId = String((request.params as any).id ?? "");
    if (!agentId) return reply.code(400).send({ error: "BAD_REQUEST" });

    const agent = await assertAgentExists(app, agentId);
    if (!agent) return reply.code(404).send({ error: "NOT_FOUND" });

    const r = await app.db.query<{ upline_agent_id: string; upline_name: string }>(
      `
        select
          ar.upline_agent_id,
          a.name as upline_name
        from agent_relations ar
        join agents a on a.id = ar.upline_agent_id
        where ar.agent_id = $1 and ar.end_at is null
        limit 1
      `,
      [agentId],
    );
    const row = r.rows[0];
    if (!row) return reply.send({ uplineAgentId: null });
    return reply.send({ uplineAgentId: row.upline_agent_id, uplineName: row.upline_name });
  });

  app.put("/agents/:id/upline", async (request, reply) => {
    const agentId = String((request.params as any).id ?? "");
    if (!agentId) return reply.code(400).send({ error: "BAD_REQUEST" });

    const parsed = setUplineBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "invalid payload" });
    }
    const { uplineAgentId, effectiveAt } = parsed.data;
    const transitionAt = effectiveAt ? toCstStartOfDayIso(effectiveAt) : new Date().toISOString();

    await app.db.query("begin");
    try {
      const agent = await assertAgentExists(app, agentId);
      if (!agent) {
        await app.db.query("rollback");
        return reply.code(404).send({ error: "NOT_FOUND" });
      }

      const existing = await app.db.query<{ id: string; upline_agent_id: string; start_at: string }>(
        "select id, upline_agent_id, start_at::text as start_at from agent_relations where agent_id = $1 and end_at is null limit 1",
        [agentId],
      );
      const ex = existing.rows[0];

      if (uplineAgentId === null) {
        if (ex) {
          const exStart = new Date(ex.start_at);
          const at = new Date(transitionAt);
          if (Number.isNaN(exStart.getTime()) || Number.isNaN(at.getTime())) {
            await app.db.query("rollback");
            return reply.code(400).send({ error: "BAD_REQUEST", message: "invalid upline transition time" });
          }

          const before = await app.db.query(
            "select id, agent_id, upline_agent_id, start_at, end_at, created_by, created_at from agent_relations where id = $1",
            [ex.id],
          );

          if (at.getTime() <= exStart.getTime()) {
            await app.db.query("delete from agent_relations where id = $1", [ex.id]);
            await writeAuditLog(app.db, {
              actorUserId: request.user.sub,
              actorRole: "ADMIN",
              action: "AGENT_UPLINE_CLEAR",
              entityType: "agent_relations",
              entityId: ex.id,
              before: before.rows[0] ?? { id: ex.id },
              meta: { agentId, effectiveAt: transitionAt, deletedBeforeStart: true },
            });
          } else {
            await app.db.query("update agent_relations set end_at = $2 where id = $1", [ex.id, transitionAt]);
            const after = await app.db.query(
              "select id, agent_id, upline_agent_id, start_at, end_at, created_by, created_at from agent_relations where id = $1",
              [ex.id],
            );
            await writeAuditLog(app.db, {
              actorUserId: request.user.sub,
              actorRole: "ADMIN",
              action: "AGENT_UPLINE_CLEAR",
              entityType: "agent_relations",
              entityId: ex.id,
              before: before.rows[0] ?? { id: ex.id },
              after: after.rows[0] ?? { id: ex.id },
              meta: { agentId, effectiveAt: transitionAt },
            });
          }
        }
        await app.db.query("commit");
        return reply.send({ ok: true });
      }

      if (uplineAgentId === agentId) {
        await app.db.query("rollback");
        return reply.code(400).send({ error: "SELF_UPLINE" });
      }

      if (ex && ex.upline_agent_id === uplineAgentId) {
        if (effectiveAt) {
          const exStart = new Date(ex.start_at);
          const at = new Date(transitionAt);
          if (Number.isNaN(exStart.getTime()) || Number.isNaN(at.getTime())) {
            await app.db.query("rollback");
            return reply.code(400).send({ error: "BAD_REQUEST", message: "invalid upline transition time" });
          }

          if (at.getTime() < exStart.getTime()) {
            const before = await app.db.query(
              "select id, agent_id, upline_agent_id, start_at, end_at, created_by, created_at from agent_relations where id = $1",
              [ex.id],
            );
            await app.db.query("update agent_relations set start_at = $2 where id = $1", [ex.id, transitionAt]);
            const after = await app.db.query(
              "select id, agent_id, upline_agent_id, start_at, end_at, created_by, created_at from agent_relations where id = $1",
              [ex.id],
            );
            await writeAuditLog(app.db, {
              actorUserId: request.user.sub,
              actorRole: "ADMIN",
              action: "AGENT_UPLINE_SET",
              entityType: "agent_relations",
              entityId: ex.id,
              before: before.rows[0] ?? { id: ex.id },
              after: after.rows[0] ?? { id: ex.id },
              meta: { agentId, uplineAgentId, effectiveAt: transitionAt, backfilledStartAt: true },
            });
            await app.db.query("commit");
            return reply.send({ ok: true, relationId: ex.id, backfilledStartAt: true });
          }
        }
        await app.db.query("commit");
        return reply.send({ ok: true, relationId: ex.id, unchanged: true });
      }

      const upline = await app.db.query<{ id: string }>("select id from agents where id = $1 limit 1", [uplineAgentId]);
      if (!upline.rows[0]) {
        await app.db.query("rollback");
        return reply.code(400).send({ error: "UPLINE_NOT_FOUND" });
      }

      const cycle = await wouldCreateCycle(app, agentId, uplineAgentId);
      if (cycle) {
        await app.db.query("rollback");
        return reply.code(400).send({ error: "CYCLE" });
      }

      if (ex) {
        const exStart = new Date(ex.start_at);
        const at = new Date(transitionAt);
        if (Number.isNaN(exStart.getTime()) || Number.isNaN(at.getTime())) {
          await app.db.query("rollback");
          return reply.code(400).send({ error: "BAD_REQUEST", message: "invalid upline transition time" });
        }

        if (at.getTime() <= exStart.getTime()) {
          const before = await app.db.query(
            "select id, agent_id, upline_agent_id, start_at, end_at, created_by, created_at from agent_relations where id = $1",
            [ex.id],
          );
          await app.db.query("update agent_relations set upline_agent_id = $2, start_at = $3 where id = $1", [
            ex.id,
            uplineAgentId,
            transitionAt,
          ]);
          const after = await app.db.query(
            "select id, agent_id, upline_agent_id, start_at, end_at, created_by, created_at from agent_relations where id = $1",
            [ex.id],
          );
          await writeAuditLog(app.db, {
            actorUserId: request.user.sub,
            actorRole: "ADMIN",
            action: "AGENT_UPLINE_SET",
            entityType: "agent_relations",
            entityId: ex.id,
            before: before.rows[0] ?? { id: ex.id },
            after: after.rows[0] ?? { id: ex.id },
            meta: { agentId, uplineAgentId, effectiveAt: transitionAt, rewrittenBeforeStart: true },
          });
          await app.db.query("commit");
          return reply.send({ ok: true, relationId: ex.id, rewrittenBeforeStart: true });
        }

        const before = await app.db.query(
          "select id, agent_id, upline_agent_id, start_at, end_at, created_by, created_at from agent_relations where id = $1",
          [ex.id],
        );
        await app.db.query("update agent_relations set end_at = $2 where id = $1", [ex.id, transitionAt]);
        const after = await app.db.query(
          "select id, agent_id, upline_agent_id, start_at, end_at, created_by, created_at from agent_relations where id = $1",
          [ex.id],
        );
        await writeAuditLog(app.db, {
          actorUserId: request.user.sub,
          actorRole: "ADMIN",
          action: "AGENT_UPLINE_TRANSFER_END",
          entityType: "agent_relations",
          entityId: ex.id,
          before: before.rows[0] ?? { id: ex.id },
          after: after.rows[0] ?? { id: ex.id },
          meta: { agentId, effectiveAt: transitionAt },
        });
      }

      const relId = randomUUID();
      await app.db.query(
        `insert into agent_relations (id, agent_id, upline_agent_id, start_at, created_by)
         values ($1, $2, $3, $4, $5)`,
        [relId, agentId, uplineAgentId, transitionAt, request.user.sub],
      );
      const after = await app.db.query(
        "select id, agent_id, upline_agent_id, start_at, end_at, created_by, created_at from agent_relations where id = $1",
        [relId],
      );
      await writeAuditLog(app.db, {
        actorUserId: request.user.sub,
        actorRole: "ADMIN",
        action: "AGENT_UPLINE_SET",
        entityType: "agent_relations",
        entityId: relId,
        after: after.rows[0] ?? { id: relId },
        meta: { agentId, uplineAgentId, effectiveAt: transitionAt },
      });

      await app.db.query("commit");
      return reply.send({ ok: true });
    } catch (err) {
      await app.db.query("rollback");
      throw err;
    }
  });
};
