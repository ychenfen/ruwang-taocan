import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { FastifyInstance } from "fastify";

import type { Db } from "../db.js";
import { setupAdminTestApp } from "../test/setupAdminTestApp.js";

const ym = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

const adminStatsSchema = z
  .object({
    agentsTotal: z.number().int().nonnegative(),
    cardsTotal: z.number().int().nonnegative(),
    teamsTotal: z.number().int().nonnegative(),
    cardsOnNet: z.number().int().nonnegative(),
    latestRun: z
      .object({
        id: z.string().min(1),
        commissionMonth: ym,
        status: z.string().min(1),
        createdAt: z.string().min(1),
      })
      .optional(),
    latestExecution: z
      .object({
        commissionMonth: ym,
        status: z.string().min(1),
        triggerType: z.string().min(1),
        startedAt: z.string().min(1),
        durationMs: z.number().int().nonnegative(),
      })
      .optional(),
  })
  .strict();

const adminTrendItemSchema = z
  .object({
    commissionMonth: ym,
    runStatus: z.string().min(1),
    lineCount: z.number().int().nonnegative(),
    adjustmentLineCount: z.number().int().nonnegative(),
    totalAmount: z.number(),
    latestExecution: z
      .object({
        status: z.string().min(1),
        triggerType: z.string().min(1),
        durationMs: z.number().int().nonnegative().nullable(),
        startedAt: z.string().min(1).nullable(),
      })
      .optional(),
  })
  .strict();

const adminAlertItemSchema = z
  .object({
    code: z.string().min(1),
    severity: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    meta: z.record(z.unknown()).optional(),
  })
  .strict();

const agentStatsSchema = z
  .object({
    me: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        levelName: z.string().min(1),
        teamName: z.string().min(1).optional(),
      })
      .strict(),
    myOnNetCardCount: z.number().int().nonnegative(),
    downlineLevel1Count: z.number().int().nonnegative(),
    downlineLevel2Count: z.number().int().nonnegative(),
    teamMemberCount: z.number().int().nonnegative(),
    teamOnNetCardCount: z.number().int().nonnegative(),
  })
  .strict();

const agentTrendItemSchema = z
  .object({
    commissionMonth: ym,
    runStatus: z.string().min(1),
    lineCount: z.number().int().nonnegative(),
    adjustmentLineCount: z.number().int().nonnegative(),
    totalAmount: z.number(),
  })
  .strict();

