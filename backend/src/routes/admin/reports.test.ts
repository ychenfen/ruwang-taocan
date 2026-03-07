import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import type { Db } from "../../db.js";
import { setupAdminTestApp } from "../../test/setupAdminTestApp.js";

describe("/admin/reports", () => {
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

  it("returns settlement items preview with pagination and filters", async () => {
    const L3 = randomUUID();
    const L2 = randomUUID();
    const L1 = randomUUID();
    await db.query(
      `insert into agent_levels (id, name, support_rate, stable_rate, stable_months)
       values
         ($1, 'RP-L3', 0.06, 0.03, 12),
         ($2, 'RP-L2', 0.03, 0.02, 12),
         ($3, 'RP-L1', 0.03, 0.02, 12)`,
      [L3, L2, L1],
    );

    const suffix = randomUUID().slice(0, 8);
    const A = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: { username: `rpA_${suffix}`, password: "agent123456", name: "RP-A", levelId: L3 },
    });
    expect(A.statusCode).toBe(201);
    const aId = A.json().id as string;

    const B = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: { username: `rpB_${suffix}`, password: "agent123456", name: "RP-B", levelId: L2 },
    });
    expect(B.statusCode).toBe(201);
    const bId = B.json().id as string;

    const C = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: { username: `rpC_${suffix}`, password: "agent123456", name: "RP-C", levelId: L1 },
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
    await db.query(
      `insert into plans (id, name, monthly_rent, status, created_at)
       values ($1, $2, $3, 'ACTIVE', now())`,
      [planId, `RP-套餐-${suffix}`, 29],
    );

    const cardNo = `1922777${suffix.slice(0, 4)}`;
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

    const preview = await app.inject({
      method: "GET",
      url: "/admin/reports/settlement-items-preview?commissionMonth=2026-02&limit=1&offset=0",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json() as any;
    expect(body.commissionMonth).toBe("2026-02");
    expect(body.total).toBe(1);
    expect(body.limit).toBe(1);
    expect(body.offset).toBe(0);
    expect(body.rows.length).toBe(1);
    expect(body.rows[0].itemId).toBeTruthy();
    expect(body.rows[0].targetKind).toBeTruthy();

    const onlySelf = await app.inject({
      method: "GET",
      url: "/admin/reports/settlement-items-preview?commissionMonth=2026-02&kind=SELF",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(onlySelf.statusCode).toBe(200);
    const onlySelfRows = (onlySelf.json() as any).rows as any[];
    expect(onlySelfRows.length).toBe(1);
    expect(onlySelfRows[0].kindRaw).toBe("SELF");

    const csv = await app.inject({
      method: "GET",
      url: "/admin/reports/settlement-items.csv?commissionMonth=2026-02",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body).toContain("佣金月份");
    expect(csv.body).toContain("结算状态");
    expect(csv.body).toContain("2026-02");

    const xlsx = await app.inject({
      method: "GET",
      url: "/admin/reports/settlement-items.xlsx?commissionMonth=2026-02",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers["content-type"]).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(xlsx.body.length).toBeGreaterThan(100);

    const billCsv = await app.inject({
      method: "GET",
      url: "/admin/reports/bill.csv?commissionMonth=2026-02",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(billCsv.statusCode).toBe(200);
    expect(billCsv.headers["content-type"]).toContain("text/csv");
    expect(billCsv.body).toContain("卡号");
    expect(billCsv.body).toContain("入网日期");
    expect(billCsv.body).toContain("总计：");

    const billXlsx = await app.inject({
      method: "GET",
      url: "/admin/reports/bill.xlsx?commissionMonth=2026-02",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(billXlsx.statusCode).toBe(200);
    expect(billXlsx.headers["content-type"]).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(billXlsx.body.length).toBeGreaterThan(100);

    const audit = await app.inject({
      method: "GET",
      url: "/admin/audit-logs?entityType=reports&action=REPORT_EXPORT_SETTLEMENT_ITEMS",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(audit.statusCode).toBe(200);
    const auditRows = audit.json() as Array<any>;
    expect(auditRows.some((x) => x.meta?.format === "csv")).toBe(true);
    expect(auditRows.some((x) => x.meta?.format === "xlsx")).toBe(true);

    const billAudit = await app.inject({
      method: "GET",
      url: "/admin/audit-logs?entityType=reports&action=REPORT_EXPORT_BILL_FORMAT",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(billAudit.statusCode).toBe(200);
    const billAuditRows = billAudit.json() as Array<any>;
    expect(billAuditRows.some((x) => x.meta?.format === "csv")).toBe(true);
    expect(billAuditRows.some((x) => x.meta?.format === "xlsx")).toBe(true);

    const leftEvent = await app.inject({
      method: "POST",
      url: `/admin/cards/${cardId}/status-events`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: "LEFT", reason: "reports-bill-zero-case", happenedAt: "2026-02-18T12:00:00+08:00" },
    });
    expect(leftEvent.statusCode).toBe(201);

    const recalcZero = await app.inject({
      method: "POST",
      url: "/admin/settlements/recalculate",
      headers: { authorization: `Bearer ${token}` },
      payload: { commissionMonth: "2026-03" },
    });
    expect(recalcZero.statusCode).toBe(200);

    const billCsvZero = await app.inject({
      method: "GET",
      url: "/admin/reports/bill.csv?commissionMonth=2026-03",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(billCsvZero.statusCode).toBe(200);
    expect(billCsvZero.body).toContain("离网");
    expect(billCsvZero.body).toContain("(本人)");
    expect(billCsvZero.body).toContain(",0");

    const notFound = await app.inject({
      method: "GET",
      url: "/admin/reports/settlement-items-preview?commissionMonth=2026-04",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.json().error).toBe("RUN_NOT_FOUND");
  });
});
