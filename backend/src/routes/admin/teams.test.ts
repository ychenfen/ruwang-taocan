import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import type { Db } from "../../db.js";
import { setupAdminTestApp } from "../../test/setupAdminTestApp.js";

describe("/admin/teams", () => {
  let app: FastifyInstance;
  let db: Db;
  let token: string;

  beforeAll(async () => {
    const t = await setupAdminTestApp();
    app = t.app;
    db = t.db;
    token = t.token;

    // Seed a level for creating agents.
    await db.query(
      `insert into agent_levels (id, name, support_rate, stable_rate, stable_months)
       values ($1, $2, $3, $4, $5)`,
      [randomUUID(), "1星", 0.03, 0.01, 12],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates team and manages members (transfer supported)", async () => {
    const levelId = (await db.query<{ id: string }>("select id from agent_levels limit 1")).rows[0]!.id;

    const team1 = await app.inject({
      method: "POST",
      url: "/admin/teams",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "团队A", tag: "A" },
    });
    expect(team1.statusCode).toBe(201);
    const teamId1 = team1.json().id as string;

    const team2 = await app.inject({
      method: "POST",
      url: "/admin/teams",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "团队B", tag: "B" },
    });
    expect(team2.statusCode).toBe(201);
    const teamId2 = team2.json().id as string;

    const createAgent = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        username: "agent1",
        password: "agent123456",
        name: "张三",
        levelId,
      },
    });
    expect(createAgent.statusCode).toBe(201);
    const agentId = createAgent.json().id as string;

    const add1 = await app.inject({
      method: "POST",
      url: `/admin/teams/${teamId1}/members`,
      headers: { authorization: `Bearer ${token}` },
      payload: { agentId },
    });
    expect([200, 201]).toContain(add1.statusCode);

    const members1 = await app.inject({
      method: "GET",
      url: `/admin/teams/${teamId1}/members`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(members1.statusCode).toBe(200);
    const m1 = members1.json() as any[];
    expect(m1.some((m) => m.agentId === agentId && m.name === "张三")).toBe(true);

    // Transfer to team2
    const add2 = await app.inject({
      method: "POST",
      url: `/admin/teams/${teamId2}/members`,
      headers: { authorization: `Bearer ${token}` },
      payload: { agentId },
    });
    expect([200, 201]).toContain(add2.statusCode);

    const members1b = await app.inject({
      method: "GET",
      url: `/admin/teams/${teamId1}/members`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(members1b.statusCode).toBe(200);
    expect((members1b.json() as any[]).length).toBe(0);

    const members2 = await app.inject({
      method: "GET",
      url: `/admin/teams/${teamId2}/members`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(members2.statusCode).toBe(200);
    expect((members2.json() as any[]).some((m) => m.agentId === agentId)).toBe(true);
  });

  it("deletes empty team and blocks team with active members", async () => {
    const empty = await app.inject({
      method: "POST",
      url: "/admin/teams",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: `空团队-${Date.now()}`, tag: "EMPTY" },
    });
    expect(empty.statusCode).toBe(201);
    const emptyTeamId = empty.json().id as string;

    const delEmpty = await app.inject({
      method: "DELETE",
      url: `/admin/teams/${emptyTeamId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(delEmpty.statusCode).toBe(200);
    expect(delEmpty.json().ok).toBe(true);

    const levelId = (await db.query<{ id: string }>("select id from agent_levels limit 1")).rows[0]!.id;
    const team = await app.inject({
      method: "POST",
      url: "/admin/teams",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: `有成员团队-${Date.now()}`, tag: "BUSY" },
    });
    expect(team.statusCode).toBe(201);
    const teamId = team.json().id as string;

    const createAgent = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        username: `teamBlock${Date.now()}`,
        password: "agent123456",
        name: "待拦截成员",
        levelId,
      },
    });
    expect(createAgent.statusCode).toBe(201);
    const agentId = createAgent.json().id as string;

    const add = await app.inject({
      method: "POST",
      url: `/admin/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${token}` },
      payload: { agentId },
    });
    expect([200, 201]).toContain(add.statusCode);

    const delBusy = await app.inject({
      method: "DELETE",
      url: `/admin/teams/${teamId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(delBusy.statusCode).toBe(409);
    expect(delBusy.json().error).toBe("TEAM_HAS_ACTIVE_MEMBERS");
  });
});
