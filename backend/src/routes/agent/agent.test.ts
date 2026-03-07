import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import type { Db } from "../../db.js";
import { setupAdminTestApp } from "../../test/setupAdminTestApp.js";

describe("AGENT scope endpoints", () => {
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

  it("agent can see downlines (<=2 levels) and team members with on-net card counts", async () => {
    const levelId = randomUUID();
    await db.query(
      `insert into agent_levels (id, name, support_rate, stable_rate, stable_months)
       values ($1, $2, $3, $4, $5)`,
      [levelId, "1星", 0.03, 0.01, 12],
    );

    // Create 3 agents: A -> B -> C
    const a = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username: "agentA", password: "agent123456", name: "代理A", levelId },
    });
    expect(a.statusCode).toBe(201);
    const aId = a.json().id as string;

    const b = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username: "agentB", password: "agent123456", name: "代理B", levelId },
    });
    expect(b.statusCode).toBe(201);
    const bId = b.json().id as string;

    const c = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username: "agentC", password: "agent123456", name: "代理C", levelId },
    });
    expect(c.statusCode).toBe(201);
    const cId = c.json().id as string;

    const setBUpline = await app.inject({
      method: "PUT",
      url: `/admin/agents/${bId}/upline`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { uplineAgentId: aId },
    });
    expect(setBUpline.statusCode).toBe(200);

    const setCUpline = await app.inject({
      method: "PUT",
      url: `/admin/agents/${cId}/upline`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { uplineAgentId: bId },
    });
    expect(setCUpline.statusCode).toBe(200);

    // Team: add A + B
    const team = await app.inject({
      method: "POST",
      url: "/admin/teams",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: "团队1", tag: "T1" },
    });
    expect(team.statusCode).toBe(201);
    const teamId = team.json().id as string;

    const addA = await app.inject({
      method: "POST",
      url: `/admin/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { agentId: aId },
    });
    expect([200, 201]).toContain(addA.statusCode);

    const addB = await app.inject({
      method: "POST",
      url: `/admin/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { agentId: bId },
    });
    expect([200, 201]).toContain(addB.statusCode);

    // Seed plan + policy for cards.
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

    // Cards: B has 1 NORMAL + 1 ABNORMAL; C has 1 NORMAL
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
      payload: { cardNo: "19213300012", activatedAt: "2026-01-11", planId, policyId, ownerAgentId: bId, initialStatus: "ABNORMAL" },
    });
    expect(cb2.statusCode).toBe(201);

    const cc1 = await app.inject({
      method: "POST",
      url: "/admin/cards",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { cardNo: "19213300021", activatedAt: "2026-01-12", planId, policyId, ownerAgentId: cId, initialStatus: "NORMAL" },
    });
    expect(cc1.statusCode).toBe(201);

    // Login as Agent A
    const loginA = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: "agentA", password: "agent123456" },
    });
    expect(loginA.statusCode).toBe(200);
    const agentToken = loginA.json().token as string;

    const me = await app.inject({
      method: "GET",
      url: "/agent/me",
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().id).toBe(aId);
    expect(me.json().name).toBe("代理A");

    const downlines = await app.inject({
      method: "GET",
      url: "/agent/downlines",
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(downlines.statusCode).toBe(200);
    const dl = downlines.json() as any[];
    expect(dl.some((x) => x.level === 1 && x.agentId === bId && x.onNetCardCount === 1)).toBe(true);
    expect(dl.some((x) => x.level === 2 && x.agentId === cId && x.onNetCardCount === 1)).toBe(true);

    const teamMembers = await app.inject({
      method: "GET",
      url: "/agent/team-members",
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(teamMembers.statusCode).toBe(200);
    const tm = teamMembers.json() as any[];
    expect(tm.some((x) => x.agentId === aId && x.teamLabel === "团队：代理A")).toBe(true);
    expect(tm.some((x) => x.agentId === bId && x.onNetCardCount === 1)).toBe(true);

    const cards = await app.inject({
      method: "GET",
      url: "/agent/cards",
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(cards.statusCode).toBe(200);
    expect((cards.json() as any[]).length).toBe(0);
  });
});

