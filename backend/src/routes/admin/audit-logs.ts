import type { FastifyPluginAsync } from "fastify";
import * as XLSX from "xlsx";
import { z } from "zod";

import { writeAuditLog } from "../../audit/log.js";
import { requireRole } from "../../auth/prehandlers.js";
import type { Db } from "../../db.js";

const querySchema = z.object({
  entityType: z.string().min(1).optional(),
  entityId: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  actorUserId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
const exportQuerySchema = querySchema.omit({ limit: true, offset: true });
const exportSummaryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
  actorUserId: z.string().min(1).optional(),
  action: z
    .enum(["REPORT_EXPORT_SETTLEMENT_ITEMS", "REPORT_EXPORT_BILL_FORMAT", "LEDGER_EXPORT_ENTRIES", "AUDIT_EXPORT_LOGS"])
    .optional(),
});

type AuditQuery = z.infer<typeof exportQuerySchema>;
type AppWithDb = Readonly<{ db: Db }>;
type AuditLogRow = Readonly<{
  id: string;
  actor_user_id: string | null;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_json: any;
  after_json: any;
  meta: any;
  created_at: string;
}>;

const auditExportColumns = [
  "id",
  "createdAt",
  "actorRole",
  "actorUserId",
  "action",
  "entityType",
  "entityId",
  "before",
  "after",
  "meta",
] as const;
type AuditExportRow = Readonly<Record<(typeof auditExportColumns)[number], string>>;

