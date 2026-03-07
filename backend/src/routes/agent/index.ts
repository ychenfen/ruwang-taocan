import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireRole } from "../../auth/prehandlers.js";
import type { Db } from "../../db.js";
import { maskCardNo } from "../../privacy/masking.js";

type AppWithDb = Readonly<{ db: Db }>;

async function requireAgentProfile(app: AppWithDb, request: FastifyRequest, reply: FastifyReply) {
  const userId = request.user.sub;
  const r = await app.db.query<{ id: string }>("select id from agents where user_id = $1 limit 1", [userId]);
  const agentId = r.rows[0]?.id ?? null;
  if (!agentId) return reply.code(403).send({ error: "NO_AGENT_PROFILE" });
  request.agentId = agentId;
}

export const agentRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireRole("AGENT"));
  app.addHook("preHandler", async (request, reply) => {
    if (reply.sent) return;
    await requireAgentProfile(app, request, reply);
  });

  app.get("/me", async (request) => {
    const agentId = request.agentId!;
    const r = await app.db.query<{
      id: string;
      name: string;
      phone: string | null;
      employee_no: string | null;
      province: string | null;
      channel: string | null;
      current_level_id: string;
      level_name: string;
      current_team_id: string | null;
      team_name: string | null;
    }>(
      `
        select
          a.id,
          a.name,
          a.phone,
          a.employee_no,
          a.province,
          a.channel,
          a.current_level_id,
          al.name as level_name,
          a.current_team_id,
          t.name as team_name
        from agents a
        join agent_levels al on al.id = a.current_level_id
        left join teams t on t.id = a.current_team_id
        where a.id = $1
        limit 1
      `,
      [agentId],
    );
    const a = r.rows[0]!;
    return {
      id: a.id,
      name: a.name,
      phone: a.phone ?? undefined,
      employeeNo: a.employee_no ?? undefined,
      province: a.province ?? undefined,
      channel: a.channel ?? undefined,
      levelId: a.current_level_id,
      levelName: a.level_name,
      teamId: a.current_team_id ?? undefined,
      teamName: a.team_name ?? undefined,
    };
  });

  app.get("/stats", async (request) => {
    const agentId = request.agentId!;

    const me = await app.db.query<{
      id: string;
      name: string;
      level_name: string;
      current_team_id: string | null;
      team_name: string | null;
    }>(
      `
        select
          a.id,
          a.name,
          al.name as level_name,
          a.current_team_id,
          t.name as team_name
        from agents a
        join agent_levels al on al.id = a.current_level_id
        left join teams t on t.id = a.current_team_id
        where a.id = $1
        limit 1
      `,
      [agentId],
    );

    const myOnNet = await app.db.query<{ cnt: string | number }>(
      `
        select count(*) as cnt
        from card_assignments ca
        join cards c on c.id = ca.card_id
        join lateral (
          select e.status
          from card_status_events e
          where e.card_id = c.id
          order by e.happened_at desc, e.created_at desc, e.id desc
          limit 1
        ) s on true
        where ca.end_at is null
          and ca.owner_agent_id = $1
          and s.status = 'NORMAL'
      `,
      [agentId],
    );

    const downlineCounts = await app.db.query<{ lvl1_cnt: string | number; lvl2_cnt: string | number }>(
      `
        with lvl1 as (
          select r.agent_id
          from agent_relations r
          where r.upline_agent_id = $1 and r.end_at is null
        ),
        lvl2 as (
          select r.agent_id
          from agent_relations r
          join lvl1 on lvl1.agent_id = r.upline_agent_id
          where r.end_at is null
        )
        select
          (select count(*) from lvl1) as lvl1_cnt,
          (select count(*) from lvl2) as lvl2_cnt
      `,
      [agentId],
    );

    const teamId = me.rows[0]?.current_team_id ?? null;
    if (!teamId) {
      return {
        me: {
          id: me.rows[0]?.id ?? agentId,
          name: me.rows[0]?.name ?? "",
          levelName: me.rows[0]?.level_name ?? "",
          teamName: undefined,
        },
        myOnNetCardCount: Number(myOnNet.rows[0]?.cnt ?? 0),
        downlineLevel1Count: Number(downlineCounts.rows[0]?.lvl1_cnt ?? 0),
        downlineLevel2Count: Number(downlineCounts.rows[0]?.lvl2_cnt ?? 0),
        teamMemberCount: 0,
        teamOnNetCardCount: 0,
      };
    }

    const [teamMembers, teamOnNet] = await Promise.all([
      app.db.query<{ cnt: string | number }>(
        `
          select count(*) as cnt
          from team_memberships tm
          where tm.team_id = $1 and tm.end_at is null
        `,
        [teamId],
      ),
      app.db.query<{ cnt: string | number }>(
        `
          select count(*) as cnt
          from team_memberships tm
          join card_assignments ca on ca.owner_agent_id = tm.agent_id and ca.end_at is null
          join cards c on c.id = ca.card_id
          join lateral (
            select e.status
            from card_status_events e
            where e.card_id = c.id
            order by e.happened_at desc, e.created_at desc, e.id desc
            limit 1
          ) s on true
          where tm.team_id = $1 and tm.end_at is null and s.status = 'NORMAL'
        `,
        [teamId],
      ),
    ]);

    return {
      me: {
        id: me.rows[0]?.id ?? agentId,
        name: me.rows[0]?.name ?? "",
        levelName: me.rows[0]?.level_name ?? "",
        teamName: me.rows[0]?.team_name ?? undefined,
      },
      myOnNetCardCount: Number(myOnNet.rows[0]?.cnt ?? 0),
      downlineLevel1Count: Number(downlineCounts.rows[0]?.lvl1_cnt ?? 0),
      downlineLevel2Count: Number(downlineCounts.rows[0]?.lvl2_cnt ?? 0),
      teamMemberCount: Number(teamMembers.rows[0]?.cnt ?? 0),
      teamOnNetCardCount: Number(teamOnNet.rows[0]?.cnt ?? 0),
    };
  });

  const trendQuery = z.object({
    months: z.coerce.number().int().min(1).max(24).optional(),
  });

  app.get("/stats/trends", async (request, reply) => {
    const agentId = request.agentId!;
    const parsed = trendQuery.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const months = parsed.data.months ?? 6;

    const r = await app.db.query<{
      commission_month: string;
      run_status: "DRAFT" | "APPROVED" | "POSTED";
      line_count: string | number;
      adjustment_line_count: string | number;
      total_amount: string | number;
    }>(
      `
        select
          sr.commission_month,
          sr.status as run_status,
          count(si.id) as line_count,
          sum(case when si.kind = 'ADJUSTMENT' then 1 else 0 end) as adjustment_line_count,
          coalesce(sum(si.amount), 0) as total_amount
        from settlement_runs sr
        left join settlement_items si
          on si.settlement_run_id = sr.id
          and si.beneficiary_agent_id = $1
        group by sr.id, sr.commission_month, sr.status
        order by sr.commission_month desc
        limit $2
      `,
      [agentId, months],
    );

    const list = r.rows
      .map((x) => ({
        commissionMonth: x.commission_month,
        runStatus: x.run_status,
        lineCount: Number(x.line_count),
        adjustmentLineCount: Number(x.adjustment_line_count),
        totalAmount: Number(x.total_amount),
      }))
      // Agent trend focuses on months with actual income/adjustments.
      .filter((x) => x.lineCount > 0);

    return list.reverse();
  });

  // My colleagues: level-1 and level-2 downlines.
  app.get("/downlines", async (request) => {
    const agentId = request.agentId!;

    const selfLevel = await app.db.query<{ support_rate: string | number; stable_rate: string | number }>(
      `
        select al.support_rate, al.stable_rate
        from agents a
        join agent_levels al on al.id = a.current_level_id
        where a.id = $1
        limit 1
      `,
      [agentId],
    );
    const selfSupportRate = Number(selfLevel.rows[0]?.support_rate ?? 0);
    const selfStableRate = Number(selfLevel.rows[0]?.stable_rate ?? 0);

    const lvl1 = await app.db.query<{
      agent_id: string;
      name: string;
      employee_no: string | null;
      level_id: string;
      level_name: string;
      support_rate: string | number;
      stable_rate: string | number;
    }>(
      `
        select
          a.id as agent_id,
          a.name,
          a.employee_no,
          a.current_level_id as level_id,
          al.name as level_name,
          al.support_rate,
          al.stable_rate
        from agent_relations r
        join agents a on a.id = r.agent_id
        join agent_levels al on al.id = a.current_level_id
        where r.upline_agent_id = $1 and r.end_at is null
        order by a.created_at asc
      `,
      [agentId],
    );

    const lvl2 = await app.db.query<{
      agent_id: string;
      name: string;
      employee_no: string | null;
      level_id: string;
      level_name: string;
      direct_upline_id: string;
      support_rate: string | number;
      stable_rate: string | number;
    }>(
      `
        select
          a2.id as agent_id,
          a2.name,
          a2.employee_no,
          a2.current_level_id as level_id,
          al2.name as level_name,
          r2.upline_agent_id as direct_upline_id,
          al2.support_rate,
          al2.stable_rate
        from agent_relations r1
        join agent_relations r2 on r2.upline_agent_id = r1.agent_id and r2.end_at is null
        join agents a2 on a2.id = r2.agent_id
        join agent_levels al2 on al2.id = a2.current_level_id
        where r1.upline_agent_id = $1 and r1.end_at is null
        order by a2.created_at asc
      `,
      [agentId],
    );

    const allIds = Array.from(new Set([...lvl1.rows.map((x) => x.agent_id), ...lvl2.rows.map((x) => x.agent_id)]));
    const counts: Record<string, number> = {};
    if (allIds.length > 0) {
      const placeholders = allIds.map((_, i) => `$${i + 1}`).join(", ");
      const qr = await app.db.query<{ agent_id: string; cnt: string | number }>(
        `
          select
            ca.owner_agent_id as agent_id,
            count(*) as cnt
          from card_assignments ca
          join cards c on c.id = ca.card_id
          join lateral (
            select e.status
            from card_status_events e
            where e.card_id = c.id
            order by e.happened_at desc, e.created_at desc, e.id desc
            limit 1
          ) s on true
          where ca.end_at is null
            and ca.owner_agent_id in (${placeholders})
            and s.status = 'NORMAL'
          group by ca.owner_agent_id
        `,
        allIds,
      );
      for (const row of qr.rows) counts[row.agent_id] = Number(row.cnt);
    }

    const lvl1ById: Record<string, { supportRate: number; stableRate: number }> = {};
    for (const x of lvl1.rows) {
      lvl1ById[x.agent_id] = { supportRate: Number(x.support_rate), stableRate: Number(x.stable_rate) };
    }

    return [
      ...lvl1.rows.map((x) => ({
        level: 1,
        agentId: x.agent_id,
        name: x.name,
        employeeNo: x.employee_no ?? undefined,
        levelId: x.level_id,
        levelName: x.level_name,
        onNetCardCount: counts[x.agent_id] ?? 0,
        supportDiffRate: Math.max(selfSupportRate - Number(x.support_rate), 0),
        stableDiffRate: Math.max(selfStableRate - Number(x.stable_rate), 0),
      })),
      ...lvl2.rows.map((x) => ({
        level: 2,
        agentId: x.agent_id,
        name: x.name,
        employeeNo: x.employee_no ?? undefined,
        levelId: x.level_id,
        levelName: x.level_name,
        onNetCardCount: counts[x.agent_id] ?? 0,
        supportDiffRate: Math.max(selfSupportRate - Math.max(lvl1ById[x.direct_upline_id]?.supportRate ?? 0, Number(x.support_rate)), 0),
        stableDiffRate: Math.max(selfStableRate - Math.max(lvl1ById[x.direct_upline_id]?.stableRate ?? 0, Number(x.stable_rate)), 0),
      })),
    ];
  });

  // Team members: fixed label "团队：{姓名}" is frontend text, but we expose a ready-to-render field.
  app.get("/team-members", async (request) => {
    const agentId = request.agentId!;
    const ar = await app.db.query<{ current_team_id: string | null }>("select current_team_id from agents where id = $1", [
      agentId,
    ]);
    const teamId = ar.rows[0]?.current_team_id ?? null;
    if (!teamId) return [];

    const members = await app.db.query<{
      agent_id: string;
      name: string;
      level_id: string;
      level_name: string;
    }>(
      `
        select
          a.id as agent_id,
          a.name,
          a.current_level_id as level_id,
          al.name as level_name
        from team_memberships tm
        join agents a on a.id = tm.agent_id
        join agent_levels al on al.id = a.current_level_id
        where tm.team_id = $1 and tm.end_at is null
        order by tm.start_at asc
      `,
      [teamId],
    );

    const allIds = members.rows.map((x) => x.agent_id);
    const counts: Record<string, number> = {};
    if (allIds.length > 0) {
      const placeholders = allIds.map((_, i) => `$${i + 1}`).join(", ");
      const qr = await app.db.query<{ agent_id: string; cnt: string | number }>(
        `
          select
            ca.owner_agent_id as agent_id,
            count(*) as cnt
          from card_assignments ca
          join cards c on c.id = ca.card_id
          join lateral (
            select e.status
            from card_status_events e
            where e.card_id = c.id
            order by e.happened_at desc, e.created_at desc, e.id desc
            limit 1
          ) s on true
          where ca.end_at is null
            and ca.owner_agent_id in (${placeholders})
            and s.status = 'NORMAL'
          group by ca.owner_agent_id
        `,
        allIds,
      );
      for (const row of qr.rows) counts[row.agent_id] = Number(row.cnt);
    }

    return members.rows.map((x) => ({
      agentId: x.agent_id,
      name: x.name,
      teamLabel: `团队：${x.name}`,
      levelId: x.level_id,
      levelName: x.level_name,
      onNetCardCount: counts[x.agent_id] ?? 0,
    }));
  });

  const listCardsQuery = z.object({
    onNetOnly: z
      .union([z.literal("true"), z.literal("false")])
      .optional()
      .transform((v) => (v ?? "true") === "true"),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  });

  app.get("/cards", async (request, reply) => {
    const agentId = request.agentId!;
    const parsed = listCardsQuery.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const q = parsed.data;

    const limit = q.limit ?? 200;
    const offset = q.offset ?? 0;
	    const r = await app.db.query<{
	      id: string;
	      card_no: string;
	      activated_at: string;
      plan_id: string;
      plan_name: string;
      monthly_rent: string | number;
      policy_id: string | null;
      policy_name: string | null;
      current_status: string | null;
      current_status_at: string | null;
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
	          s.status as current_status,
	          s.happened_at::text as current_status_at
	        from card_assignments ca
	        join cards c on c.id = ca.card_id
	        join plans p on p.id = c.plan_id
	        left join policies pol on pol.id = c.policy_id
		        join lateral (
		          select e.status, e.happened_at
		          from card_status_events e
		          where e.card_id = c.id
		          order by e.happened_at desc, e.created_at desc, e.id desc
		          limit 1
		        ) s on true
	        where ca.end_at is null and ca.owner_agent_id = $1
	          ${q.onNetOnly ? "and s.status = 'NORMAL'" : ""}
        order by c.created_at asc
        limit $2
        offset $3
      `,
      [agentId, limit, offset],
    );

    return r.rows.map((x) => ({
      id: x.id,
      cardNo: x.card_no,
      activatedAt: x.activated_at,
      planId: x.plan_id,
      planName: x.plan_name,
      monthlyRent: Number(x.monthly_rent),
      policyId: x.policy_id ?? undefined,
      policyName: x.policy_name ?? undefined,
      currentStatus: x.current_status ?? undefined,
      currentStatusAt: x.current_status_at ?? undefined,
    }));
  });

  app.get("/team/cards", async (request, reply) => {
    const agentId = request.agentId!;
    const parsed = listCardsQuery.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const q = parsed.data;

    const ar = await app.db.query<{ current_team_id: string | null }>("select current_team_id from agents where id = $1", [
      agentId,
    ]);
    const teamId = ar.rows[0]?.current_team_id ?? null;
    if (!teamId) return [];

    const limit = q.limit ?? 200;
    const offset = q.offset ?? 0;

	    const r = await app.db.query<{
	      id: string;
	      owner_agent_id: string;
	      owner_name: string;
	      card_no: string;
	      activated_at: string;
      plan_id: string;
      plan_name: string;
      monthly_rent: string | number;
      policy_id: string | null;
      policy_name: string | null;
      current_status: string;
      current_status_at: string;
    }>(
      `
	        select
	          c.id,
	          ca.owner_agent_id,
	          a.name as owner_name,
	          c.card_no,
	          c.activated_at::text as activated_at,
	          c.plan_id,
	          p.name as plan_name,
	          p.monthly_rent,
	          c.policy_id,
	          pol.name as policy_name,
	          s.status as current_status,
	          s.happened_at::text as current_status_at
	        from team_memberships tm
	        join agents a on a.id = tm.agent_id
	        join card_assignments ca on ca.owner_agent_id = a.id and ca.end_at is null
	        join cards c on c.id = ca.card_id
        join plans p on p.id = c.plan_id
        left join policies pol on pol.id = c.policy_id
		        join lateral (
		          select e.status, e.happened_at
		          from card_status_events e
		          where e.card_id = c.id
		          order by e.happened_at desc, e.created_at desc, e.id desc
		          limit 1
		        ) s on true
	        where tm.team_id = $1 and tm.end_at is null
	          ${q.onNetOnly ? "and s.status = 'NORMAL'" : ""}
        order by c.created_at asc
        limit $2
        offset $3
      `,
      [teamId, limit, offset],
    );

    return r.rows.map((x) => {
      const isOwn = x.owner_agent_id === agentId;
      return {
        id: x.id,
        ownerAgentId: x.owner_agent_id,
        ownerName: x.owner_name,
        teamLabel: `团队：${x.owner_name}`,
        cardNo: isOwn ? x.card_no : maskCardNo(x.card_no),
        isOwn,
        activatedAt: x.activated_at,
        planId: x.plan_id,
        planName: x.plan_name,
        monthlyRent: Number(x.monthly_rent),
        policyId: x.policy_id ?? undefined,
        policyName: x.policy_name ?? undefined,
        currentStatus: x.current_status,
        currentStatusAt: x.current_status_at,
      };
    });
  });

  const downlineCardsQuery = listCardsQuery.extend({
    level: z.union([z.literal("1"), z.literal("2")]).optional(),
    agentId: z.string().min(1).optional(),
    agentKeyword: z.string().min(1).optional(),
  });

  // Downlines' cards (<= 2 levels). Card numbers are always masked.
  app.get("/downlines/cards", async (request, reply) => {
    const agentId = request.agentId!;
    const parsed = downlineCardsQuery.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "invalid query" });
    }
    const q = parsed.data;

    const lvl1 = await app.db.query<{ agent_id: string; name: string; employee_no: string | null }>(
      `
        select a.id as agent_id, a.name, a.employee_no
        from agent_relations r
        join agents a on a.id = r.agent_id
        where r.upline_agent_id = $1 and r.end_at is null
      `,
      [agentId],
    );
    const lvl1Ids = lvl1.rows.map((x) => x.agent_id);

    const lvl2 = await (async () => {
      if (lvl1Ids.length === 0) return [] as { agent_id: string; name: string; employee_no: string | null }[];
      const placeholders = lvl1Ids.map((_, i) => `$${i + 1}`).join(", ");
      const r = await app.db.query<{ agent_id: string; name: string; employee_no: string | null }>(
        `
          select a.id as agent_id, a.name, a.employee_no
          from agent_relations r
          join agents a on a.id = r.agent_id
          where r.upline_agent_id in (${placeholders}) and r.end_at is null
        `,
        lvl1Ids,
      );
      return r.rows;
    })();

    const allowed: Array<{ agentId: string; downlineLevel: 1 | 2; name: string; employeeNo: string }> = [
      ...lvl1.rows.map((x) => ({
        agentId: x.agent_id,
        downlineLevel: 1 as const,
        name: x.name,
        employeeNo: x.employee_no ?? "",
      })),
      ...lvl2.map((x) => ({
        agentId: x.agent_id,
        downlineLevel: 2 as const,
        name: x.name,
        employeeNo: x.employee_no ?? "",
      })),
    ];

    if (q.agentId && !allowed.some((x) => x.agentId === q.agentId)) {
      return reply.code(403).send({ error: "FORBIDDEN" });
    }

    const filtered = allowed.filter((x) => {
      if (q.level && String(x.downlineLevel) !== q.level) return false;
      if (q.agentId && x.agentId !== q.agentId) return false;
      if (q.agentKeyword) {
        const keyword = q.agentKeyword.trim().toLowerCase();
        const name = x.name.toLowerCase();
        const employeeNo = x.employeeNo.toLowerCase();
        if (!name.includes(keyword) && !employeeNo.includes(keyword)) return false;
      }
      return true;
    });

    const scopeIds = filtered.map((x) => x.agentId);
    if (scopeIds.length === 0) return [];

    const limit = q.limit ?? 200;
    const offset = q.offset ?? 0;

    const placeholders = scopeIds.map((_, i) => `$${i + 1}`).join(", ");
	    const r = await app.db.query<{
	      id: string;
	      owner_agent_id: string;
	      card_no: string;
	      activated_at: string;
      plan_id: string;
      plan_name: string;
      monthly_rent: string | number;
      policy_id: string | null;
      policy_name: string | null;
      current_status: string;
      current_status_at: string;
    }>(
      `
	        select
	          c.id,
	          ca.owner_agent_id,
	          c.card_no,
	          c.activated_at::text as activated_at,
	          c.plan_id,
	          p.name as plan_name,
	          p.monthly_rent,
	          c.policy_id,
	          pol.name as policy_name,
	          s.status as current_status,
	          s.happened_at::text as current_status_at
	        from card_assignments ca
	        join cards c on c.id = ca.card_id
	        join plans p on p.id = c.plan_id
	        left join policies pol on pol.id = c.policy_id
		        join lateral (
		          select e.status, e.happened_at
		          from card_status_events e
		          where e.card_id = c.id
		          order by e.happened_at desc, e.created_at desc, e.id desc
		          limit 1
		        ) s on true
	        where ca.end_at is null
	          and ca.owner_agent_id in (${placeholders})
	          ${q.onNetOnly ? "and s.status = 'NORMAL'" : ""}
        order by c.created_at asc
        limit $${scopeIds.length + 1}
        offset $${scopeIds.length + 2}
      `,
      [...scopeIds, limit, offset],
    );

    const downlineByAgentId: Record<string, { downlineLevel: 1 | 2; name: string }> = {};
    for (const x of filtered) downlineByAgentId[x.agentId] = { downlineLevel: x.downlineLevel, name: x.name };

    return r.rows.map((x) => ({
      id: x.id,
      ownerAgentId: x.owner_agent_id,
      ownerName: downlineByAgentId[x.owner_agent_id]?.name ?? "",
      downlineLevel: downlineByAgentId[x.owner_agent_id]?.downlineLevel ?? 0,
      cardNo: maskCardNo(x.card_no),
      activatedAt: x.activated_at,
      planId: x.plan_id,
      planName: x.plan_name,
      monthlyRent: Number(x.monthly_rent),
      policyId: x.policy_id ?? undefined,
      policyName: x.policy_name ?? undefined,
      currentStatus: x.current_status,
      currentStatusAt: x.current_status_at,
    }));
  });

  app.get("/announcements", async () => {
    const r = await app.db.query<{
      id: string;
      title: string;
      body: string;
      starts_at: string;
      ends_at: string | null;
      created_at: string;
    }>(
      `
        select id, title, body, starts_at, ends_at, created_at
        from announcements
        where status = 'ACTIVE'
          and starts_at <= now()
          and (ends_at is null or ends_at > now())
        order by starts_at desc, created_at desc
      `,
    );
    return r.rows.map((x) => ({
      id: x.id,
      title: x.title,
      body: x.body,
      startsAt: x.starts_at,
      endsAt: x.ends_at ?? undefined,
      createdAt: x.created_at,
    }));
  });
};
