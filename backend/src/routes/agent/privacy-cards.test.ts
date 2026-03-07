import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import type { Db } from "../../db.js";
import { setupAdminTestApp } from "../../test/setupAdminTestApp.js";

describe("AGENT card privacy + team/downline card views", () => {
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

  it("masks non-self card numbers and defaults to on-net only", async () => {
    const L3 = randomUUID();
    const L2 = randomUUID();
    const L1 = randomUUID();
    await db.query(
      `insert into agent_levels (id, name, support_rate, stable_rate, stable_months)
       values
         ($1, 'L3', 0.06, 0.03, 12),
         ($2, 'L2', 0.03, 0.02, 12),
         ($3, 'L1', 0.03, 0.02, 12)`,
      [L3, L2, L1],
    );

    const a = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username: "privA", password: "agent123456", name: "代理A", levelId: L3 },
    });
    expect(a.statusCode).toBe(201);
    const aId = a.json().id as string;

    const b = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username: "privB", password: "agent123456", name: "代理B", employeeNo: "E0002", levelId: L2 },
    });
    expect(b.statusCode).toBe(201);
    const bId = b.json().id as string;

    const c = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username: "privC", password: "agent123456", name: "代理C", employeeNo: "E0003", levelId: L1 },
    });
    expect(c.statusCode).toBe(201);
    const cId = c.json().id as string;

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
      payload: { name: "团队1", tag: "T1" },
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
      [planId, "双百套餐 2.0", 29],
    );
    const policyId = randomUUID();
    await db.query(`insert into policies (id, name, status, created_at) values ($1, $2, 'ACTIVE', now())`, [
      policyId,
      "政策A",
    ]);

    // A has 1 NORMAL card
    const ca1 = await app.inject({
      method: "POST",
      url: "/admin/cards",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { cardNo: "19213300001", activatedAt: "2026-01-10", planId, policyId, ownerAgentId: aId, initialStatus: "NORMAL" },
    });
    expect(ca1.statusCode).toBe(201);

    // B has 1 NORMAL + 1 ABNORMAL
    const cb1 = await app.inject({
      method: "POST",
      url: "/admin/cards",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { cardNo: "19213300011", activatedAt: "2026-01-10", planId, policyId, ownerAgentId: bId, initialStatus: "NORMAL" },
    });
    expect(cb1.statusCode).toBe(201);
    const cb2 = await app.inject({
      method: "POST",
      url: "/admin/cards",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { cardNo: "19213300012", activatedAt: "2026-01-10", planId, policyId, ownerAgentId: bId, initialStatus: "ABNORMAL" },
    });
    expect(cb2.statusCode).toBe(201);

    // C has 1 NORMAL
    const cc1 = await app.inject({
      method: "POST",
      url: "/admin/cards",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { cardNo: "19213300021", activatedAt: "2026-01-10", planId, policyId, ownerAgentId: cId, initialStatus: "NORMAL" },
    });
    expect(cc1.statusCode).toBe(201);

    // Login as A
    const loginA = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: "privA", password: "agent123456" },
    });
    expect(loginA.statusCode).toBe(200);
    const agentToken = loginA.json().token as string;

    const downlines = await app.inject({
      method: "GET",
      url: "/agent/downlines",
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(downlines.statusCode).toBe(200);
    const dl = downlines.json() as any[];
    const bRow = dl.find((x) => x.level === 1 && x.agentId === bId);
    const cRow = dl.find((x) => x.level === 2 && x.agentId === cId);
    expect(bRow.supportDiffRate).toBeCloseTo(0.03, 10);
    expect(bRow.stableDiffRate).toBeCloseTo(0.01, 10);
    expect(cRow.supportDiffRate).toBeCloseTo(0.03, 10);
    expect(cRow.stableDiffRate).toBeCloseTo(0.01, 10);

    const selfCards = await app.inject({
      method: "GET",
      url: "/agent/cards",
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(selfCards.statusCode).toBe(200);
    const sc = selfCards.json() as any[];
    expect(sc.length).toBe(1);
    expect(sc[0].cardNo).toBe("19213300001");

    const teamMembers = await app.inject({
      method: "GET",
      url: "/agent/team-members",
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(teamMembers.statusCode).toBe(200);
    const tm = teamMembers.json() as any[];
    expect(tm.some((x) => x.agentId === aId && x.teamLabel === "团队：代理A")).toBe(true);
    expect(tm.some((x) => x.agentId === bId && x.teamLabel === "团队：代理B")).toBe(true);

    const teamCards = await app.inject({
      method: "GET",
      url: "/agent/team/cards",
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(teamCards.statusCode).toBe(200);
    const tc = teamCards.json() as any[];
    expect(tc.some((x) => x.ownerAgentId === aId && x.cardNo === "19213300001" && x.isOwn === true)).toBe(true);
    expect(tc.some((x) => x.ownerAgentId === bId && x.cardNo === "192******11" && x.isOwn === false)).toBe(true);
    expect(tc.some((x) => x.ownerAgentId === bId && x.teamLabel === "团队：代理B")).toBe(true);
    // B abnormal card is filtered out by default (onNetOnly=true)
    expect(tc.some((x) => x.cardNo === "192******12")).toBe(false);

    const downlineCards = await app.inject({
      method: "GET",
      url: "/agent/downlines/cards",
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(downlineCards.statusCode).toBe(200);
    const dc = downlineCards.json() as any[];
    expect(dc.some((x) => x.ownerAgentId === bId && x.cardNo === "192******11" && x.downlineLevel === 1)).toBe(true);
    expect(dc.some((x) => x.ownerAgentId === cId && x.cardNo === "192******21" && x.downlineLevel === 2)).toBe(true);
    expect(dc.some((x) => x.cardNo === "192******12")).toBe(false);

    const byName = await app.inject({
      method: "GET",
      url: "/agent/downlines/cards?agentKeyword=%E4%BB%A3%E7%90%86B",
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(byName.statusCode).toBe(200);
    const byNameRows = byName.json() as any[];
    expect(byNameRows.length).toBe(1);
    expect(byNameRows[0].ownerAgentId).toBe(bId);

    const byEmployeeNo = await app.inject({
      method: "GET",
      url: "/agent/downlines/cards?agentKeyword=E0003",
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(byEmployeeNo.statusCode).toBe(200);
    const byEmployeeNoRows = byEmployeeNo.json() as any[];
    expect(byEmployeeNoRows.length).toBe(1);
    expect(byEmployeeNoRows[0].ownerAgentId).toBe(cId);
  });
});