function escapeCsv(v: any): string {
  const s = String(v ?? "");
  if (/[\",\n\r]/.test(s)) return `"${s.replace(/\"/g, "\"\"")}"`;
  return s;
}

function applyAuditFilters(where: string[], params: any[], q: AuditQuery): void {
  const push = (cond: string, v: any) => {
    params.push(v);
    where.push(cond.replaceAll("?", `$${params.length}`));
  };
  if (q.entityType) push("entity_type = ?", q.entityType);
  if (q.entityId) push("entity_id = ?", q.entityId);
  if (q.action) push("action = ?", q.action);
  if (q.actorUserId) push("actor_user_id = ?", q.actorUserId);
}

async function loadAuditRows(
  app: AppWithDb,
  q: AuditQuery,
  page?: Readonly<{ limit: number; offset: number }>,
): Promise<AuditLogRow[]> {
  const where: string[] = [];
  const params: any[] = [];
  applyAuditFilters(where, params, q);
  const whereSql = where.length > 0 ? `where ${where.join(" and ")}` : "";

  if (page) {
    params.push(page.limit);
    const limitIdx = params.length;
    params.push(page.offset);
    const offsetIdx = params.length;
    const r = await app.db.query<AuditLogRow>(
      `
        select
          id,
          actor_user_id,
          actor_role,
          action,
          entity_type,
          entity_id,
          before_json,
          after_json,
          meta,
          created_at
        from audit_logs
        ${whereSql}
        order by created_at desc
        limit $${limitIdx}
        offset $${offsetIdx}
      `,
      params,
    );
    return r.rows;
  }

  const r = await app.db.query<AuditLogRow>(
    `
      select
        id,
        actor_user_id,
        actor_role,
        action,
        entity_type,
        entity_id,
        before_json,
        after_json,
        meta,
        created_at
      from audit_logs
      ${whereSql}
      order by created_at desc
    `,
    params,
  );
  return r.rows;
}

function rowToApi(x: AuditLogRow) {
  return {
    id: x.id,
    actorUserId: x.actor_user_id ?? undefined,
    actorRole: x.actor_role,
    action: x.action,
    entityType: x.entity_type,
    entityId: x.entity_id ?? undefined,
    before: x.before_json ?? undefined,
    after: x.after_json ?? undefined,
    meta: x.meta ?? undefined,
    createdAt: x.created_at,
  };
}

function rowToExport(x: AuditLogRow): AuditExportRow {
  return {
    id: x.id,
    createdAt: x.created_at,
    actorRole: x.actor_role,
    actorUserId: x.actor_user_id ?? "",
    action: x.action,
    entityType: x.entity_type,
    entityId: x.entity_id ?? "",
    before: JSON.stringify(x.before_json ?? {}),
    after: JSON.stringify(x.after_json ?? {}),
    meta: JSON.stringify(x.meta ?? {}),
  };
}

export const adminAuditLogRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireRole("ADMIN"));

  app.get("/audit-logs", async (request, reply) => {
    const parsed = querySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const rows = await loadAuditRows(app, parsed.data, {
      limit: parsed.data.limit ?? 50,
      offset: parsed.data.offset ?? 0,
    });
    return rows.map(rowToApi);
  });

  app.get("/audit-logs.csv", async (request, reply) => {
    const parsed = exportQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });

    const rows = await loadAuditRows(app, parsed.data);
    const exportRows = rows.map(rowToExport);
    const lines: string[] = [];
    lines.push(auditExportColumns.map(escapeCsv).join(","));
    for (const r of exportRows) {
      lines.push(auditExportColumns.map((k) => escapeCsv(r[k])).join(","));
    }

    const csv = lines.join("\n");
    await writeAuditLog(app.db, {
      actorUserId: request.user.sub,
      actorRole: "ADMIN",
      action: "AUDIT_EXPORT_LOGS",
      entityType: "audit_logs",
      meta: {
        format: "csv",
        filters: parsed.data,
        rowCount: rows.length,
      },
    });
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", "attachment; filename=\"audit-logs.csv\"");
    return reply.send(csv);
  });

  app.get("/audit-logs.xlsx", async (request, reply) => {
    const parsed = exportQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });

    const rows = await loadAuditRows(app, parsed.data);
    const exportRows = rows.map(rowToExport);
    const sheet = XLSX.utils.json_to_sheet(exportRows, { header: [...auditExportColumns] });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "AuditLogs");
    const buf = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    await writeAuditLog(app.db, {
      actorUserId: request.user.sub,
      actorRole: "ADMIN",
      action: "AUDIT_EXPORT_LOGS",
      entityType: "audit_logs",
      meta: {
        format: "xlsx",
        filters: parsed.data,
        rowCount: rows.length,
      },
    });

    reply.header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    reply.header("content-disposition", "attachment; filename=\"audit-logs.xlsx\"");
    return reply.send(buf);
  });

  app.get("/audit-logs/export-summary", async (request, reply) => {
    const parsed = exportSummaryQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const q = parsed.data;
    const days = q.days ?? 30;
    const params: any[] = [days];
    const where: string[] = [
      "created_at >= now() - ($1::int * interval '1 day')",
      "action in ('REPORT_EXPORT_SETTLEMENT_ITEMS', 'REPORT_EXPORT_BILL_FORMAT', 'LEDGER_EXPORT_ENTRIES', 'AUDIT_EXPORT_LOGS')",
    ];
    if (q.actorUserId) {
      params.push(q.actorUserId);
      where.push(`actor_user_id = $${params.length}`);
    }
    if (q.action) {
      params.push(q.action);
      where.push(`action = $${params.length}`);
    }
    const whereSql = where.length > 0 ? `where ${where.join(" and ")}` : "";

    const totals = await app.db.query<{
      action: string;
      format: string | null;
      total_count: string | number;
      first_at: string;
      last_at: string;
      actor_user_id: string | null;
    }>(
      `
        select
          action,
          nullif(meta->>'format', '') as format,
          actor_user_id,
          count(*) as total_count,
          min(created_at) as first_at,
          max(created_at) as last_at
        from audit_logs
        ${whereSql}
        group by action, nullif(meta->>'format', ''), actor_user_id
        order by count(*) desc, max(created_at) desc
      `,
      params,
    );

    const byDay = await app.db.query<{
      day: string;
      action: string;
      format: string | null;
      total_count: string | number;
    }>(
      `
        select
          to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
          action,
          nullif(meta->>'format', '') as format,
          count(*) as total_count
        from audit_logs
        ${whereSql}
        group by to_char(date_trunc('day', created_at), 'YYYY-MM-DD'), action, nullif(meta->>'format', '')
        order by day desc, count(*) desc
      `,
      params,
    );

    const totalCount = totals.rows.reduce((s, x) => s + Number(x.total_count), 0);
    const csvCount = totals.rows
      .filter((x) => (x.format ?? "").toLowerCase() === "csv")
      .reduce((s, x) => s + Number(x.total_count), 0);
    const xlsxCount = totals.rows
      .filter((x) => (x.format ?? "").toLowerCase() === "xlsx")
      .reduce((s, x) => s + Number(x.total_count), 0);

    return {
      days,
      totalCount,
      csvCount,
      xlsxCount,
      rows: totals.rows.map((x) => ({
        action: x.action,
        format: x.format ?? "",
        actorUserId: x.actor_user_id ?? undefined,
        totalCount: Number(x.total_count),
        firstAt: x.first_at,
        lastAt: x.last_at,
      })),
      byDay: byDay.rows.map((x) => ({
        day: x.day,
        action: x.action,
        format: x.format ?? "",
        totalCount: Number(x.total_count),
      })),
    };
  });
};
