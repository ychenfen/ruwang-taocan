import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import type { Db } from "../../db.js";
import { setupAdminTestApp } from "../../test/setupAdminTestApp.js";

describe("/admin/agents + upline relations", () => {
  let app: FastifyInstance;
  let db: Db;
  let token: string;
  let levelId: string;

  beforeAll(async () => {
    const t = await setupAdminTestApp();
    app = t.app;
    db = t.db;
    token = t.token;

    levelId = randomUUID();
    await db.query(
      `insert into agent_levels (id, name, support_rate, stable_rate, stable_months)
       values ($1, $2, $3, $4, $5)`,
      [levelId, "1星", 0.03, 0.01, 12],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it("prevents cycles when setting uplines", async () => {
    const a = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        username: "agentA",
        password: "agent123456",
        name: "代理A",
        levelId,
      },
    });
    expect(a.statusCode).toBe(201);
    const aId = a.json().id as string;

    const b = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        username: "agentB",
        password: "agent123456",
        name: "代理B",
        levelId,
      },
    });
    expect(b.statusCode).toBe(201);
    const bId = b.json().id as string;

    const setB = await app.inject({
      method: "PUT",
      url: `/admin/agents/${bId}/upline`,
      headers: { authorization: `Bearer ${token}` },
      payload: { uplineAgentId: aId },
    });
    expect(setB.statusCode).toBe(200);

    const getB = await app.inject({
      method: "GET",
      url: `/admin/agents/${bId}/upline`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getB.statusCode).toBe(200);
    expect(getB.json().uplineAgentId).toBe(aId);

    const setA = await app.inject({
      method: "PUT",
      url: `/admin/agents/${aId}/upline`,
      headers: { authorization: `Bearer ${token}` },
      payload: { uplineAgentId: bId },
    });
    expect(setA.statusCode).toBe(400);
    expect(setA.json().error).toBe("CYCLE");

    const clearB = await app.inject({
      method: "PUT",
      url: `/admin/agents/${bId}/upline`,
      headers: { authorization: `Bearer ${token}` },
      payload: { uplineAgentId: null },
    });
    expect(clearB.statusCode).toBe(200);

    const getB2 = await app.inject({
      method: "GET",
      url: `/admin/agents/${bId}/upline`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getB2.statusCode).toBe(200);
    expect(getB2.json().uplineAgentId).toBe(null);
  });

  it("supports upline effectiveAt backfill and same-row rewrite before start", async () => {
    const suffix = randomUUID().slice(0, 8);
    const createAgent = async (code: string) => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/agents",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          username: `${code}_${suffix}`,
          password: "agent123456",
          name: `${code}_${suffix}`,
          levelId,
        },
      });
      expect(res.statusCode).toBe(201);
      return res.json().id as string;
    };

    const aId = await createAgent("A2");
    const bId = await createAgent("B2");
    const cId = await createAgent("C2");

    const set1 = await app.inject({
      method: "PUT",
      url: `/admin/agents/${cId}/upline`,
      headers: { authorization: `Bearer ${token}` },
      payload: { uplineAgentId: bId, effectiveAt: "2026-03-10" },
    });
    expect(set1.statusCode).toBe(200);

    const r1 = await db.query<{ id: string; upline_agent_id: string; start_at: string | Date; end_at: string | Date | null }>(
      `select id, upline_agent_id, start_at, end_at
       from agent_relations
       where agent_id = $1
       order by created_at asc`,
      [cId],
    );
    expect(r1.rows).toHaveLength(1);
    expect(r1.rows[0].upline_agent_id).toBe(bId);
    expect(new Date(String(r1.rows[0].start_at)).toISOString()).toBe("2026-03-09T16:00:00.000Z");
    expect(r1.rows[0].end_at).toBeNull();

    const set2 = await app.inject({
      method: "PUT",
      url: `/admin/agents/${cId}/upline`,
      headers: { authorization: `Bearer ${token}` },
      payload: { uplineAgentId: bId, effectiveAt: "2026-02-01" },
    });
    expect(set2.statusCode).toBe(200);
    expect(set2.json().backfilledStartAt).toBe(true);

    const r2 = await db.query<{ id: string; upline_agent_id: string; start_at: string | Date; end_at: string | Date | null }>(
      `select id, upline_agent_id, start_at, end_at
       from agent_relations
       where agent_id = $1
       order by created_at asc`,
      [cId],
    );
    expect(r2.rows).toHaveLength(1);
    expect(r2.rows[0].upline_agent_id).toBe(bId);
    expect(new Date(String(r2.rows[0].start_at)).toISOString()).toBe("2026-01-31T16:00:00.000Z");
    expect(r2.rows[0].end_at).toBeNull();

    const set3 = await app.inject({
      method: "PUT",
      url: `/admin/agents/${cId}/upline`,
      headers: { authorization: `Bearer ${token}` },
      payload: { uplineAgentId: aId, effectiveAt: "2026-02-01" },
    });
    expect(set3.statusCode).toBe(200);
    expect(set3.json().rewrittenBeforeStart).toBe(true);

    const r3 = await db.query<{ id: string; upline_agent_id: string; start_at: string | Date; end_at: string | Date | null }>(
      `select id, upline_agent_id, start_at, end_at
       from agent_relations
       where agent_id = $1
       order by created_at asc`,
      [cId],
    );
    expect(r3.rows).toHaveLength(1);
    expect(r3.rows[0].upline_agent_id).toBe(aId);
    expect(new Date(String(r3.rows[0].start_at)).toISOString()).toBe("2026-01-31T16:00:00.000Z");
    expect(r3.rows[0].end_at).toBeNull();
  });

  it("deletes an unused agent account", async () => {
    const suffix = randomUUID().slice(0, 8);
    const created = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        username: `agent_del_${suffix}`,
        password: "agent123456",
        name: `删除测试${suffix}`,
        levelId,
      },
    });
    expect(created.statusCode).toBe(201);
    const agentId = created.json().id as string;
    const userId = created.json().userId as string;

    const del = await app.inject({
      method: "DELETE",
      url: `/admin/agents/${agentId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().ok).toBe(true);

    const a = await db.query<{ id: string }>("select id from agents where id = $1", [agentId]);
    expect(a.rows.length).toBe(0);
    const u = await db.query<{ id: string }>("select id from users where id = $1", [userId]);
    expect(u.rows.length).toBe(0);
  });

  it("blocks deleting agent that has owned cards", async () => {
    const suffix = randomUUID().slice(0, 8);
    const created = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        username: `agent_card_${suffix}`,
        password: "agent123456",
        name: `有卡成员${suffix}`,
        levelId,
      },
    });
    expect(created.statusCode).toBe(201);
    const agentId = created.json().id as string;

    const planId = randomUUID();
    await db.query(
      `insert into plans (id, name, monthly_rent, status, created_at)
       values ($1, $2, 29, 'ACTIVE', now())`,
      [planId, `AGENT-DEL-PLAN-${suffix}`],
    );

    const card = await app.inject({
      method: "POST",
      url: "/admin/cards",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        cardNo: `195${suffix.padEnd(8, "0").slice(0, 8)}`,
        activatedAt: "2026-01-01",
        planId,
        ownerAgentId: agentId,
      },
    });
    expect(card.statusCode).toBe(201);

    const del = await app.inject({
      method: "DELETE",
      url: `/admin/agents/${agentId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.statusCode).toBe(409);
    expect(del.json().error).toBe("AGENT_HAS_CARDS");
  });

  it("allows admin to reset agent password", async () => {
    const suffix = randomUUID().slice(0, 8);
    const username = `agent_pwd_${suffix}`;
    const oldPassword = "agent123456";
    const newPassword = "newpass123456";

    const created = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        username,
        password: oldPassword,
        name: `改密测试${suffix}`,
        levelId,
      },
    });
    expect(created.statusCode).toBe(201);
    const agentId = created.json().id as string;

    const update = await app.inject({
      method: "PUT",
      url: `/admin/agents/${agentId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        password: newPassword,
      },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().ok).toBe(true);

    const loginOld = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username, password: oldPassword },
    });
    expect(loginOld.statusCode).toBe(401);
    expect(loginOld.json().error).toBe("INVALID_CREDENTIALS");

    const loginNew = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username, password: newPassword },
    });
    expect(loginNew.statusCode).toBe(200);
    expect(loginNew.json().user.role).toBe("AGENT");
  });
});
