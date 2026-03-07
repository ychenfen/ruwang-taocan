import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import type { Db } from "../../db.js";
import { setupAdminTestApp } from "../../test/setupAdminTestApp.js";

describe("/admin/cards", () => {
  let app: FastifyInstance;
  let db: Db;
  let token: string;
  let levelId: string;
  let planId: string;
  let policyId: string;

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

    // Plan + policy required by card create.
    planId = randomUUID();
    await db.query(`insert into plans (id, name, monthly_rent, status, created_at) values ($1, $2, $3, 'ACTIVE', now())`, [
      planId,
      "双百套餐 2.0",
      29,
    ]);

    policyId = randomUUID();
    await db.query(`insert into policies (id, name, status, created_at) values ($1, $2, 'ACTIVE', now())`, [
      policyId,
      "政策A",
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates card with assignment + status, then transfer + add status event", async () => {
    const a1 = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        username: "owner1",
        password: "agent123456",
        name: "开卡人1",
        levelId,
      },
    });
    expect(a1.statusCode).toBe(201);
    const owner1 = a1.json().id as string;

    const a2 = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        username: "owner2",
        password: "agent123456",
        name: "开卡人2",
        levelId,
      },
    });
    expect(a2.statusCode).toBe(201);
    const owner2 = a2.json().id as string;

    const create = await app.inject({
      method: "POST",
      url: "/admin/cards",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        cardNo: "19213300001",
        activatedAt: "2026-01-15",
        planId,
        policyId,
        ownerAgentId: owner1,
        initialStatus: "NORMAL",
      },
    });
    expect(create.statusCode).toBe(201);
    const cardId = create.json().id as string;

    const list1 = await app.inject({
      method: "GET",
      url: "/admin/cards",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list1.statusCode).toBe(200);
    const cards1 = list1.json() as any[];
    const c1 = cards1.find((c) => c.id === cardId);
    expect(c1).toBeTruthy();
    expect(c1.ownerAgentId).toBe(owner1);
    expect(c1.currentStatus).toBe("NORMAL");
    expect(c1.monthlyRent).toBe(29);

    const transfer = await app.inject({
      method: "POST",
      url: `/admin/cards/${cardId}/assign`,
      headers: { authorization: `Bearer ${token}` },
      payload: { ownerAgentId: owner2, effectiveAt: "2026-02-01" },
    });
    expect(transfer.statusCode).toBe(201);

    const addEvent = await app.inject({
      method: "POST",
      url: `/admin/cards/${cardId}/status-events`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: "ABNORMAL", happenedAt: "2026-03-01", reason: "测试异常" },
    });
    expect(addEvent.statusCode).toBe(201);

    const list2 = await app.inject({
      method: "GET",
      url: "/admin/cards",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list2.statusCode).toBe(200);
    const cards2 = list2.json() as any[];
    const c2 = cards2.find((c) => c.id === cardId);
    expect(c2.ownerAgentId).toBe(owner2);
    expect(c2.currentStatus).toBe("ABNORMAL");

    const events = await app.inject({
      method: "GET",
      url: `/admin/cards/${cardId}/status-events`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(events.statusCode).toBe(200);
    const ev = events.json() as any[];
    expect(ev.length).toBeGreaterThanOrEqual(2); // initial + abnormal
    expect(ev.some((e) => e.status === "ABNORMAL")).toBe(true);
    const abnormal = ev.find((e) => e.status === "ABNORMAL");
    expect(new Date(String(abnormal.happenedAt)).toISOString()).toBe("2026-02-28T16:00:00.000Z");

    const assignmentRows = await db.query<{ start_at: string | Date; end_at: string | Date | null }>(
      `select start_at, end_at
       from card_assignments
       where card_id = $1
       order by created_at asc`,
      [cardId],
    );
    expect(assignmentRows.rows).toHaveLength(2);
    const firstEnd = new Date(String(assignmentRows.rows[0].end_at));
    const secondStart = new Date(String(assignmentRows.rows[1].start_at));
    expect(firstEnd.toISOString()).toBe("2026-01-31T16:00:00.000Z");
    expect(secondStart.toISOString()).toBe("2026-01-31T16:00:00.000Z");
  });

  it("rewrites active assignment when effectiveAt equals current start_at, and blocks earlier effectiveAt", async () => {
    const suffix = randomUUID().slice(0, 8);
    const a1 = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        username: `eqOwner1_${suffix}`,
        password: "agent123456",
        name: "等时点转移-原归属",
        levelId,
      },
    });
    expect(a1.statusCode).toBe(201);
    const owner1 = a1.json().id as string;

    const a2 = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        username: `eqOwner2_${suffix}`,
        password: "agent123456",
        name: "等时点转移-新归属",
        levelId,
      },
    });
    expect(a2.statusCode).toBe(201);
    const owner2 = a2.json().id as string;

    const create = await app.inject({
      method: "POST",
      url: "/admin/cards",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        cardNo: `1981${suffix.slice(0, 6)}`,
        activatedAt: "2026-03-02",
        planId,
        ownerAgentId: owner1,
        initialStatus: "NORMAL",
      },
    });
    expect(create.statusCode).toBe(201);
    const cardId = create.json().id as string;

    const rewrite = await app.inject({
      method: "POST",
      url: `/admin/cards/${cardId}/assign`,
      headers: { authorization: `Bearer ${token}` },
      payload: { ownerAgentId: owner2, effectiveAt: "2026-03-02" },
    });
    expect(rewrite.statusCode).toBe(200);
    expect(rewrite.json().rewritten).toBe(true);

    const rowsAfterRewrite = await db.query<{
      id: string;
      owner_agent_id: string;
      start_at: string | Date;
      end_at: string | Date | null;
    }>(
      `select id, owner_agent_id, start_at, end_at
       from card_assignments
       where card_id = $1
       order by created_at asc`,
      [cardId],
    );
    expect(rowsAfterRewrite.rows).toHaveLength(1);
    expect(rowsAfterRewrite.rows[0].owner_agent_id).toBe(owner2);
    expect(rowsAfterRewrite.rows[0].end_at).toBeNull();
    expect(new Date(String(rowsAfterRewrite.rows[0].start_at)).toISOString()).toBe("2026-03-01T16:00:00.000Z");

    const invalidEarlier = await app.inject({
      method: "POST",
      url: `/admin/cards/${cardId}/assign`,
      headers: { authorization: `Bearer ${token}` },
      payload: { ownerAgentId: owner1, effectiveAt: "2026-03-01" },
    });
    expect(invalidEarlier.statusCode).toBe(400);
    expect(invalidEarlier.json().error).toBe("ASSIGN_EFFECTIVE_AT_BEFORE_CURRENT_START");
  });

  it("updates plan with empty policyId payload for backward compatibility", async () => {
    const suffix = randomUUID().slice(0, 8);
    const owner = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        username: `updOwner_${suffix}`,
        password: "agent123456",
        name: "更新卡测试代理",
        levelId,
      },
    });
    expect(owner.statusCode).toBe(201);
    const ownerId = owner.json().id as string;

    const planId2 = randomUUID();
    await db.query(`insert into plans (id, name, monthly_rent, status, created_at) values ($1, $2, $3, 'ACTIVE', now())`, [
      planId2,
      `兼容套餐-${suffix}`,
      39,
    ]);

    const create = await app.inject({
      method: "POST",
      url: "/admin/cards",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        cardNo: `1944${suffix.slice(0, 6)}`,
        activatedAt: "2026-02-01",
        planId,
        ownerAgentId: ownerId,
        initialStatus: "NORMAL",
      },
    });
    expect(create.statusCode).toBe(201);
    const cardId = create.json().id as string;

    const update = await app.inject({
      method: "PUT",
      url: `/admin/cards/${cardId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        planId: planId2,
        policyId: "",
      },
    });
    expect(update.statusCode).toBe(200);

    const list = await app.inject({
      method: "GET",
      url: "/admin/cards",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.statusCode).toBe(200);
    const card = (list.json() as any[]).find((x) => x.id === cardId);
    expect(card).toBeTruthy();
    expect(card.planId).toBe(planId2);
    expect(card.policyId).toBeUndefined();
  });

  it("deletes card when no settlement items, and blocks delete once settled", async () => {
    const suffix = randomUUID().slice(0, 8);
    const owner = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        username: `delOwner_${suffix}`,
        password: "agent123456",
        name: "删除卡测试代理",
        levelId,
      },
    });
    expect(owner.statusCode).toBe(201);
    const ownerId = owner.json().id as string;

    const cardNo1 = `1922${suffix.slice(0, 6)}`;
    const create1 = await app.inject({
      method: "POST",
      url: "/admin/cards",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        cardNo: cardNo1,
        activatedAt: "2026-02-01",
        planId,
        ownerAgentId: ownerId,
        initialStatus: "NORMAL",
      },
    });
    expect(create1.statusCode).toBe(201);
    const card1Id = create1.json().id as string;

    const del1 = await app.inject({
      method: "DELETE",
      url: `/admin/cards/${card1Id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del1.statusCode).toBe(200);
    expect(del1.json().ok).toBe(true);

    const cardNo2 = `1933${suffix.slice(0, 6)}`;
    const create2 = await app.inject({
      method: "POST",
      url: "/admin/cards",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        cardNo: cardNo2,
        activatedAt: "2026-01-01",
        planId,
        ownerAgentId: ownerId,
        initialStatus: "NORMAL",
      },
    });
    expect(create2.statusCode).toBe(201);
    const card2Id = create2.json().id as string;

    const recalc = await app.inject({
      method: "POST",
      url: "/admin/settlements/recalculate",
      headers: { authorization: `Bearer ${token}` },
      payload: { commissionMonth: "2026-02" },
    });
    expect(recalc.statusCode).toBe(200);

    const del2 = await app.inject({
      method: "DELETE",
      url: `/admin/cards/${card2Id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del2.statusCode).toBe(409);
    expect(del2.json().error).toBe("CARD_HAS_SETTLEMENT_ITEMS");
  });

  it("deletes status event with safeguards (not last event, not affecting posted months)", async () => {
    const suffix = randomUUID().slice(0, 8);
    const owner = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        username: `evOwner_${suffix}`,
        password: "agent123456",
        name: "事件删除测试代理",
        levelId,
      },
    });
    expect(owner.statusCode).toBe(201);
    const ownerId = owner.json().id as string;

    const create = await app.inject({
      method: "POST",
      url: "/admin/cards",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        cardNo: `1955${suffix.slice(0, 6)}`,
        activatedAt: "2026-01-01",
        planId,
        ownerAgentId: ownerId,
        initialStatus: "NORMAL",
      },
    });
    expect(create.statusCode).toBe(201);
    const cardId = create.json().id as string;

    const list0 = await app.inject({
      method: "GET",
      url: `/admin/cards/${cardId}/status-events`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list0.statusCode).toBe(200);
    const initial = (list0.json() as any[])[0];
    expect(initial).toBeTruthy();

    // Last event cannot be deleted.
    const delLast = await app.inject({
      method: "DELETE",
      url: `/admin/cards/${cardId}/status-events/${initial.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(delLast.statusCode).toBe(409);
    expect(delLast.json().error).toBe("LAST_STATUS_EVENT_CANNOT_DELETE");

    // Add second event so deletion can be attempted.
    const add2 = await app.inject({
      method: "POST",
      url: `/admin/cards/${cardId}/status-events`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: "NORMAL", happenedAt: "2026-02-10", reason: "补充正常状态" },
    });
    expect(add2.statusCode).toBe(201);
    const secondId = add2.json().id as string;

    // Delete non-protected event before posting: allowed.
    const del2 = await app.inject({
      method: "DELETE",
      url: `/admin/cards/${cardId}/status-events/${secondId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del2.statusCode).toBe(200);
    expect(del2.json().ok).toBe(true);

    // Re-add second event then post settlement for 2026-02.
    const add3 = await app.inject({
      method: "POST",
      url: `/admin/cards/${cardId}/status-events`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: "NORMAL", happenedAt: "2026-02-10", reason: "用于入账锁定测试" },
    });
    expect(add3.statusCode).toBe(201);

    const recalc = await app.inject({
      method: "POST",
      url: "/admin/settlements/recalculate",
      headers: { authorization: `Bearer ${token}` },
      payload: { commissionMonth: "2026-02" },
    });
    expect(recalc.statusCode).toBe(200);
    const runId = recalc.json().runId as string;

    const approve = await app.inject({
      method: "POST",
      url: `/admin/settlements/runs/${runId}/approve`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(approve.statusCode).toBe(200);

    const post = await app.inject({
      method: "POST",
      url: `/admin/settlements/runs/${runId}/post`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(post.statusCode).toBe(200);

    // Initial event month <= posted commission month, so deletion must be blocked.
    const delLocked = await app.inject({
      method: "DELETE",
      url: `/admin/cards/${cardId}/status-events/${initial.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(delLocked.statusCode).toBe(409);
    expect(delLocked.json().error).toBe("STATUS_EVENT_LOCKED_BY_POSTED_SETTLEMENT");
  });

  it("supports paged list response with total + filters", async () => {
    const suffix = randomUUID().slice(0, 8);
    const owner = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        username: `listOwner_${suffix}`,
        password: "agent123456",
        name: `列表测试代理-${suffix}`,
        levelId,
      },
    });
    expect(owner.statusCode).toBe(201);
    const ownerId = owner.json().id as string;

    const cardNoNormal = `1966${suffix.slice(0, 6)}`;
    const c1 = await app.inject({
      method: "POST",
      url: "/admin/cards",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        cardNo: cardNoNormal,
        activatedAt: "2026-02-01",
        planId,
        ownerAgentId: ownerId,
        initialStatus: "NORMAL",
      },
    });
    expect(c1.statusCode).toBe(201);

    const cardNoAbnormal = `1977${suffix.slice(0, 6)}`;
    const c2 = await app.inject({
      method: "POST",
      url: "/admin/cards",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        cardNo: cardNoAbnormal,
        activatedAt: "2026-02-01",
        planId,
        ownerAgentId: ownerId,
        initialStatus: "ABNORMAL",
      },
    });
    expect(c2.statusCode).toBe(201);

    const list = await app.inject({
      method: "GET",
      url: `/admin/cards?withTotal=1&limit=20&offset=0&keyword=${encodeURIComponent(cardNoNormal)}&status=NORMAL&ownerAgentId=${ownerId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as any;
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.total).toBe(1);
    expect(body.rows.length).toBe(1);
    expect(body.rows[0].cardNo).toBe(cardNoNormal);
    expect(body.rows[0].ownerAgentId).toBe(ownerId);
    expect(body.rows[0].currentStatus).toBe("NORMAL");
  });

  it("gets card detail by id", async () => {
    const suffix = randomUUID().slice(0, 8);
    const owner = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        username: `detailOwner_${suffix}`,
        password: "agent123456",
        name: `详情测试代理-${suffix}`,
        levelId,
      },
    });
    expect(owner.statusCode).toBe(201);
    const ownerId = owner.json().id as string;

    const cardNo = `1988${suffix.slice(0, 6)}`;
    const create = await app.inject({
      method: "POST",
      url: "/admin/cards",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        cardNo,
        activatedAt: "2026-02-01",
        planId,
        policyId,
        ownerAgentId: ownerId,
        initialStatus: "PAUSED",
      },
    });
    expect(create.statusCode).toBe(201);
    const cardId = create.json().id as string;

    const detail = await app.inject({
      method: "GET",
      url: `/admin/cards/${cardId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json() as any;
    expect(body.id).toBe(cardId);
    expect(body.cardNo).toBe(cardNo);
    expect(body.ownerAgentId).toBe(ownerId);
    expect(body.currentStatus).toBe("PAUSED");
    expect(body.planId).toBe(planId);
    expect(body.policyId).toBe(policyId);
  });
});
