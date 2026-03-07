import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import type { Db } from "../../db.js";
import { setupAdminTestApp } from "../../test/setupAdminTestApp.js";

describe("/admin/ledger", () => {
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

  it("creates ledger entries for posted runs and adjustment batches", async () => {
    const L3 = randomUUID();
    const L1 = randomUUID();
    await db.query(
      `insert into agent_levels (id, name, support_rate, stable_rate, stable_months)
       values
         ($1, 'LED-L3', 0.06, 0.03, 12),
         ($2, 'LED-L1', 0.03, 0.02, 12)`,
      [L3, L1],
    );

    const suffix = randomUUID().slice(0, 8);
    const A = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: { username: `ledgerA_${suffix}`, password: "agent123456", name: "LA", levelId: L3 },
    });
    expect(A.statusCode).toBe(201);
    const aId = A.json().id as string;

    const C = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: { username: `ledgerC_${suffix}`, password: "agent123456", name: "LC", levelId: L1 },
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

    await db.query(
      "update agent_relations set start_at = '2026-01-01T00:00:00+08:00' where agent_id = $1 and upline_agent_id = $2 and end_at is null",
      [cId, aId],
    );
    await db.query(
      "update agent_level_histories set start_at = '2026-01-01T00:00:00+08:00' where agent_id in ($1, $2) and end_at is null",
      [aId, cId],
    );

    const planId = randomUUID();
    await db.query(
      `insert into plans (id, name, monthly_rent, status, created_at)
       values ($1, $2, 29, 'ACTIVE', now())`,
      [planId, `Ledger套餐-${suffix}`],
    );

    const cardNo = `1938${suffix.slice(0, 6)}`;
    const card = await app.inject({
      method: "POST",
      url: "/admin/cards",
      headers: { authorization: `Bearer ${token}` },
      payload: { cardNo, activatedAt: "2026-01-15", planId, ownerAgentId: cId, initialStatus: "NORMAL" },
    });
    expect(card.statusCode).toBe(201);
    const cardId = card.json().id as string;

    const recalc = await app.inject({
      method: "POST",
      url: "/admin/settlements/recalculate",
      headers: { authorization: `Bearer ${token}` },
      payload: { commissionMonth: "2026-02" },
    });
    expect(recalc.statusCode).toBe(200);
    const runId = recalc.json().runId as string;

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/admin/settlements/runs/${runId}/approve`,
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/admin/settlements/runs/${runId}/post`,
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(200);

    const postEntries = await app.inject({
      method: "GET",
      url: "/admin/ledger/entries?commissionMonth=2026-02&sourceType=SETTLEMENT_POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(postEntries.statusCode).toBe(200);
    const postRows = postEntries.json() as Array<any>;
    const postEntry = postRows.find((x) => x.settlementRunId === runId);
    expect(postEntry).toBeTruthy();
    expect(postEntry.lineCount).toBe(2);
    expect(postEntry.totalAmount).toBe(1.74);

    const postLines = await app.inject({
      method: "GET",
      url: `/admin/ledger/entries/${postEntry.id}/lines`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(postLines.statusCode).toBe(200);
    const postLineRows = postLines.json() as Array<any>;
    expect(postLineRows.length).toBe(2);
    expect(postLineRows.some((x) => x.targetKind === "SELF")).toBe(true);
    expect(postLineRows.some((x) => x.targetKind === "UPLINE_DIFF_1")).toBe(true);

    const abnormalAtMonthEnd = await app.inject({
      method: "POST",
      url: `/admin/cards/${cardId}/status-events`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: "ABNORMAL", reason: "ledger-adjust-case", happenedAt: "2026-02-28T23:59:00+08:00" },
    });
    expect(abnormalAtMonthEnd.statusCode).toBe(201);

    const adjust = await app.inject({
      method: "POST",
      url: `/admin/settlements/runs/${runId}/adjust`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: "卡月末异常，按规则本月清零" },
    });
    expect(adjust.statusCode).toBe(200);
    expect(adjust.json().inserted).toBe(2);
    expect(typeof adjust.json().ledgerEntryId).toBe("string");

    const adjEntries = await app.inject({
      method: "GET",
      url: "/admin/ledger/entries?commissionMonth=2026-02&sourceType=SETTLEMENT_ADJUST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(adjEntries.statusCode).toBe(200);
    const adjRows = adjEntries.json() as Array<any>;
    const adjEntry = adjRows.find((x) => x.settlementRunId === runId);
    expect(adjEntry).toBeTruthy();
    expect(adjEntry.lineCount).toBe(2);
    expect(adjEntry.totalAmount).toBe(-1.74);

    const adjLines = await app.inject({
      method: "GET",
      url: `/admin/ledger/entries/${adjEntry.id}/lines`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(adjLines.statusCode).toBe(200);
    const adjLineRows = adjLines.json() as Array<any>;
    expect(adjLineRows.length).toBe(2);
    expect(adjLineRows.every((x) => x.kind === "ADJUSTMENT")).toBe(true);
    expect(adjLineRows.every((x) => x.amount < 0)).toBe(true);

    const summary = await app.inject({
      method: "GET",
      url: "/admin/ledger/summary/agents?commissionMonth=2026-02",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(summary.statusCode).toBe(200);
    const summaryRows = summary.json() as Array<any>;
    expect(summaryRows.length).toBeGreaterThanOrEqual(2);
    const cSummary = summaryRows.find((x) => x.beneficiaryAgentId === cId);
    expect(cSummary).toBeTruthy();
    expect(cSummary.lineCount).toBe(2);
    expect(cSummary.entryCount).toBe(2);
    expect(cSummary.totalAmount).toBe(0);

    const summaryAdjustOnly = await app.inject({
      method: "GET",
      url: "/admin/ledger/summary/agents?commissionMonth=2026-02&sourceType=SETTLEMENT_ADJUST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(summaryAdjustOnly.statusCode).toBe(200);
    const summaryAdjustRows = summaryAdjustOnly.json() as Array<any>;
    const cAdjust = summaryAdjustRows.find((x) => x.beneficiaryAgentId === cId);
    expect(cAdjust).toBeTruthy();
    expect(cAdjust.lineCount).toBe(1);
    expect(cAdjust.entryCount).toBe(1);
    expect(cAdjust.totalAmount).toBe(-0.87);

    const csv = await app.inject({
      method: "GET",
      url: "/admin/ledger/entries.csv?commissionMonth=2026-02",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    const csvText = csv.body;
    const csvLines = csvText.trim().split("\n");
    expect(csvLines.length).toBe(1 + 4); // header + 4 ledger lines
    expect(csvText).toContain("SETTLEMENT_POST");
    expect(csvText).toContain("SETTLEMENT_ADJUST");

    const xlsx = await app.inject({
      method: "GET",
      url: "/admin/ledger/entries.xlsx?commissionMonth=2026-02",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers["content-type"]).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(xlsx.body.length).toBeGreaterThan(100);

    const audit = await app.inject({
      method: "GET",
      url: "/admin/audit-logs?entityType=ledger_entries&action=LEDGER_EXPORT_ENTRIES",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(audit.statusCode).toBe(200);
    const auditRows = audit.json() as Array<any>;
    expect(auditRows.some((x) => x.meta?.format === "csv")).toBe(true);
    expect(auditRows.some((x) => x.meta?.format === "xlsx")).toBe(true);
  });

  it("supports deleting from ledger page by hard-clearing the related settlement run", async () => {
    const levelId = randomUUID();
    await db.query(
      `insert into agent_levels (id, name, support_rate, stable_rate, stable_months)
       values ($1, $2, 0.03, 0.01, 12)`,
      [levelId, `LED-DEL-${levelId.slice(0, 6)}`],
    );

    const suffix = randomUUID().slice(0, 8);
    const owner = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: { username: `ledger_del_${suffix}`, password: "agent123456", name: "删除验证", levelId },
    });
    expect(owner.statusCode).toBe(201);
    const ownerId = owner.json().id as string;

    const planId = randomUUID();
    await db.query(
      `insert into plans (id, name, monthly_rent, status, created_at)
       values ($1, $2, 29, 'ACTIVE', now())`,
      [planId, `Ledger删除套餐-${suffix}`],
    );

    const card = await app.inject({
      method: "POST",
      url: "/admin/cards",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        cardNo: `1949${suffix.slice(0, 6)}`,
        activatedAt: "2026-01-10",
        planId,
        ownerAgentId: ownerId,
        initialStatus: "NORMAL",
      },
    });
    expect(card.statusCode).toBe(201);

    const recalc = await app.inject({
      method: "POST",
      url: "/admin/settlements/recalculate",
      headers: { authorization: `Bearer ${token}` },
      payload: { commissionMonth: "2026-05" },
    });
    expect(recalc.statusCode).toBe(200);
    const runId = recalc.json().runId as string;

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/admin/settlements/runs/${runId}/approve`,
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/admin/settlements/runs/${runId}/post`,
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(200);

    const entriesBefore = await app.inject({
      method: "GET",
      url: "/admin/ledger/entries?commissionMonth=2026-05&sourceType=SETTLEMENT_POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(entriesBefore.statusCode).toBe(200);
    const entryId = (entriesBefore.json() as Array<any>)[0]?.id;
    expect(typeof entryId).toBe("string");

    const del = await app.inject({
      method: "DELETE",
      url: `/admin/ledger/entries/${entryId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().ok).toBe(true);
    expect(del.json().runId).toBe(runId);

    const runRows = await db.query<{ id: string }>("select id from settlement_runs where id = $1", [runId]);
    expect(runRows.rows.length).toBe(0);
    const itemRows = await db.query<{ id: string }>("select id from settlement_items where settlement_run_id = $1", [runId]);
    expect(itemRows.rows.length).toBe(0);
    const entryRows = await db.query<{ id: string }>("select id from ledger_entries where settlement_run_id = $1", [runId]);
    expect(entryRows.rows.length).toBe(0);

    const recalcAgain = await app.inject({
      method: "POST",
      url: "/admin/settlements/recalculate",
      headers: { authorization: `Bearer ${token}` },
      payload: { commissionMonth: "2026-05" },
    });
    expect(recalcAgain.statusCode).toBe(200);
  });
});
