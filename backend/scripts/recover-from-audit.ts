import "dotenv/config";

import { randomUUID } from "node:crypto";

import { writeAuditLog } from "../src/audit/log.js";
import { createDb, type Db } from "../src/db.js";
import { hashPassword } from "../src/security/password.js";

type AuditRow = Readonly<{
  id: string;
  action: string;
  entity_id: string | null;
  before_json: any;
  after_json: any;
  meta: any;
  created_at: string;
}>;

type AgentSnapshot = Readonly<{
  id: string;
  userId: string;
  username: string;
  userStatus: "ACTIVE" | "DISABLED";
  name: string;
  phone: string | null;
  employeeNo: string | null;
  province: string | null;
  channel: string | null;
  currentLevelId: string | null;
  currentTeamId: string | null;
  at: string;
}>;

type CardSnapshot = Readonly<{
  id: string;
  cardNo: string;
  activatedAt: string;
  planId: string | null;
  policyId: string | null;
  createdBy: string | null;
  at: string;
}>;

type AssignmentSnapshot = Readonly<{
  id: string;
  cardId: string;
  ownerAgentId: string;
  startAt: string;
  createdBy: string | null;
  at: string;
}>;

type StatusEventSnapshot = Readonly<{
  id: string;
  cardId: string;
  status: "NORMAL" | "PAUSED" | "LEFT" | "CONTROLLED" | "ABNORMAL";
  reason: string | null;
  happenedAt: string;
  createdBy: string | null;
  at: string;
}>;

type TeamMembershipSnapshot = Readonly<{
  id: string;
  teamId: string;
  agentId: string;
  startAt: string;
  createdBy: string | null;
  at: string;
}>;

type UplineSnapshot = Readonly<{
  id: string;
  agentId: string;
  uplineAgentId: string;
  startAt: string;
  createdBy: string | null;
  at: string;
}>;

type RestoreSummary = {
  createdUsers: number;
  createdAgents: number;
  updatedAgents: number;
  createdLevelHistories: number;
  createdTeamMemberships: number;
  endedTeamMemberships: number;
  createdUplines: number;
  endedUplines: number;
  createdCards: number;
  updatedCards: number;
  createdAssignments: number;
  endedAssignments: number;
  createdStatusEvents: number;
  skippedDeletedAgents: number;
  skippedDeletedCards: number;
};

function parseFlag(name: string): boolean {
  return process.argv.includes(name);
}

function toStatus(v: any): "ACTIVE" | "DISABLED" {
  return v === "DISABLED" ? "DISABLED" : "ACTIVE";
}

