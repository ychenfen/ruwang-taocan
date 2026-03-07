import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import type { Db } from "../../db.js";
import { setupAdminTestApp } from "../../test/setupAdminTestApp.js";

describe("/admin/settlements", () => {
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

  it("recalculates DRAFT items for a month and supports agent-scoped refresh", async () => {
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

    const A = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: { username: "settA", password: "agent123456", name: "A", levelId: L3 },
    });
    expect(A.statusCode).toBe(201);
    const aId = A.json().id as string;

    const B = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: { username: "settB", password: "agent123456", name: "B", levelId: L2 },
    });
    expect(B.statusCode).toBe(201);
    const bId = B.json().id as string;

    const C = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: { username: "settC", password: "agent123456", name: "C", levelId: L1 },
    });
    expect(C.statusCode).toBe(201);
    const cId = C.json().id as string;

    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/admin/agents/${bId}/upline`,
          headers: { authorization: `Bearer ${token}` },
          payload: { uplineAgentId: aId },
        })
      ).statusCode,
    ).toBe(200);

    // Backdate hierarchy to make historical month-end snapshot deterministic.
    await db.query(
      "update agent_relations set start_at = '2026-01-01T00:00:00+08:00' where agent_id = $1 and upline_agent_id = $2 and end_at is null",
      [bId, aId],
    );
    await db.query(
      "update agent_relations set start_at = '2026-01-01T00:00:00+08:00' where agent_id = $1 and upline_agent_id = $2 and end_at is null",
      [cId, bId],
    );
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/admin/agents/${cId}/upline`,
          headers: { authorization: `Bearer ${token}` },
          payload: { uplineAgentId: bId },
        })
      ).statusCode,
    ).toBe(200);

    const planId = randomUUID();
    await db.query(`insert into plans (id, name, monthly_rent, status, created_at) values ($1, $2, $3, 'ACTIVE', now())`, [
      planId,
      "双百套餐 2.0",
      29,
    ]);

    const card = await app.inject({
      method: "POST",
      url: "/admin/cards",
      headers: { authorization: `Bearer ${token}` },
      payload: { cardNo: "19213309999", activatedAt: "2026-01-15", planId, ownerAgentId: cId, initialStatus: "NORMAL" },
    });
    expect(card.statusCode).toBe(201);

    const recalcAll = await app.inject({
      method: "POST",
      url: "/admin/settlements/recalculate",
      headers: { authorization: `Bearer ${token}` },
      payload: { commissionMonth: "2026-02" },
    });
    expect(recalcAll.statusCode).toBe(200);
    expect(recalcAll.json().inserted).toBe(1);
    const runId = recalcAll.json().runId as string;

    const logs1 = await app.inject({
      method: "GET",
      url: "/admin/settlements/executions?commissionMonth=2026-02",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logs1.statusCode).toBe(200);
    const logRows1 = logs1.json() as any[];
    expect(logRows1.length).toBeGreaterThan(0);
    expect(logRows1[0].triggerType).toBe("MANUAL");
    expect(logRows1[0].status).toBe("SUCCEEDED");
    expect(logRows1[0].insertedCount).toBe(1);
    expect(logRows1[0].deletedCount).toBe(0);
    expect(logRows1[0].runId).toBe(runId);

    const items = await app.inject({
      method: "GET",
      url: `/admin/settlements/runs/${runId}/items`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(items.statusCode).toBe(200);
    const itms = items.json() as any[];
    expect(itms.length).toBe(1);

    const self = itms.find((x) => x.kind === "SELF");
    expect(self).toBeTruthy();
    expect(self.beneficiaryAgentId).toBe(cId);
    expect(self.amount).toBe(0.87);

    const recalcC = await app.inject({
      method: "POST",
      url: "/admin/settlements/recalculate",
      headers: { authorization: `Bearer ${token}` },
      payload: { commissionMonth: "2026-02", agentId: cId },
    });
    expect(recalcC.statusCode).toBe(200);
    // Agent-scoped recalc now refreshes all rows related to scoped cards.
    expect(recalcC.json().deleted).toBe(1);
    expect(recalcC.json().inserted).toBe(1);

    const items2 = await app.inject({
      method: "GET",
      url: `/admin/settlements/runs/${runId}/items`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(items2.statusCode).toBe(200);
    const rows2 = items2.json() as any[];
    expect(rows2.length).toBe(1);
    expect(rows2.some((x) => x.kind === "SELF" && x.beneficiaryAgentId === cId)).toBe(true);
    expect(rows2.some((x) => x.kind === "UPLINE_DIFF_2")).toBe(false);
  });

  it("does not fallback to current upline relation when month-end historical relation is absent", async () => {
    const L3 = randomUUID();
    const L1 = randomUUID();
    await db.query(
      `insert into agent_levels (id, name, support_rate, stable_rate, stable_months)
       values
         ($1, 'FB-L3', 0.06, 0.03, 12),
         ($2, 'FB-L1', 0.03, 0.02, 12)`,
      [L3, L1],
    );

    const suffix = randomUUID().slice(0, 8);
    const A = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: { username: `fbA_${suffix}`, password: "agent123456", name: "FBA", levelId: L3 },
    });
    expect(A.statusCode).toBe(201);
    const aId = A.json().id as string;

    const C = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: { username: `fbC_${suffix}`, password: "agent123456", name: "FBC", levelId: L1 },
    });
    expect(C.statusCode).toBe(201);
    const cId = C.json().id as string;

    // Relation start_at defaults to now; for commissionMonth=2026-01 it is historically absent.
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/admin/agents/${cId}/upline`,
          headers: { authorization: `Bearer ${token}` },
          payload: { uplineAgentId: aId },
        })
      ).statusCode,
    ).toBe(200);

    const planId = randomUUID();
    await db.query(`insert into plans (id, name, monthly_rent, status, created_at) values ($1, $2, $3, 'ACTIVE', now())`, [
      planId,
      `回退关系套餐-${suffix}`,
      29,
    ]);

    const card = await app.inject({
      method: "POST",
      url: "/admin/cards",
      headers: { authorization: `Bearer ${token}` },
      payload: { cardNo: `1955${suffix.slice(0, 6)}`, activatedAt: "2025-12-15", planId, ownerAgentId: cId, initialStatus: "NORMAL" },
    });
    expect(card.statusCode).toBe(201);
    const cardId = card.json().id as string;

    const recalc = await app.inject({
      method: "POST",
      url: "/admin/settlements/recalculate",
      headers: { authorization: `Bearer ${token}` },
      payload: { commissionMonth: "2026-01" },
    });
    expect(recalc.statusCode).toBe(200);
    const runId = recalc.json().runId as string;

    const items = await app.inject({
      method: "GET",
      url: `/admin/settlements/runs/${runId}/items`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(items.statusCode).toBe(200);
    const rows = (items.json() as any[]).filter((x) => x.cardId === cardId);
    expect(rows.some((x) => x.kind === "SELF" && x.beneficiaryAgentId === cId)).toBe(true);
    expect(rows.some((x) => x.kind === "UPLINE_DIFF_1" && x.beneficiaryAgentId === aId)).toBe(false);
  });

  it("uses current agent level at settlement time (recalc reflects upgrades immediately)", async () => {
    const L3 = randomUUID();
    const L1 = randomUUID();
    await db.query(
      `insert into agent_levels (id, name, support_rate, stable_rate, stable_months)
       values
         ($1, 'H-L3', 0.06, 0.03, 12),
         ($2, 'H-L1', 0.03, 0.02, 12)`,
      [L3, L1],
    );

    const suffix = randomUUID().slice(0, 8);
    const A = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: { username: `histA_${suffix}`, password: "agent123456", name: "HA", levelId: L3 },
    });
    expect(A.statusCode).toBe(201);
    const aId = A.json().id as string;

    const C = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: { username: `histC_${suffix}`, password: "agent123456", name: "HC", levelId: L1 },
    });
    expect(C.statusCode).toBe(201);
    const cId = C.json().id as string;

    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/admin/agents/${cId}/upline`,
          headers: { authorization: `Bearer ${token}` },
          payload: { uplineAgentId: aId },
        })
      ).statusCode,
    ).toBe(200);

    // Backdate relation/level effective timestamps so 2026-01 settlement has a stable historical snapshot.
    await db.query(
      "update agent_relations set start_at = '2025-12-01T00:00:00+08:00' where agent_id = $1 and upline_agent_id = $2 and end_at is null",
      [cId, aId],
    );
    await db.query(
      "update agent_level_histories set start_at = '2025-12-01T00:00:00+08:00' where agent_id in ($1, $2) and end_at is null",
      [aId, cId],
    );

    const planId = randomUUID();
    await db.query(
      `insert into plans (id, name, monthly_rent, status, created_at)
       values ($1, $2, $3, 'ACTIVE', now())`,
      [planId, `历史口径套餐-${suffix}`, 29],
    );

    const card = await app.inject({
      method: "POST",
      url: "/admin/cards",
      headers: { authorization: `Bearer ${token}` },
      payload: { cardNo: `193200${suffix.slice(0, 6)}`, activatedAt: "2025-12-15", planId, ownerAgentId: cId, initialStatus: "NORMAL" },
    });
    expect(card.statusCode).toBe(201);
    const cardId = card.json().id as string;

    const recalc1 = await app.inject({
      method: "POST",
      url: "/admin/settlements/recalculate",
      headers: { authorization: `Bearer ${token}` },
      payload: { commissionMonth: "2026-01" },
    });
    expect(recalc1.statusCode).toBe(200);
    const runId = recalc1.json().runId as string;

    const changeLevel = await app.inject({
      method: "PUT",
      url: `/admin/agents/${cId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { levelId: L3 },
    });
    expect(changeLevel.statusCode).toBe(200);

    const recalc2 = await app.inject({
      method: "POST",
      url: "/admin/settlements/recalculate",
      headers: { authorization: `Bearer ${token}` },
      payload: { commissionMonth: "2026-01" },
    });
    expect(recalc2.statusCode).toBe(200);

    const items = await app.inject({
      method: "GET",
      url: `/admin/settlements/runs/${runId}/items`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(items.statusCode).toBe(200);
    const itms = (items.json() as any[]).filter((x) => x.cardId === cardId);

    const self = itms.find((x) => x.kind === "SELF");
    const diff1 = itms.find((x) => x.kind === "UPLINE_DIFF_1");
    expect(self).toBeTruthy();
    // After upgrade, upline diff becomes 0 because upline level == current level.
    expect(diff1).toBeFalsy();
    expect(self.beneficiaryAgentId).toBe(cId);
    expect(self.amount).toBe(1.74);
  });

  it("supports approve/post and creates adjustment items after POSTED", async () => {
    const levels = await db.query<{ id: string; name: string }>(
      "select id, name from agent_levels where name in ('L3','L2','L1')",
    );
    const byName: Record<string, string> = {};
    for (const l of levels.rows) byName[l.name] = l.id;
    expect(byName.L3).toBeTruthy();
    expect(byName.L2).toBeTruthy();
    expect(byName.L1).toBeTruthy();

    const suffix = randomUUID().slice(0, 8);
    const A = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: { username: `postA_${suffix}`, password: "agent123456", name: "A2", levelId: byName.L3 },
    });
    expect(A.statusCode).toBe(201);
    const aId = A.json().id as string;

    const B = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: { username: `postB_${suffix}`, password: "agent123456", name: "B2", levelId: byName.L2 },
    });
    expect(B.statusCode).toBe(201);
    const bId = B.json().id as string;

    const C = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: { username: `postC_${suffix}`, password: "agent123456", name: "C2", levelId: byName.L1 },
    });
    expect(C.statusCode).toBe(201);
    const cId = C.json().id as string;

    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/admin/agents/${bId}/upline`,
          headers: { authorization: `Bearer ${token}` },
          payload: { uplineAgentId: aId },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/admin/agents/${cId}/upline`,
          headers: { authorization: `Bearer ${token}` },
          payload: { uplineAgentId: bId },
        })
      ).statusCode,
    ).toBe(200);

    const planId = randomUUID();
    await db.query(
      `insert into plans (id, name, monthly_rent, status, created_at) values ($1, $2, $3, 'ACTIVE', now())`,
      [planId, `双百套餐-${suffix}`, 29],
    );

    const cardNo = `1921999${suffix.slice(0, 4)}`;
    const card = await app.inject({
      method: "POST",
      url: "/admin/cards",
      headers: { authorization: `Bearer ${token}` },
      payload: { cardNo, activatedAt: "2026-03-15", planId, ownerAgentId: cId, initialStatus: "NORMAL" },
    });
    expect(card.statusCode).toBe(201);
    const cardId = card.json().id as string;

    const recalc = await app.inject({
      method: "POST",
      url: "/admin/settlements/recalculate",
      headers: { authorization: `Bearer ${token}` },
      payload: { commissionMonth: "2026-04" },
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

    const recalcAfterPost = await app.inject({
      method: "POST",
      url: "/admin/settlements/recalculate",
      headers: { authorization: `Bearer ${token}` },
      payload: { commissionMonth: "2026-04" },
    });
    expect(recalcAfterPost.statusCode).toBe(409);
    expect(recalcAfterPost.json().error).toBe("NOT_DRAFT");

    const logs2 = await app.inject({
      method: "GET",
      url: "/admin/settlements/executions?commissionMonth=2026-04&status=FAILED",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logs2.statusCode).toBe(200);
    const failedRows = logs2.json() as any[];
    expect(failedRows.length).toBeGreaterThan(0);
    expect(failedRows[0].status).toBe("FAILED");
    expect(failedRows[0].errorCode).toBe("NOT_DRAFT");

    // Make the card abnormal at the end of month => should result in 0 commission for 2026-04.
    const ev = await app.inject({
      method: "POST",
      url: `/admin/cards/${cardId}/status-events`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: "ABNORMAL", happenedAt: "2026-04-30", reason: "test" },
    });
    expect(ev.statusCode).toBe(201);

    const adjust = await app.inject({
      method: "POST",
      url: `/admin/settlements/runs/${runId}/adjust`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: "status abnormal" },
    });
    expect(adjust.statusCode).toBe(200);
    expect(adjust.json().inserted).toBe(2);

    const items = await app.inject({
      method: "GET",
      url: `/admin/settlements/runs/${runId}/items`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(items.statusCode).toBe(200);
    const itms = items.json() as any[];
    const related = itms.filter((x) => x.cardId === cardId);
    expect(related.length).toBe(4);
    expect(related.filter((x) => x.kind === "ADJUSTMENT").length).toBe(2);

    const sum = (beneficiary: string) =>
      itms.filter((x) => x.beneficiaryAgentId === beneficiary).reduce((acc, x) => acc + x.amount, 0);
    expect(sum(aId)).toBeCloseTo(0, 10);
    expect(sum(cId)).toBeCloseTo(0, 10);

    const adjust2 = await app.inject({
      method: "POST",
      url: `/admin/settlements/runs/${runId}/adjust`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: "status abnormal" },
    });
    expect(adjust2.statusCode).toBe(200);
    expect(adjust2.json().inserted).toBe(0);

    const diff = await app.inject({
      method: "GET",
      url: `/admin/settlements/runs/${runId}/diff`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(diff.statusCode).toBe(200);
    const diffRows = (diff.json().rows as any[]).filter((x) => x.cardId === cardId);
    expect(diffRows.length).toBe(2);
    const dSelf = diffRows.find((x) => x.targetKind === "SELF" && x.beneficiaryAgentId === cId);
    const dDiff2 = diffRows.find((x) => x.targetKind === "UPLINE_DIFF_2" && x.beneficiaryAgentId === aId);
    expect(dSelf.changed).toBe(true);
    expect(dDiff2.changed).toBe(true);
    expect(dSelf.netAmount).toBeCloseTo(0, 10);
    expect(dDiff2.netAmount).toBeCloseTo(0, 10);

    const csv = await app.inject({
      method: "GET",
      url: `/admin/reports/settlement-items.csv?commissionMonth=2026-04`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(csv.statusCode).toBe(200);
    expect(String(csv.headers["content-type"])).toContain("text/csv");
    expect(csv.body).toContain("佣金月份");
    expect(csv.body).toContain("结算状态");
    expect(csv.body).toContain("2026-04");

    const csvAOnly = await app.inject({
      method: "GET",
      url: `/admin/reports/settlement-items.csv?commissionMonth=2026-04&beneficiaryAgentId=${aId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(csvAOnly.statusCode).toBe(200);
    const lines = csvAOnly.body.trim().split("\n");
    expect(lines.length).toBe(3); // header + 2 items for A (base + adjustment)
  });
});