describe("Dashboard API contracts", () => {
  let app: FastifyInstance;
  let db: Db;
  let adminToken: string;
  let agentToken: string;

  beforeAll(async () => {
    const t = await setupAdminTestApp();
    app = t.app;
    db = t.db;
    adminToken = t.token;

    const L3 = randomUUID();
    const L2 = randomUUID();
    const L1 = randomUUID();
    await db.query(
      `insert into agent_levels (id, name, support_rate, stable_rate, stable_months)
       values
         ($1, 'C-L3', 0.06, 0.03, 12),
         ($2, 'C-L2', 0.03, 0.02, 12),
         ($3, 'C-L1', 0.03, 0.02, 12)`,
      [L3, L2, L1],
    );

    const suffix = randomUUID().slice(0, 8);
    const A = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username: `ctA_${suffix}`, password: "agent123456", name: "契约A", levelId: L3 },
    });
    expect(A.statusCode).toBe(201);
    const aId = A.json().id as string;

    const B = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username: `ctB_${suffix}`, password: "agent123456", name: "契约B", levelId: L2 },
    });
    expect(B.statusCode).toBe(201);
    const bId = B.json().id as string;

    const C = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username: `ctC_${suffix}`, password: "agent123456", name: "契约C", levelId: L1 },
    });
    expect(C.statusCode).toBe(201);
    const cId = C.json().id as string;

    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/admin/agents/${bId}/upline`,
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { uplineAgentId: aId },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/admin/agents/${cId}/upline`,
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { uplineAgentId: bId },
        })
      ).statusCode,
    ).toBe(200);

    const team = await app.inject({
      method: "POST",
      url: "/admin/teams",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: `契约团队-${suffix}`, tag: "CT" },
    });
    expect(team.statusCode).toBe(201);
    const teamId = team.json().id as string;
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/admin/teams/${teamId}/members`,
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { agentId: aId },
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/admin/teams/${teamId}/members`,
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { agentId: bId },
        })
      ).statusCode,
    ).toBe(201);

    const plan = await app.inject({
      method: "POST",
      url: "/admin/plans",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: `契约套餐-${suffix}`, monthlyRent: 29 },
    });
    expect(plan.statusCode).toBe(201);
    const planId = plan.json().id as string;

    const mk = async (cardNo: string, ownerAgentId: string, status: "NORMAL" | "ABNORMAL") =>
      app.inject({
        method: "POST",
        url: "/admin/cards",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { cardNo, activatedAt: "2026-01-10", planId, ownerAgentId, initialStatus: status },
      });

    expect((await mk(`195300${suffix.slice(0, 6)}`, cId, "NORMAL")).statusCode).toBe(201);
    expect((await mk(`196300${suffix.slice(0, 6)}`, bId, "ABNORMAL")).statusCode).toBe(201);

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/admin/settlements/recalculate",
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { commissionMonth: "2026-02" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/admin/settlements/recalculate",
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { commissionMonth: "2026-03" },
        })
      ).statusCode,
    ).toBe(200);

    const run03 = await db.query<{ id: string }>(
      "select id from settlement_runs where commission_month = $1 limit 1",
      ["2026-03"],
    );
    const run03Id = run03.rows[0]?.id;
    expect(typeof run03Id).toBe("string");
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/admin/settlements/runs/${run03Id}/approve`,
          headers: { authorization: `Bearer ${adminToken}` },
        })
      ).statusCode,
    ).toBe(200);
    // trigger failed execution log (NOT_DRAFT)
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/admin/settlements/recalculate",
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { commissionMonth: "2026-03" },
        })
      ).statusCode,
    ).toBe(409);

    // create stale draft run for alerts.
    await db.query(
      `
        insert into settlement_runs (id, run_month, commission_month, timezone, status, created_by, created_at)
        values ($1, '2025-01', '2024-11', 'Asia/Shanghai', 'DRAFT', null, now() - interval '72 hours')
      `,
      [randomUUID()],
    );

    const loginA = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: `ctA_${suffix}`, password: "agent123456" },
    });
    expect(loginA.statusCode).toBe(200);
    agentToken = loginA.json().token as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it("admin dashboard endpoints match contract", async () => {
    const stats = await app.inject({
      method: "GET",
      url: "/admin/stats",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(stats.statusCode).toBe(200);
    expect(() => adminStatsSchema.parse(stats.json())).not.toThrow();

    const trend = await app.inject({
      method: "GET",
      url: "/admin/stats/trends?months=6",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(trend.statusCode).toBe(200);
    const trendList = trend.json() as unknown[];
    for (const item of trendList) {
      expect(() => adminTrendItemSchema.parse(item)).not.toThrow();
    }

    const alerts = await app.inject({
      method: "GET",
      url: "/admin/stats/alerts?lookbackDays=365&draftStaleHours=24&adjustmentRatioThreshold=0",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(alerts.statusCode).toBe(200);
    const alertsList = alerts.json() as unknown[];
    for (const item of alertsList) {
      expect(() => adminAlertItemSchema.parse(item)).not.toThrow();
    }
  });

  it("agent dashboard endpoints match contract", async () => {
    const stats = await app.inject({
      method: "GET",
      url: "/agent/stats",
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(stats.statusCode).toBe(200);
    expect(() => agentStatsSchema.parse(stats.json())).not.toThrow();

    const trend = await app.inject({
      method: "GET",
      url: "/agent/stats/trends?months=6",
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(trend.statusCode).toBe(200);
    const trendList = trend.json() as unknown[];
    for (const item of trendList) {
      expect(() => agentTrendItemSchema.parse(item)).not.toThrow();
    }
  });
});

