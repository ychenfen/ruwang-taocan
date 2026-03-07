import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { writeAuditLog } from "../../audit/log.js";
import type { Db } from "../../db.js";
import { setupAdminTestApp } from "../../test/setupAdminTestApp.js";

describe("/admin/stats", () => {
  let app: FastifyInstance;
  let db: Db;
  let token: string;

  beforeAll(async () => {
    const t = await setupAdminTestApp();
    app = t.app;
    db = t.db;
    token = t.token;
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires auth", async () => {
    const r = await app.inject({ method: "GET", url: "/admin/stats" });
    expect(r.statusCode).toBe(401);
    expect(r.json().error).toBe("UNAUTHORIZED");
  });

  it("returns aggregate counts and latest settlement execution", async () => {
    const levelId = randomUUID();
    await db.query(
      `insert into agent_levels (id, name, support_rate, stable_rate, stable_months)
       values ($1, $2, $3, $4, $5)`,
      [levelId, "STATS-L1", 0.03, 0.01, 12],
    );

    const suffix = randomUUID().slice(0, 8);
    const team = await app.inject({
      method: "POST",
      url: "/admin/teams",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: `团队-${suffix}`, tag: "S" },
    });
    expect(team.statusCode).toBe(201);
    const teamId = team.json().id as string;

    const agent = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: { username: `stats_${suffix}`, password: "agent123456", name: "统计代理", levelId },
    });
    expect(agent.statusCode).toBe(201);
    const agentId = agent.json().id as string;

    const addMember = await app.inject({
      method: "POST",
      url: `/admin/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${token}` },
      payload: { agentId },
    });
    expect(addMember.statusCode).toBe(201);

    const plan = await app.inject({
      method: "POST",
      url: "/admin/plans",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: `统计套餐-${suffix}`, monthlyRent: 29 },
    });
    expect(plan.statusCode).toBe(201);
    const planId = plan.json().id as string;

    const card = await app.inject({
      method: "POST",
      url: "/admin/cards",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        cardNo: `192200${suffix.slice(0, 6)}`,
        activatedAt: "2026-01-10",
        planId,
        ownerAgentId: agentId,
        initialStatus: "NORMAL",
      },
    });
    expect(card.statusCode).toBe(201);

    const recalc = await app.inject({
      method: "POST",
      url: "/admin/settlements/recalculate",
      headers: { authorization: `Bearer ${token}` },
      payload: { commissionMonth: "2026-02" },
    });
    expect(recalc.statusCode).toBe(200);

    const stats = await app.inject({
      method: "GET",
      url: "/admin/stats",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(stats.statusCode).toBe(200);

    const body = stats.json() as any;
    expect(body.agentsTotal).toBeGreaterThanOrEqual(1);
    expect(body.cardsTotal).toBeGreaterThanOrEqual(1);
    expect(body.teamsTotal).toBeGreaterThanOrEqual(1);
    expect(body.cardsOnNet).toBeGreaterThanOrEqual(1);

    expect(body.latestRun).toBeTruthy();
    expect(body.latestRun.commissionMonth).toBe("2026-02");
    expect(["DRAFT", "APPROVED", "POSTED"]).toContain(body.latestRun.status);

    expect(body.latestExecution).toBeTruthy();
    expect(body.latestExecution.commissionMonth).toBe("2026-02");
    expect(body.latestExecution.status).toBe("SUCCEEDED");
    expect(["MANUAL", "AUTO"]).toContain(body.latestExecution.triggerType);
  });

  it("returns monthly settlement trends", async () => {
    const run2 = await app.inject({
      method: "POST",
      url: "/admin/settlements/recalculate",
      headers: { authorization: `Bearer ${token}` },
      payload: { commissionMonth: "2026-03" },
    });
    expect(run2.statusCode).toBe(200);

    const trend = await app.inject({
      method: "GET",
      url: "/admin/stats/trends?months=6",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(trend.statusCode).toBe(200);
    const list = trend.json() as any[];
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(2);

    const feb = list.find((x) => x.commissionMonth === "2026-02");
    const mar = list.find((x) => x.commissionMonth === "2026-03");
    expect(feb).toBeTruthy();
    expect(mar).toBeTruthy();
    expect(typeof feb.totalAmount).toBe("number");
    expect(typeof feb.lineCount).toBe("number");
    expect(["DRAFT", "APPROVED", "POSTED"]).toContain(feb.runStatus);
  });

  it("returns operational alerts for failed runs and stale drafts", async () => {
    const run = await db.query<{ id: string }>(
      "select id from settlement_runs where commission_month = $1 limit 1",
      ["2026-03"],
    );
    const runId = run.rows[0]?.id;
    expect(typeof runId).toBe("string");

    const approve = await app.inject({
      method: "POST",
      url: `/admin/settlements/runs/${runId}/approve`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(approve.statusCode).toBe(200);

    const failRecalc = await app.inject({
      method: "POST",
      url: "/admin/settlements/recalculate",
      headers: { authorization: `Bearer ${token}` },
      payload: { commissionMonth: "2026-03" },
    });
    expect(failRecalc.statusCode).toBe(409);
    expect(failRecalc.json().error).toBe("NOT_DRAFT");

    const staleRunId = randomUUID();
    await db.query(
      `
        insert into settlement_runs (id, run_month, commission_month, timezone, status, created_by, created_at)
        values ($1, '2025-01', '2024-12', 'Asia/Shanghai', 'DRAFT', null, now() - interval '72 hours')
      `,
      [staleRunId],
    );

    const adminUser = await db.query<{ id: string }>("select id from users where username = 'admin' limit 1");
    const adminUserId = adminUser.rows[0]?.id;
    expect(typeof adminUserId).toBe("string");
    for (let i = 0; i < 6; i += 1) {
      const isReport = i % 2 === 0;
      await writeAuditLog(db, {
        actorUserId: adminUserId ?? null,
        actorRole: "ADMIN",
        action: isReport ? "REPORT_EXPORT_SETTLEMENT_ITEMS" : "LEDGER_EXPORT_ENTRIES",
        entityType: isReport ? "reports" : "ledger_entries",
        meta: {
          format: isReport ? "csv" : "xlsx",
          source: "stats_test",
          idx: i,
        },
      });
    }

    const alerts = await app.inject({
      method: "GET",
      url: "/admin/stats/alerts?lookbackDays=365&draftStaleHours=24&adjustmentRatioThreshold=0&exportLookbackHours=48&exportCountThreshold=5",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(alerts.statusCode).toBe(200);
    const list = alerts.json() as any[];
    expect(Array.isArray(list)).toBe(true);

    const failed = list.find((x) => x.code === "FAILED_EXECUTION_RECENT");
    const stale = list.find((x) => x.code === "DRAFT_RUN_STALE");
    const ratio = list.find((x) => x.code === "HIGH_ADJUSTMENT_RATIO");
    const exportSpike = list.find((x) => x.code === "EXPORT_VOLUME_SPIKE");
    expect(failed).toBeTruthy();
    expect(stale).toBeTruthy();
    expect(ratio).toBeTruthy();
    expect(exportSpike).toBeTruthy();
    expect(failed.severity).toBe("HIGH");
    expect(stale.severity).toBe("MEDIUM");
    expect(ratio.severity).toBe("MEDIUM");
    expect(["MEDIUM", "HIGH"]).toContain(exportSpike.severity);
    expect(Number(exportSpike.meta?.totalCount ?? 0)).toBeGreaterThanOrEqual(5);
  });
});