function asText(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function ensureUsernameUnique(existingUsernames: Set<string>, preferred: string, fallbackSeed: string): string {
  let u = preferred.trim();
  if (!u) u = `restored_${fallbackSeed.slice(0, 8)}`;
  if (!existingUsernames.has(u)) {
    existingUsernames.add(u);
    return u;
  }

  for (let i = 1; i < 10000; i += 1) {
    const cand = `${u}_${i}`;
    if (!existingUsernames.has(cand)) {
      existingUsernames.add(cand);
      return cand;
    }
  }
  const emergency = `restored_${fallbackSeed.slice(0, 8)}_${Date.now()}`;
  existingUsernames.add(emergency);
  return emergency;
}

async function fetchAuditRows(db: Db): Promise<AuditRow[]> {
  const r = await db.query<AuditRow>(
    `
      select id, action, entity_id, before_json, after_json, meta, created_at
      from audit_logs
      where action in (
        'AGENT_CREATE', 'AGENT_UPDATE', 'AGENT_DELETE',
        'TEAM_MEMBER_ADD', 'TEAM_MEMBER_TRANSFER_END', 'TEAM_MEMBER_REMOVE',
        'AGENT_UPLINE_SET', 'AGENT_UPLINE_TRANSFER_END', 'AGENT_UPLINE_CLEAR',
        'CARD_CREATE', 'CARD_UPDATE', 'CARD_DELETE',
        'CARD_ASSIGN', 'CARD_ASSIGNMENT_END',
        'CARD_STATUS_EVENT_CREATE'
      )
      order by created_at asc
    `,
  );
  return r.rows;
}

function buildRecoveryState(rows: AuditRow[]) {
  const deletedAgents = new Set<string>();
  const deletedCards = new Set<string>();

  const agents = new Map<string, AgentSnapshot>();
  const cards = new Map<string, CardSnapshot>();
  const memberships = new Map<string, TeamMembershipSnapshot>();
  const uplines = new Map<string, UplineSnapshot>();
  const assignments = new Map<string, AssignmentSnapshot>();
  const statusEvents = new Map<string, StatusEventSnapshot>();

  for (const row of rows) {
    const after = (row.after_json ?? {}) as Record<string, any>;
    const before = (row.before_json ?? {}) as Record<string, any>;
    const meta = (row.meta ?? {}) as Record<string, any>;

    if (row.action === "AGENT_DELETE") {
      const id = row.entity_id ?? asText(before.id) ?? asText(meta.agentId);
      if (id) deletedAgents.add(id);
      continue;
    }
    if (row.action === "CARD_DELETE") {
      const id = row.entity_id ?? asText(before.id) ?? asText(meta.cardId);
      if (id) deletedCards.add(id);
      continue;
    }

    if (row.action === "AGENT_CREATE" || row.action === "AGENT_UPDATE") {
      const id = (row.entity_id ?? asText(after.id)) as string | null;
      if (!id) continue;
      const userId = asText(after.user_id);
      if (!userId) continue;
      const username = asText(after.username) ?? "";
      const next: AgentSnapshot = {
        id,
        userId,
        username,
        userStatus: toStatus(after.user_status),
        name: asText(after.name) ?? `恢复职工_${id.slice(0, 6)}`,
        phone: asText(after.phone),
        employeeNo: asText(after.employee_no),
        province: asText(after.province),
        channel: asText(after.channel),
        currentLevelId: asText(after.current_level_id),
        currentTeamId: asText(after.current_team_id),
        at: row.created_at,
      };
      agents.set(id, next);
      continue;
    }

    if (row.action === "TEAM_MEMBER_ADD") {
      const agentId = asText(after.agent_id);
      const teamId = asText(after.team_id);
      if (!agentId || !teamId) continue;
      memberships.set(agentId, {
        id: asText(after.id) ?? randomUUID(),
        teamId,
        agentId,
        startAt: asText(after.start_at) ?? row.created_at,
        createdBy: asText(after.created_by),
        at: row.created_at,
      });
      continue;
    }
    if (row.action === "TEAM_MEMBER_TRANSFER_END" || row.action === "TEAM_MEMBER_REMOVE") {
      const agentId = asText(after.agent_id) ?? asText(before.agent_id) ?? asText(meta.agentId);
      if (agentId) memberships.delete(agentId);
      continue;
    }

    if (row.action === "AGENT_UPLINE_SET") {
      const agentId = asText(after.agent_id);
      const uplineAgentId = asText(after.upline_agent_id);
      if (!agentId || !uplineAgentId) continue;
      uplines.set(agentId, {
        id: asText(after.id) ?? randomUUID(),
        agentId,
        uplineAgentId,
        startAt: asText(after.start_at) ?? row.created_at,
        createdBy: asText(after.created_by),
        at: row.created_at,
      });
      continue;
    }
    if (row.action === "AGENT_UPLINE_TRANSFER_END" || row.action === "AGENT_UPLINE_CLEAR") {
      const agentId = asText(after.agent_id) ?? asText(before.agent_id) ?? asText(meta.agentId);
      if (agentId) uplines.delete(agentId);
      continue;
    }

    if (row.action === "CARD_CREATE" || row.action === "CARD_UPDATE") {
      const id = (row.entity_id ?? asText(after.id)) as string | null;
      if (!id) continue;
      const cardNo = asText(after.card_no);
      const activatedAt = asText(after.activated_at);
      if (!cardNo || !activatedAt) continue;
      cards.set(id, {
        id,
        cardNo,
        activatedAt,
        planId: asText(after.plan_id),
        policyId: asText(after.policy_id),
        createdBy: asText(after.created_by),
        at: row.created_at,
      });
      continue;
    }

    if (row.action === "CARD_ASSIGN") {
      const cardId = asText(after.card_id);
      const ownerAgentId = asText(after.owner_agent_id);
      if (!cardId || !ownerAgentId) continue;
      assignments.set(cardId, {
        id: asText(after.id) ?? randomUUID(),
        cardId,
        ownerAgentId,
        startAt: asText(after.start_at) ?? row.created_at,
        createdBy: asText(after.created_by),
        at: row.created_at,
      });
      continue;
    }
    if (row.action === "CARD_ASSIGNMENT_END") {
      const cardId = asText(after.card_id) ?? asText(before.card_id) ?? asText(meta.cardId);
      if (cardId) assignments.delete(cardId);
      continue;
    }

    if (row.action === "CARD_STATUS_EVENT_CREATE") {
      const id = asText(after.id);
      const cardId = asText(after.card_id);
      const status = asText(after.status) as StatusEventSnapshot["status"] | null;
      const happenedAt = asText(after.happened_at);
      if (!id || !cardId || !status || !happenedAt) continue;
      statusEvents.set(id, {
        id,
        cardId,
        status,
        reason: asText(after.reason),
        happenedAt,
        createdBy: asText(after.created_by),
        at: row.created_at,
      });
      continue;
    }
  }

  return {
    agents,
    deletedAgents,
    cards,
    deletedCards,
    memberships,
    uplines,
    assignments,
    statusEvents,
  };
}

async function main() {
  const dryRun = parseFlag("--dry-run");
  const defaultAgentPassword = process.env.RECOVER_AGENT_DEFAULT_PASSWORD ?? "123456";
  if (defaultAgentPassword.length < 6) {
    throw new Error("RECOVER_AGENT_DEFAULT_PASSWORD must be at least 6 chars");
  }

  const databaseUrl = process.env.DATABASE_URL;
  const pglitePath = process.env.PGLITE_PATH ?? "./.data/pglite";
  const db = await createDb({ databaseUrl, pglitePath });

  const summary: RestoreSummary = {
    createdUsers: 0,
    createdAgents: 0,
    updatedAgents: 0,
    createdLevelHistories: 0,
    createdTeamMemberships: 0,
    endedTeamMemberships: 0,
    createdUplines: 0,
    endedUplines: 0,
    createdCards: 0,
    updatedCards: 0,
    createdAssignments: 0,
    endedAssignments: 0,
    createdStatusEvents: 0,
    skippedDeletedAgents: 0,
    skippedDeletedCards: 0,
  };

  try {
    const levelRows = await db.query<{ id: string }>("select id from agent_levels order by created_at asc");
    const teamRows = await db.query<{ id: string }>("select id from teams");
    const planRows = await db.query<{ id: string }>("select id from plans order by created_at asc");
    const policyRows = await db.query<{ id: string }>("select id from policies");
    const adminRows = await db.query<{ id: string }>("select id from users where role = 'ADMIN' order by created_at asc limit 1");

    const levelSet = new Set(levelRows.rows.map((x) => x.id));
    const teamSet = new Set(teamRows.rows.map((x) => x.id));
    const planSet = new Set(planRows.rows.map((x) => x.id));
    const policySet = new Set(policyRows.rows.map((x) => x.id));
    const fallbackLevelId = levelRows.rows[0]?.id ?? null;
    const fallbackPlanId = planRows.rows[0]?.id ?? null;
    const adminUserId = adminRows.rows[0]?.id ?? null;

    if (!fallbackLevelId) throw new Error("No agent_levels found, cannot recover agents");
    if (!fallbackPlanId) throw new Error("No plans found, cannot recover cards");

    const rows = await fetchAuditRows(db);
    const state = buildRecoveryState(rows);

    // Existing snapshots from current DB.
    const users = await db.query<{ id: string; username: string }>("select id, username from users");
    const agents = await db.query<{ id: string }>("select id from agents");
    const activeLevelHist = await db.query<{ agent_id: string }>(
      "select agent_id from agent_level_histories where end_at is null",
    );
    const activeTeamMemberships = await db.query<{ id: string; agent_id: string; team_id: string }>(
      "select id, agent_id, team_id from team_memberships where end_at is null",
    );
    const activeUplines = await db.query<{ id: string; agent_id: string; upline_agent_id: string }>(
      "select id, agent_id, upline_agent_id from agent_relations where end_at is null",
    );
    const cards = await db.query<{ id: string }>("select id from cards");
    const activeAssignments = await db.query<{ id: string; card_id: string; owner_agent_id: string }>(
      "select id, card_id, owner_agent_id from card_assignments where end_at is null",
    );
    const statusEvents = await db.query<{ id: string }>("select id from card_status_events");

    const userIdSet = new Set(users.rows.map((x) => x.id));
    const usernameSet = new Set(users.rows.map((x) => x.username));
    const agentIdSet = new Set(agents.rows.map((x) => x.id));
    const hasLevelHistSet = new Set(activeLevelHist.rows.map((x) => x.agent_id));
    const activeMembershipByAgent = new Map(activeTeamMemberships.rows.map((x) => [x.agent_id, x]));
    const activeUplineByAgent = new Map(activeUplines.rows.map((x) => [x.agent_id, x]));
    const cardIdSet = new Set(cards.rows.map((x) => x.id));
    const activeAssignByCard = new Map(activeAssignments.rows.map((x) => [x.card_id, x]));
    const statusEventIdSet = new Set(statusEvents.rows.map((x) => x.id));

    if (!dryRun) await db.query("begin");
    try {
      for (const agent of state.agents.values()) {
        if (state.deletedAgents.has(agent.id)) {
          summary.skippedDeletedAgents += 1;
          continue;
        }

        let levelId = agent.currentLevelId && levelSet.has(agent.currentLevelId) ? agent.currentLevelId : fallbackLevelId;
        if (levelId) {
          const exists = await db.query<{ id: string }>("select id from agent_levels where id = $1 limit 1", [levelId]);
          if (exists.rowCount === 0) {
            levelId = fallbackLevelId;
          }
        }
        if (!levelId) {
          continue;
        }

        let teamId = agent.currentTeamId && teamSet.has(agent.currentTeamId) ? agent.currentTeamId : null;
        if (teamId) {
          const exists = await db.query<{ id: string }>("select id from teams where id = $1 limit 1", [teamId]);
          if (exists.rowCount === 0) {
            teamId = null;
          }
        }

        if (!userIdSet.has(agent.userId)) {
          const username = ensureUsernameUnique(usernameSet, agent.username, agent.id);
          if (!dryRun) {
            await db.query(
              `
                insert into users (id, username, password_hash, role, status, created_at)
                values ($1, $2, $3, 'AGENT', $4, now())
              `,
              [agent.userId, username, hashPassword(defaultAgentPassword), agent.userStatus],
            );
          }
          userIdSet.add(agent.userId);
          summary.createdUsers += 1;
        }

        if (!agentIdSet.has(agent.id)) {
          if (!dryRun) {
            await db.query(
              `
                insert into agents (
                  id, user_id, name, phone, employee_no, province, channel, current_level_id, current_team_id, created_at
                ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
              `,
              [
                agent.id,
                agent.userId,
                agent.name,
                agent.phone,
                agent.employeeNo,
                agent.province,
                agent.channel,
                levelId,
                teamId,
              ],
            );
          }
          agentIdSet.add(agent.id);
          summary.createdAgents += 1;
        } else {
          if (!dryRun) {
            await db.query(
              `
                update agents
                set name = $2,
                    phone = $3,
                    employee_no = $4,
                    province = $5,
                    channel = $6,
                    current_level_id = $7,
                    current_team_id = $8
                where id = $1
              `,
              [agent.id, agent.name, agent.phone, agent.employeeNo, agent.province, agent.channel, levelId, teamId],
            );
          }
          summary.updatedAgents += 1;
        }

        if (!hasLevelHistSet.has(agent.id)) {
          if (!dryRun) {
            await db.query(
              `
                insert into agent_level_histories (id, agent_id, level_id, start_at, changed_by, created_at)
                values ($1, $2, $3, now(), $4, now())
              `,
              [randomUUID(), agent.id, levelId, adminUserId],
            );
          }
          hasLevelHistSet.add(agent.id);
          summary.createdLevelHistories += 1;
        }
      }

      for (const m of state.memberships.values()) {
        if (!agentIdSet.has(m.agentId) || !teamSet.has(m.teamId)) continue;
        const ex = activeMembershipByAgent.get(m.agentId);
        if (ex?.team_id === m.teamId) continue;

        if (ex) {
          if (!dryRun) {
            await db.query("update team_memberships set end_at = now() where id = $1", [ex.id]);
          }
          summary.endedTeamMemberships += 1;
        }
        if (!dryRun) {
          await db.query(
            `
              insert into team_memberships (id, team_id, agent_id, start_at, created_by, created_at)
              values ($1, $2, $3, $4, $5, now())
            `,
            [m.id, m.teamId, m.agentId, m.startAt, m.createdBy ?? adminUserId],
          );
          await db.query("update agents set current_team_id = $1 where id = $2", [m.teamId, m.agentId]);
        }
        activeMembershipByAgent.set(m.agentId, { id: m.id, team_id: m.teamId, agent_id: m.agentId });
        summary.createdTeamMemberships += 1;
      }

      for (const up of state.uplines.values()) {
        if (!agentIdSet.has(up.agentId) || !agentIdSet.has(up.uplineAgentId) || up.agentId === up.uplineAgentId) continue;
        const ex = activeUplineByAgent.get(up.agentId);
        if (ex?.upline_agent_id === up.uplineAgentId) continue;

        if (ex) {
          if (!dryRun) {
            await db.query("update agent_relations set end_at = now() where id = $1", [ex.id]);
          }
          summary.endedUplines += 1;
        }
        if (!dryRun) {
          await db.query(
            `
              insert into agent_relations (id, agent_id, upline_agent_id, start_at, created_by, created_at)
              values ($1, $2, $3, $4, $5, now())
            `,
            [up.id, up.agentId, up.uplineAgentId, up.startAt, up.createdBy ?? adminUserId],
          );
        }
        activeUplineByAgent.set(up.agentId, { id: up.id, agent_id: up.agentId, upline_agent_id: up.uplineAgentId });
        summary.createdUplines += 1;
      }

      for (const card of state.cards.values()) {
        if (state.deletedCards.has(card.id)) {
          summary.skippedDeletedCards += 1;
          continue;
        }
        let planId = card.planId && planSet.has(card.planId) ? card.planId : fallbackPlanId;
        if (planId) {
          const exists = await db.query<{ id: string }>("select id from plans where id = $1 limit 1", [planId]);
          if (exists.rowCount === 0) {
            planId = fallbackPlanId;
          }
        }
        if (!planId) {
          continue;
        }

        let policyId = card.policyId && policySet.has(card.policyId) ? card.policyId : null;
        if (policyId) {
          const exists = await db.query<{ id: string }>("select id from policies where id = $1 limit 1", [policyId]);
          if (exists.rowCount === 0) {
            policyId = null;
          }
        }

        if (!cardIdSet.has(card.id)) {
          if (!dryRun) {
            await db.query(
              `
                insert into cards (id, card_no, activated_at, plan_id, policy_id, created_by, created_at)
                values ($1, $2, $3, $4, $5, $6, now())
              `,
              [card.id, card.cardNo, card.activatedAt, planId, policyId, card.createdBy ?? adminUserId],
            );
          }
          cardIdSet.add(card.id);
          summary.createdCards += 1;
        } else {
          if (!dryRun) {
            await db.query(
              `
                update cards
                set card_no = $2, activated_at = $3, plan_id = $4, policy_id = $5
                where id = $1
              `,
              [card.id, card.cardNo, card.activatedAt, planId, policyId],
            );
          }
          summary.updatedCards += 1;
        }
      }

      for (const assign of state.assignments.values()) {
        if (!cardIdSet.has(assign.cardId) || !agentIdSet.has(assign.ownerAgentId)) continue;
        const ex = activeAssignByCard.get(assign.cardId);
        if (ex?.owner_agent_id === assign.ownerAgentId) continue;

        if (ex) {
          if (!dryRun) {
            await db.query("update card_assignments set end_at = now() where id = $1", [ex.id]);
          }
          summary.endedAssignments += 1;
        }
        if (!dryRun) {
          await db.query(
            `
              insert into card_assignments (id, card_id, owner_agent_id, start_at, created_by, created_at)
              values ($1, $2, $3, $4, $5, now())
            `,
            [assign.id, assign.cardId, assign.ownerAgentId, assign.startAt, assign.createdBy ?? adminUserId],
          );
        }
        activeAssignByCard.set(assign.cardId, {
          id: assign.id,
          card_id: assign.cardId,
          owner_agent_id: assign.ownerAgentId,
        });
        summary.createdAssignments += 1;
      }

      for (const ev of state.statusEvents.values()) {
        if (!cardIdSet.has(ev.cardId)) continue;
        if (statusEventIdSet.has(ev.id)) continue;
        if (!dryRun) {
          await db.query(
            `
              insert into card_status_events (id, card_id, status, reason, happened_at, created_by, created_at)
              values ($1, $2, $3, $4, $5, $6, now())
            `,
            [ev.id, ev.cardId, ev.status, ev.reason, ev.happenedAt, ev.createdBy ?? adminUserId],
          );
        }
        statusEventIdSet.add(ev.id);
        summary.createdStatusEvents += 1;
      }

      if (!dryRun) {
        await writeAuditLog(db, {
          actorUserId: adminUserId ?? undefined,
          actorRole: "SYSTEM",
          action: "DATA_RECOVER_FROM_AUDIT",
          entityType: "system_recovery",
          meta: {
            defaultAgentPasswordUsed: true,
            summary,
          },
        });
      }

      if (!dryRun) {
        await db.query("commit");
      } else {
        console.log("[dry-run] no changes committed");
      }
    } catch (err) {
      if (!dryRun) {
        await db.query("rollback");
      }
      throw err;
    }

    console.log(JSON.stringify({ ok: true, dryRun, summary }, null, 2));
    if (summary.createdUsers > 0) {
      console.log(
        `Restored agent users were assigned default password from RECOVER_AGENT_DEFAULT_PASSWORD (current default: ${defaultAgentPassword}).`,
      );
    }
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
