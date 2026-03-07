import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { requireRole } from "../../auth/prehandlers.js";
import { writeAuditLog } from "../../audit/log.js";

const teamBody = z.object({
  name: z.string().min(1),
  tag: z.string().min(1).optional(),
  leaderAgentId: z.string().min(1).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});

const addMemberBody = z.object({
  agentId: z.string().min(1),
});

export const adminTeamRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireRole("ADMIN"));

  app.get("/teams", async () => {
    const r = await app.db.query<{
      id: string;
      name: string;
      tag: string | null;
      leader_agent_id: string | null;
      status: "ACTIVE" | "DISABLED";
      created_at: string;
      leader_name: string | null;
      active_member_count: string | number;
    }>(`
      select
        t.id,
        t.name,
        t.tag,
        t.leader_agent_id,
        t.status,
        t.created_at,
        a.name as leader_name,
        (
          select count(*) from team_memberships tm
          where tm.team_id = t.id and tm.end_at is null
        ) as active_member_count
      from teams t
      left join agents a on a.id = t.leader_agent_id
      order by t.created_at asc
    `);

    return r.rows.map((x) => ({
      id: x.id,
      name: x.name,
      tag: x.tag ?? undefined,
      leaderAgentId: x.leader_agent_id ?? undefined,
      leaderName: x.leader_name ?? undefined,
      status: x.status,
      createdAt: x.created_at,
      activeMemberCount: Number(x.active_member_count),
    }));
  });

  app.post("/teams", async (request, reply) => {
    const parsed = teamBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });

    const b = parsed.data;
    if (b.leaderAgentId) {
      const exists = await app.db.query<{ id: string }>("select id from agents where id = $1 limit 1", [
        b.leaderAgentId,
      ]);
      if (!exists.rows[0]) return reply.code(400).send({ error: "LEADER_NOT_FOUND" });
    }

    const id = randomUUID();
    await app.db.query(
      `insert into teams (id, name, tag, leader_agent_id, status, created_at)
       values ($1, $2, $3, $4, $5, now())`,
      [id, b.name, b.tag ?? null, b.leaderAgentId ?? null, b.status ?? "ACTIVE"],
    );
    const after = await app.db.query(
      "select id, name, tag, leader_agent_id, status from teams where id = $1",
      [id],
    );
    await writeAuditLog(app.db, {
      actorUserId: request.user.sub,
      actorRole: "ADMIN",
      action: "TEAM_CREATE",
      entityType: "teams",
      entityId: id,
      after: after.rows[0] ?? { id },
    });
    return reply.code(201).send({ id });
  });

  app.put("/teams/:id", async (request, reply) => {
    const id = String((request.params as any).id ?? "");
    if (!id) return reply.code(400).send({ error: "BAD_REQUEST" });

    const parsed = teamBody.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const b = parsed.data;

    const before = await app.db.query(
      "select id, name, tag, leader_agent_id, status from teams where id = $1 limit 1",
      [id],
    );
    const ex = before.rows[0];
    if (!ex) return reply.code(404).send({ error: "NOT_FOUND" });

    if (b.leaderAgentId !== undefined && b.leaderAgentId !== null) {
      if (b.leaderAgentId.length === 0) return reply.code(400).send({ error: "BAD_REQUEST" });
      const exists = await app.db.query<{ id: string }>("select id from agents where id = $1 limit 1", [
        b.leaderAgentId,
      ]);
      if (!exists.rows[0]) return reply.code(400).send({ error: "LEADER_NOT_FOUND" });
    }

    const sets: string[] = [];
    const vals: any[] = [];
    const push = (col: string, v: any) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (b.name !== undefined) push("name", b.name);
    if (b.tag !== undefined) push("tag", b.tag);
    if (b.status !== undefined) push("status", b.status);
    if (b.leaderAgentId !== undefined) push("leader_agent_id", b.leaderAgentId ?? null);
    if (sets.length === 0) return reply.code(400).send({ error: "NO_CHANGES" });

    vals.push(id);
    const q = `update teams set ${sets.join(", ")} where id = $${vals.length}`;
    const res = await app.db.query(q, vals);
    if (res.rowCount === 0) return reply.code(404).send({ error: "NOT_FOUND" });

    const after = await app.db.query("select id, name, tag, leader_agent_id, status from teams where id = $1", [id]);
    await writeAuditLog(app.db, {
      actorUserId: request.user.sub,
      actorRole: "ADMIN",
      action: "TEAM_UPDATE",
      entityType: "teams",
      entityId: id,
      before: ex,
      after: after.rows[0] ?? { id },
    });
    return reply.send({ ok: true });
  });

  app.delete("/teams/:id", async (request, reply) => {
    const id = String((request.params as any).id ?? "");
    if (!id) return reply.code(400).send({ error: "BAD_REQUEST" });

    const before = await app.db.query(
      "select id, name, tag, leader_agent_id, status from teams where id = $1 limit 1",
      [id],
    );
    const ex = before.rows[0];
    if (!ex) return reply.code(404).send({ error: "NOT_FOUND" });

    const activeMembers = await app.db.query<{ id: string }>(
      "select id from team_memberships where team_id = $1 and end_at is null limit 1",
      [id],
    );
    if (activeMembers.rows[0]) return reply.code(409).send({ error: "TEAM_HAS_ACTIVE_MEMBERS" });

    const anyMembership = await app.db.query<{ id: string }>(
      "select id from team_memberships where team_id = $1 limit 1",
      [id],
    );
    if (anyMembership.rows[0]) return reply.code(409).send({ error: "TEAM_HAS_MEMBERSHIP_HISTORY" });

    const usedByAgent = await app.db.query<{ id: string }>(
      "select id from agents where current_team_id = $1 limit 1",
      [id],
    );
    if (usedByAgent.rows[0]) return reply.code(409).send({ error: "TEAM_IN_USE_BY_AGENT" });

    const del = await app.db.query("delete from teams where id = $1", [id]);
    if (del.rowCount === 0) return reply.code(404).send({ error: "NOT_FOUND" });

    await writeAuditLog(app.db, {
      actorUserId: request.user.sub,
      actorRole: "ADMIN",
      action: "TEAM_DELETE",
      entityType: "teams",
      entityId: id,
      before: ex,
    });
    return reply.send({ ok: true });
  });

  app.get("/teams/:id/members", async (request, reply) => {
    const id = String((request.params as any).id ?? "");
    if (!id) return reply.code(400).send({ error: "BAD_REQUEST" });

    const exists = await app.db.query<{ id: string }>("select id from teams where id = $1 limit 1", [id]);
    if (!exists.rows[0]) return reply.code(404).send({ error: "NOT_FOUND" });

    const r = await app.db.query<{
      agent_id: string;
      name: string;
      phone: string | null;
      employee_no: string | null;
      province: string | null;
      channel: string | null;
      level_id: string;
      level_name: string;
      joined_at: string;
    }>(
      `
        select
          a.id as agent_id,
          a.name,
          a.phone,
          a.employee_no,
          a.province,
          a.channel,
          a.current_level_id as level_id,
          al.name as level_name,
          tm.start_at as joined_at
        from team_memberships tm
        join agents a on a.id = tm.agent_id
        join agent_levels al on al.id = a.current_level_id
        where tm.team_id = $1 and tm.end_at is null
        order by tm.start_at asc
      `,
      [id],
    );

    return r.rows.map((x) => ({
      agentId: x.agent_id,
      name: x.name,
      phone: x.phone ?? undefined,
      employeeNo: x.employee_no ?? undefined,
      province: x.province ?? undefined,
      channel: x.channel ?? undefined,
      levelId: x.level_id,
      levelName: x.level_name,
      joinedAt: x.joined_at,
    }));
  });

  // Add or transfer an agent to a team.
  app.post("/teams/:id/members", async (request, reply) => {
    const teamId = String((request.params as any).id ?? "");
    if (!teamId) return reply.code(400).send({ error: "BAD_REQUEST" });

    const parsed = addMemberBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const { agentId } = parsed.data;

    await app.db.query("begin");
    try {
      const team = await app.db.query<{ id: string }>("select id from teams where id = $1 limit 1", [teamId]);
      if (!team.rows[0]) {
        await app.db.query("rollback");
        return reply.code(404).send({ error: "TEAM_NOT_FOUND" });
      }

      const agent = await app.db.query<{ id: string }>("select id from agents where id = $1 limit 1", [agentId]);
      if (!agent.rows[0]) {
        await app.db.query("rollback");
        return reply.code(404).send({ error: "AGENT_NOT_FOUND" });
      }

      const existing = await app.db.query<{ id: string; team_id: string }>(
        "select id, team_id from team_memberships where agent_id = $1 and end_at is null limit 1",
        [agentId],
      );
      const ex = existing.rows[0];
      if (ex && ex.team_id === teamId) {
        await app.db.query("commit");
        return reply.send({ ok: true, membershipId: ex.id });
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
          actorUserId: request.user.sub,
          actorRole: "ADMIN",
          action: "TEAM_MEMBER_TRANSFER_END",
          entityType: "team_memberships",
          entityId: ex.id,
          before: before.rows[0] ?? { id: ex.id },
          after: after.rows[0] ?? { id: ex.id },
          meta: { fromTeamId: ex.team_id, toTeamId: teamId, agentId },
        });
      }

      const membershipId = randomUUID();
      await app.db.query(
        `insert into team_memberships (id, team_id, agent_id, start_at, created_by)
         values ($1, $2, $3, now(), $4)`,
        [membershipId, teamId, agentId, request.user.sub],
      );
      await app.db.query("update agents set current_team_id = $1 where id = $2", [teamId, agentId]);

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
        meta: { teamId, agentId },
      });

      await app.db.query("commit");
      return reply.code(201).send({ membershipId });
    } catch (err) {
      await app.db.query("rollback");
      throw err;
    }
  });

  // Remove an agent from a team (end the active membership).
  app.delete("/teams/:id/members/:agentId", async (request, reply) => {
    const teamId = String((request.params as any).id ?? "");
    const agentId = String((request.params as any).agentId ?? "");
    if (!teamId || !agentId) return reply.code(400).send({ error: "BAD_REQUEST" });

    await app.db.query("begin");
    try {
      const membership = await app.db.query<{ id: string }>(
        "select id from team_memberships where team_id = $1 and agent_id = $2 and end_at is null limit 1",
        [teamId, agentId],
      );
      const m = membership.rows[0];
      if (!m) {
        await app.db.query("rollback");
        return reply.code(404).send({ error: "NOT_FOUND" });
      }

      const before = await app.db.query(
        "select id, team_id, agent_id, start_at, end_at, created_by, created_at from team_memberships where id = $1",
        [m.id],
      );
      await app.db.query("update team_memberships set end_at = now() where id = $1", [m.id]);
      await app.db.query("update agents set current_team_id = null where id = $1 and current_team_id = $2", [
        agentId,
        teamId,
      ]);
      const after = await app.db.query(
        "select id, team_id, agent_id, start_at, end_at, created_by, created_at from team_memberships where id = $1",
        [m.id],
      );
      await writeAuditLog(app.db, {
        actorUserId: request.user.sub,
        actorRole: "ADMIN",
        action: "TEAM_MEMBER_REMOVE",
        entityType: "team_memberships",
        entityId: m.id,
        before: before.rows[0] ?? { id: m.id },
        after: after.rows[0] ?? { id: m.id },
        meta: { teamId, agentId },
      });

      await app.db.query("commit");
      return reply.send({ ok: true });
    } catch (err) {
      await app.db.query("rollback");
      throw err;
    }
  });
};
