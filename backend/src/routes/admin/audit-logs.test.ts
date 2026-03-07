import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { FastifyInstance } from "fastify";

import { writeAuditLog } from "../../audit/log.js";
import type { Db } from "../../db.js";
import { setupAdminTestApp } from "../../test/setupAdminTestApp.js";

describe("/admin/audit-logs", () => {
  let app: FastifyInstance;
  let db: Db;
  let token: string;
  let adminUserId: string;

  beforeAll(async () => {
    const t = await setupAdminTestApp();
    app = t.app;
    db = t.db;
    token = t.token;

    const u = await db.query<{ id: string }>("select id from users where username = 'admin' limit 1");
    adminUserId = u.rows[0]!.id;

    await writeAuditLog(db, {
      actorUserId: adminUserId,
      actorRole: "ADMIN",
      action: "TEAM_CREATE",
      entityType: "teams",
      entityId: "team_test_1",
      after: { id: "team_test_1", name: "T1" },
      meta: { source: "test" },
    });
    await writeAuditLog(db, {
      actorUserId: adminUserId,
      actorRole: "ADMIN",
      action: "REPORT_EXPORT_SETTLEMENT_ITEMS",
      entityType: "reports",
      meta: { format: "csv", rowCount: 2, filters: { commissionMonth: "2026-02" } },
    });
    await writeAuditLog(db, {
      actorUserId: adminUserId,
      actorRole: "ADMIN",
      action: "REPORT_EXPORT_SETTLEMENT_ITEMS",
      entityType: "reports",
      meta: { format: "xlsx", rowCount: 2, filters: { commissionMonth: "2026-02" } },
    });
    await writeAuditLog(db, {
      actorUserId: adminUserId,
      actorRole: "ADMIN",
      action: "LEDGER_EXPORT_ENTRIES",
      entityType: "ledger_entries",
      meta: { format: "xlsx", rowCount: 4 },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("supports list/filter/csv/xlsx export and export summary", async () => {
    const list = await app.inject({
      method: "GET",
      url: "/admin/audit-logs?entityType=reports&action=REPORT_EXPORT_SETTLEMENT_ITEMS&limit=20&offset=0",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.statusCode).toBe(200);
    const listRows = list.json() as Array<any>;
    expect(listRows.length).toBe(2);
    expect(listRows.some((x) => x.meta?.format === "csv")).toBe(true);
    expect(listRows.some((x) => x.meta?.format === "xlsx")).toBe(true);

    const csv = await app.inject({
      method: "GET",
      url: "/admin/audit-logs.csv?entityType=reports&action=REPORT_EXPORT_SETTLEMENT_ITEMS",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body).toContain("REPORT_EXPORT_SETTLEMENT_ITEMS");
    expect(csv.body).toContain("csv");
    expect(csv.body).toContain("xlsx");

    const xlsx = await app.inject({
      method: "GET",
      url: "/admin/audit-logs.xlsx?entityType=reports&action=REPORT_EXPORT_SETTLEMENT_ITEMS",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers["content-type"]).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(xlsx.body.length).toBeGreaterThan(100);

    const auditExportLogs = await app.inject({
      method: "GET",
      url: "/admin/audit-logs?entityType=audit_logs&action=AUDIT_EXPORT_LOGS&limit=20&offset=0",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(auditExportLogs.statusCode).toBe(200);
    const auditRows = auditExportLogs.json() as Array<any>;
    expect(auditRows.length).toBeGreaterThanOrEqual(2);
    expect(auditRows.some((x) => x.meta?.format === "csv")).toBe(true);
    expect(auditRows.some((x) => x.meta?.format === "xlsx")).toBe(true);

    const summary = await app.inject({
      method: "GET",
      url: "/admin/audit-logs/export-summary?days=365",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(summary.statusCode).toBe(200);
    const s = summary.json() as any;
    expect(s.totalCount).toBeGreaterThanOrEqual(3);
    expect(s.csvCount).toBeGreaterThanOrEqual(1);
    expect(s.xlsxCount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(s.rows)).toBe(true);
    expect(s.rows.some((x: any) => x.action === "REPORT_EXPORT_SETTLEMENT_ITEMS" && x.format === "csv")).toBe(true);
    expect(s.rows.some((x: any) => x.action === "LEDGER_EXPORT_ENTRIES" && x.format === "xlsx")).toBe(true);
    expect(s.rows.some((x: any) => x.action === "AUDIT_EXPORT_LOGS" && x.format === "csv")).toBe(true);
    expect(s.rows.some((x: any) => x.action === "AUDIT_EXPORT_LOGS" && x.format === "xlsx")).toBe(true);
    expect(
      s.rows.every(
        (x: any) =>
          x.action === "REPORT_EXPORT_SETTLEMENT_ITEMS" ||
          x.action === "REPORT_EXPORT_BILL_FORMAT" ||
          x.action === "LEDGER_EXPORT_ENTRIES" ||
          x.action === "AUDIT_EXPORT_LOGS",
      ),
    ).toBe(true);
    expect(Array.isArray(s.byDay)).toBe(true);
    expect(s.byDay.length).toBeGreaterThan(0);
  });
});
