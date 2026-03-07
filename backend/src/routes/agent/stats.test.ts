import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import type { Db } from "../../db.js";
import { setupAdminTestApp } from "../../test/setupAdminTestApp.js";

describe("/agent/stats", () => {
  let app: FastifyInstance;
  let db: Db;
  let adminToken: string;

  beforeAll(async () => {
    const t = await setupAdminTestApp();
    app = t.app;
    db = t.db;
    adminToken = t.token;
  });

  afterAll(async () => {
    await app.close();
  });

  it("aggregates my/team/downline counters for agent dashboard", async () => {
    const L3 = randomUUID();
    const L2 = randomUUID();
    const L1 = randomUUID();
    await db.query(
      `insert into agent_levels (id, name, support_rate, stable_rate, stable_months)
       values
         ($1, 'S-L3', 0.06, 0.03, 12),
         ($2, 'S-L2', 0.03, 0.02, 12),
         ($3, 'S-L1', 0.03, 0.02, 12)`,
      [L3, L2, L1],
    );

    const suffix = randomUUID().slice(0, 8);
    const A = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username: `stA_${suffix}`, password: "agent123456", name: "统计A", levelId: L3 },
    });
    expect(A.statusCode).toBe(201);
    const aId = A.json().id as string;

    const B = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username: `stB_${suffix}`, password: "agent123456", name: "统计B", levelId: L2 },
    });
    expect(B.statusCode).toBe(201);
    const bId = B.json().id as string;

    const C = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username: `stC_${suffix}`, password: "agent123456", name: "统计C", levelId: L1 },
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
      payload: { name: `统计团队-${suffix}`, tag: "ST" },
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

    const planId = randomUUID();
    await db.query(
      `insert into plans (id, name, monthly_rent, status, created_at)
       values ($1, $2, $3, 'ACTIVE', now())`,
      [planId, `统计套餐-${suffix}`, 29],
    );

    const createCard = async (cardNo: string, ownerAgentId: string, status: "NORMAL" | "ABNORMAL") =>
      app.inject({
        method: "POST",
        url: "/admin/cards",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { cardNo, activatedAt: "2026-01-10", planId, ownerAgentId, initialStatus: status },
      });

    expect((await createCard(`192300${suffix.slice(0, 6)}`, aId, "NORMAL")).statusCode).toBe(201);
    expect((await createCard(`193300${suffix.slice(0, 6)}`, bId, "NORMAL")).statusCode).toBe(201);
    expect((await createCard(`194300${suffix.slice(0, 6)}`, bId, "ABNORMAL")).statusCode).toBe(201);

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: `stA_${suffix}`, password: "agent123456" },
    });
    expect(login.statusCode).toBe(200);
    const agentToken = login.json().token as string;

    const stats = await app.inject({
      method: "GET",
      url: "/agent/stats",
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(stats.statusCode).toBe(200);
    const body = stats.json() as any;
    expect(body.me.name).toBe("统计A");
    expect(body.myOnNetCardCount).toBe(1);
    expect(body.downlineLevel1Count).toBe(1);
    expect(body.downlineLevel2Count).toBe(1);
    expect(body.teamMemberCount).toBe(2);
    expect(body.teamOnNetCardCount).toBe(2);

    const recalc = await app.inject({
      method: "POST",
      url: "/admin/settlements/recalculate",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { commissionMonth: "2026-02" },
    });
    expect(recalc.statusCode).toBe(200);

    const trend = await app.inject({
      method: "GET",
      url: "/agent/stats/trends?months=6",
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(trend.statusCode).toBe(200);
    const trendList = trend.json() as any[];
    expect(Array.isArray(trendList)).toBe(true);
    expect(trendList.length).toBeGreaterThanOrEqual(1);
    const feb = trendList.find((x) => x.commissionMonth === "2026-02");
    expect(feb).toBeTruthy();
    expect(typeof feb.totalAmount).toBe("number");
    expect(feb.totalAmount).toBeGreaterThan(0);
    expect(feb.lineCount).toBeGreaterThan(0);
  });
});
