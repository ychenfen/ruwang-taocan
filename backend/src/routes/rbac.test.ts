import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import type { Db } from "../db.js";
import { hashPassword } from "../security/password.js";
import { setupAdminTestApp } from "../test/setupAdminTestApp.js";

type RequestCase = Readonly<{
  method: "GET" | "POST";
  url: string;
  payload?: Record<string, unknown>;
}>;

async function createAgent(args: Readonly<{
  app: FastifyInstance;
  adminToken: string;
  username: string;
  password: string;
  name: string;
  levelId: string;
}>): Promise<string> {
  const { app, adminToken, username, password, name, levelId } = args;
  const r = await app.inject({
    method: "POST",
    url: "/admin/agents",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { username, password, name, levelId },
  });
  expect(r.statusCode).toBe(201);
  return r.json().id as string;
}

async function login(args: Readonly<{ app: FastifyInstance; username: string; password: string }>): Promise<string> {
  const { app, username, password } = args;
  const r = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { username, password },
  });
  expect(r.statusCode).toBe(200);
  return r.json().token as string;
}

describe("RBAC regressions", () => {
  let app: FastifyInstance;
  let db: Db;
  let adminToken: string;
  let agentToken: string;
  let outsiderAgentId: string;

  beforeAll(async () => {
    const t = await setupAdminTestApp();
    app = t.app;
    db = t.db;
    adminToken = t.token;

    const levelId = randomUUID();
    await db.query(
      `insert into agent_levels (id, name, support_rate, stable_rate, stable_months)
       values ($1, $2, $3, $4, $5)`,
      [levelId, "RBAC-L1", 0.03, 0.01, 12],
    );

    const suffix = randomUUID().slice(0, 8);
    const aId = await createAgent({
      app,
      adminToken,
      username: `rbac_a_${suffix}`,
      password: "agent123456",
      name: "RBAC-A",
      levelId,
    });
    const bId = await createAgent({
      app,
      adminToken,
      username: `rbac_b_${suffix}`,
      password: "agent123456",
      name: "RBAC-B",
      levelId,
    });
    const cId = await createAgent({
      app,
      adminToken,
      username: `rbac_c_${suffix}`,
      password: "agent123456",
      name: "RBAC-C",
      levelId,
    });
    outsiderAgentId = await createAgent({
      app,
      adminToken,
      username: `rbac_d_${suffix}`,
      password: "agent123456",
      name: "RBAC-D",
      levelId,
    });

    const bToA = await app.inject({
      method: "PUT",
      url: `/admin/agents/${bId}/upline`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { uplineAgentId: aId },
    });
    expect(bToA.statusCode).toBe(200);

    const cToB = await app.inject({
      method: "PUT",
      url: `/admin/agents/${cId}/upline`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { uplineAgentId: bId },
    });
    expect(cToB.statusCode).toBe(200);

    agentToken = await login({ app, username: `rbac_a_${suffix}`, password: "agent123456" });
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects AGENT role on critical admin endpoints", async () => {
    const cases: RequestCase[] = [
      { method: "GET", url: "/admin/stats" },
      { method: "GET", url: "/admin/stats/trends" },
      { method: "GET", url: "/admin/stats/alerts" },
      { method: "GET", url: "/admin/agents" },
      { method: "GET", url: "/admin/cards" },
      { method: "GET", url: "/admin/teams" },
      { method: "GET", url: "/admin/audit-logs" },
      { method: "GET", url: "/admin/audit-logs.csv" },
      { method: "GET", url: "/admin/audit-logs.xlsx" },
      { method: "GET", url: "/admin/audit-logs/export-summary" },
      { method: "GET", url: "/admin/settlements/runs" },
      { method: "GET", url: "/admin/ledger/entries" },
      { method: "GET", url: "/admin/ledger/entries.csv" },
      { method: "GET", url: "/admin/ledger/entries.xlsx" },
      { method: "GET", url: "/admin/ledger/summary/agents" },
      { method: "POST", url: "/admin/settlements/recalculate", payload: { commissionMonth: "2026-02" } },
      { method: "GET", url: "/admin/reports/settlement-summary/agents?commissionMonth=2026-02" },
      { method: "GET", url: "/admin/reports/settlement-items-preview?commissionMonth=2026-02" },
      { method: "GET", url: "/admin/reports/settlement-items.xlsx?commissionMonth=2026-02" },
      { method: "GET", url: "/admin/reports/bill.csv?commissionMonth=2026-02" },
      { method: "GET", url: "/admin/reports/bill.xlsx?commissionMonth=2026-02" },
      { method: "GET", url: "/admin/announcements" },
    ];

    for (const c of cases) {
      const req: {
        method: "GET" | "POST";
        url: string;
        headers: { authorization: string };
        payload?: Record<string, unknown>;
      } = {
        method: c.method,
        url: c.url,
        headers: { authorization: `Bearer ${agentToken}` },
      };
      if (c.payload) req.payload = c.payload;
      const r = await app.inject(req);
      expect(r.statusCode, `${c.method} ${c.url}`).toBe(403);
      expect(r.json().error).toBe("FORBIDDEN");
    }
  });

  it("rejects ADMIN role on agent endpoints", async () => {
    const cases: RequestCase[] = [
      { method: "GET", url: "/agent/me" },
      { method: "GET", url: "/agent/stats" },
      { method: "GET", url: "/agent/stats/trends" },
      { method: "GET", url: "/agent/downlines" },
      { method: "GET", url: "/agent/cards" },
      { method: "GET", url: "/agent/team-members" },
      { method: "GET", url: "/agent/announcements" },
    ];

    for (const c of cases) {
      const req: {
        method: "GET" | "POST";
        url: string;
        headers: { authorization: string };
        payload?: Record<string, unknown>;
      } = {
        method: c.method,
        url: c.url,
        headers: { authorization: `Bearer ${adminToken}` },
      };
      if (c.payload) req.payload = c.payload;
      const r = await app.inject(req);
      expect(r.statusCode, `${c.method} ${c.url}`).toBe(403);
      expect(r.json().error).toBe("FORBIDDEN");
    }
  });

  it("returns 401 for unauthenticated admin/agent routes", async () => {
    const adminRes = await app.inject({ method: "GET", url: "/admin/agents" });
    expect(adminRes.statusCode).toBe(401);
    expect(adminRes.json().error).toBe("UNAUTHORIZED");

    const agentRes = await app.inject({ method: "GET", url: "/agent/me" });
    expect(agentRes.statusCode).toBe(401);
    expect(agentRes.json().error).toBe("UNAUTHORIZED");
  });

  it("blocks out-of-scope downline agent filter", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/agent/downlines/cards?agentId=${encodeURIComponent(outsiderAgentId)}`,
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe("FORBIDDEN");
  });

  it("returns NO_AGENT_PROFILE when AGENT has no agent row", async () => {
    const username = `no_profile_${randomUUID().slice(0, 8)}`;
    const password = "agent123456";
    await db.query("insert into users (id, username, password_hash, role) values ($1, $2, $3, 'AGENT')", [
      randomUUID(),
      username,
      hashPassword(password),
    ]);

    const token = await login({ app, username, password });
    const r = await app.inject({
      method: "GET",
      url: "/agent/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe("NO_AGENT_PROFILE");
  });
});
