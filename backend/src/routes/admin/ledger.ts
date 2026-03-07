import type { FastifyPluginAsync } from "fastify";
import * as XLSX from "xlsx";
import { z } from "zod";

import { requireRole } from "../../auth/prehandlers.js";
import type { Db } from "../../db.js";
import { writeAuditLog } from "../../audit/log.js";

const filtersQuery = z.object({
  commissionMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  sourceType: z.enum(["SETTLEMENT_POST", "SETTLEMENT_ADJUST"]).optional(),
  settlementRunId: z.string().min(1).optional(),
  beneficiaryAgentId: z.string().min(1).optional(),
});

const listEntriesQuery = filtersQuery.extend({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const listLinesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

type LedgerFilters = Readonly<{
  commissionMonth?: string;
  sourceType?: "SETTLEMENT_POST" | "SETTLEMENT_ADJUST";
  settlementRunId?: string;
  beneficiaryAgentId?: string;
}>;
type AppWithDb = Readonly<{ db: Db }>;

const ledgerExportColumns = [
  "commissionMonth",
  "sourceType",
  "entryId",
  "sourceId",
  "settlementRunId",
  "entryNote",
  "entryCreatedAt",
  "lineId",
  "settlementItemId",
  "cardId",
  "cardNo",
  "beneficiaryAgentId",
  "beneficiaryName",
  "kind",
  "targetKind",
  "periodType",
  "amount",
  "lineCreatedAt",
] as const;
type LedgerExportRow = Readonly<Record<(typeof ledgerExportColumns)[number], string | number>>;

function escapeCsv(v: any): string {
  const s = String(v ?? "");
  if (/[\",\n\r]/.test(s)) return `"${s.replace(/\"/g, "\"\"")}"`;
  return s;
}

function displayWidth(v: any): number {
  const s = String(v ?? "");
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 255 ? 2 : 1;
  return w;
}

function toSheetByColumns<T extends Record<string, string | number>>(
  rows: readonly T[],
  columns: readonly (keyof T & string)[],
): XLSX.WorkSheet {
  const aoa: Array<Array<string | number>> = [columns.map((c) => c)];
  for (const r of rows) {
    aoa.push(columns.map((c) => r[c] ?? ""));
  }
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet["!cols"] = columns.map((c, idx) => {
    let max = displayWidth(c);
    for (let i = 1; i < aoa.length; i += 1) {
      max = Math.max(max, displayWidth(aoa[i][idx]));
    }
    return { wch: Math.min(Math.max(max + 2, 10), 80) };
  });
  return sheet;
}

function buildFiltersWhere(q: LedgerFilters): Readonly<{ where: string[]; params: any[] }> {
  const where: string[] = [];
  const params: any[] = [];
  const add = (clause: string, value: any) => {
    params.push(value);
    where.push(`${clause} $${params.length}`);
  };
  if (q.commissionMonth) add("le.commission_month =", q.commissionMonth);
  if (q.sourceType) add("le.source_type =", q.sourceType);
  if (q.settlementRunId) add("le.settlement_run_id =", q.settlementRunId);
  if (q.beneficiaryAgentId) {
    params.push(q.beneficiaryAgentId);
    where.push(
      `exists (
        select 1
        from ledger_entry_lines ll
        where ll.ledger_entry_id = le.id
          and ll.beneficiary_agent_id = $${params.length}
      )`,
    );
  }
  return { where, params };
}

async function loadLedgerExportRows(app: AppWithDb, q: LedgerFilters): Promise<LedgerExportRow[]> {
  const built = buildFiltersWhere(q);
  const where: string[] = [...built.where];
  const params: any[] = [...built.params];
  const sqlWhere = where.length > 0 ? `where ${where.join(" and ")}` : "";

  const rows = await app.db.query<{
    commission_month: string;
    source_type: "SETTLEMENT_POST" | "SETTLEMENT_ADJUST";
    entry_id: string;
    source_id: string;
    settlement_run_id: string;
    entry_note: string | null;
    entry_created_at: string;
    line_id: string;
    settlement_item_id: string;
    card_id: string;
    card_no: string;
    beneficiary_agent_id: string;
    beneficiary_name: string;
    kind: string;
    target_kind: string;
    period_type: string;
    amount: string | number;
    line_created_at: string;
  }>(
    `
      select
        le.commission_month,
        le.source_type,
        le.id as entry_id,
        le.source_id,
        le.settlement_run_id,
        le.note as entry_note,
        le.created_at as entry_created_at,
        ll.id as line_id,
        ll.settlement_item_id,
        si.card_id,
        c.card_no,
        ll.beneficiary_agent_id,
        a.name as beneficiary_name,
        ll.kind,
        ll.target_kind,
        ll.period_type,
        ll.amount,
        ll.created_at as line_created_at
      from ledger_entries le
      join ledger_entry_lines ll on ll.ledger_entry_id = le.id
      join settlement_items si on si.id = ll.settlement_item_id
      join cards c on c.id = si.card_id
      join agents a on a.id = ll.beneficiary_agent_id
      ${sqlWhere}
      order by le.created_at desc, ll.created_at asc
    `,
    params,
  );

  return rows.rows.map((r) => ({
    commissionMonth: r.commission_month,
    sourceType: r.source_type,
    entryId: r.entry_id,
    sourceId: r.source_id,
    settlementRunId: r.settlement_run_id,
    entryNote: r.entry_note ?? "",
    entryCreatedAt: r.entry_created_at,
    lineId: r.line_id,
    settlementItemId: r.settlement_item_id,
    cardId: r.card_id,
    cardNo: r.card_no,
    beneficiaryAgentId: r.beneficiary_agent_id,
    beneficiaryName: r.beneficiary_name,
    kind: r.kind,
    targetKind: r.target_kind,
    periodType: r.period_type,
    amount: Number(r.amount),
    lineCreatedAt: r.line_created_at,
  }));
}

export const adminLedgerRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireRole("ADMIN"));

  app.get("/ledger/entries", async (request, reply) => {
    const parsed = listEntriesQuery.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const q = parsed.data;

    const built = buildFiltersWhere(q);
    const where: string[] = [...built.where];
    const params: any[] = [...built.params];

    const limit = q.limit ?? 50;
    const offset = q.offset ?? 0;
    params.push(limit);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const sqlWhere = where.length > 0 ? `where ${where.join(" and ")}` : "";
    const r = await app.db.query<{
      id: string;
      source_type: "SETTLEMENT_POST" | "SETTLEMENT_ADJUST";
      source_id: string;
      settlement_run_id: string;
      commission_month: string;
      note: string | null;
      created_by: string | null;
      created_at: string;
      line_count: string | number;
      total_amount: string | number;
    }>(
      `
        with agg as (
          select
            ledger_entry_id,
            count(*) as line_count,
            sum(amount) as total_amount
          from ledger_entry_lines
          group by ledger_entry_id
        )
        select
          le.id,
          le.source_type,
          le.source_id,
          le.settlement_run_id,
          le.commission_month,
          le.note,
          le.created_by,
          le.created_at,
          coalesce(agg.line_count, 0) as line_count,
          coalesce(agg.total_amount, 0) as total_amount
        from ledger_entries le
        left join agg on agg.ledger_entry_id = le.id
        ${sqlWhere}
        order by le.created_at desc
        limit $${limitIdx}
        offset $${offsetIdx}
      `,
      params,
    );

    return r.rows.map((x) => ({
      id: x.id,
      sourceType: x.source_type,
      sourceId: x.source_id,
      settlementRunId: x.settlement_run_id,
      commissionMonth: x.commission_month,
      note: x.note ?? undefined,
      createdBy: x.created_by ?? undefined,
      createdAt: x.created_at,
      lineCount: Number(x.line_count),
      totalAmount: Number(x.total_amount),
    }));
  });

  app.get("/ledger/entries.csv", async (request, reply) => {
    const parsed = filtersQuery.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const rows = await loadLedgerExportRows(app, parsed.data);
    const lines: string[] = [];
    lines.push(ledgerExportColumns.map(escapeCsv).join(","));
    for (const r of rows) {
      lines.push(ledgerExportColumns.map((k) => escapeCsv(r[k])).join(","));
    }
    const csv = lines.join("\n");
    await writeAuditLog(app.db, {
      actorUserId: request.user.sub,
      actorRole: "ADMIN",
      action: "LEDGER_EXPORT_ENTRIES",
      entityType: "ledger_entries",
      meta: {
        format: "csv",
        filters: parsed.data,
        rowCount: rows.length,
      },
    });
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", "attachment; filename=\"ledger-entries.csv\"");
    return reply.send(csv);
  });

  app.get("/ledger/entries.xlsx", async (request, reply) => {
    const parsed = filtersQuery.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const rows = await loadLedgerExportRows(app, parsed.data);

    const sheet = toSheetByColumns(rows, [...ledgerExportColumns]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "LedgerEntries");
    const buf = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    await writeAuditLog(app.db, {
      actorUserId: request.user.sub,
      actorRole: "ADMIN",
      action: "LEDGER_EXPORT_ENTRIES",
      entityType: "ledger_entries",
      meta: {
        format: "xlsx",
        filters: parsed.data,
        rowCount: rows.length,
      },
    });

    reply.header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    reply.header("content-disposition", "attachment; filename=\"ledger-entries.xlsx\"");
    return reply.send(buf);
  });

  app.get("/ledger/summary/agents", async (request, reply) => {
    const parsed = filtersQuery.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const q = parsed.data;

    const built = buildFiltersWhere(q);
    const where: string[] = [...built.where];
    const params: any[] = [...built.params];
    const sqlWhere = where.length > 0 ? `where ${where.join(" and ")}` : "";

    const rows = await app.db.query<{
      beneficiary_agent_id: string;
      beneficiary_name: string;
      line_count: string | number;
      entry_count: string | number;
      total_amount: string | number;
    }>(
      `
        select
          ll.beneficiary_agent_id,
          a.name as beneficiary_name,
          count(*) as line_count,
          count(distinct le.id) as entry_count,
          sum(ll.amount) as total_amount
        from ledger_entries le
        join ledger_entry_lines ll on ll.ledger_entry_id = le.id
        join agents a on a.id = ll.beneficiary_agent_id
        ${sqlWhere}
        group by ll.beneficiary_agent_id, a.name
        order by sum(ll.amount) desc
      `,
      params,
    );

    return rows.rows.map((x) => ({
      beneficiaryAgentId: x.beneficiary_agent_id,
      beneficiaryName: x.beneficiary_name,
      lineCount: Number(x.line_count),
      entryCount: Number(x.entry_count),
      totalAmount: Number(x.total_amount),
    }));
  });

  app.get("/ledger/entries/:id/lines", async (request, reply) => {
    const entryId = String((request.params as any).id ?? "");
    if (!entryId) return reply.code(400).send({ error: "BAD_REQUEST" });
    const parsed = listLinesQuery.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const limit = parsed.data.limit ?? 200;
    const offset = parsed.data.offset ?? 0;

    const exists = await app.db.query<{ id: string }>("select id from ledger_entries where id = $1 limit 1", [entryId]);
    if (!exists.rows[0]) return reply.code(404).send({ error: "NOT_FOUND" });

    const rows = await app.db.query<{
      id: string;
      settlement_item_id: string;
      beneficiary_agent_id: string;
      beneficiary_name: string;
      kind: string;
      target_kind: string;
      period_type: string;
      amount: string | number;
      created_at: string;
      card_id: string;
      card_no: string;
      commission_month: string;
    }>(
      `
        select
          ll.id,
          ll.settlement_item_id,
          ll.beneficiary_agent_id,
          a.name as beneficiary_name,
          ll.kind,
          ll.target_kind,
          ll.period_type,
          ll.amount,
          ll.created_at,
          si.card_id,
          c.card_no,
          si.commission_month
        from ledger_entry_lines ll
        join settlement_items si on si.id = ll.settlement_item_id
        join cards c on c.id = si.card_id
        join agents a on a.id = ll.beneficiary_agent_id
        where ll.ledger_entry_id = $1
        order by ll.created_at asc
        limit $2
        offset $3
      `,
      [entryId, limit, offset],
    );

    return rows.rows.map((x) => ({
      id: x.id,
      settlementItemId: x.settlement_item_id,
      beneficiaryAgentId: x.beneficiary_agent_id,
      beneficiaryName: x.beneficiary_name,
      kind: x.kind,
      targetKind: x.target_kind,
      periodType: x.period_type,
      amount: Number(x.amount),
      createdAt: x.created_at,
      cardId: x.card_id,
      cardNo: x.card_no,
      commissionMonth: x.commission_month,
    }));
  });

  // Hard delete: remove the entire settlement month run behind this ledger entry.
  // This is an admin emergency action used when users need to clear posted data and recalculate.
  app.delete("/ledger/entries/:id", async (request, reply) => {
    const entryId = String((request.params as any).id ?? "");
    if (!entryId) return reply.code(400).send({ error: "BAD_REQUEST" });

    const entryRows = await app.db.query<{
      id: string;
      source_type: "SETTLEMENT_POST" | "SETTLEMENT_ADJUST";
      source_id: string;
      settlement_run_id: string;
      commission_month: string;
      note: string | null;
      created_by: string | null;
      created_at: string;
    }>(
      `
        select
          id, source_type, source_id, settlement_run_id, commission_month, note, created_by, created_at
        from ledger_entries
        where id = $1
        limit 1
      `,
      [entryId],
    );
    const entry = entryRows.rows[0];
    if (!entry) return reply.code(404).send({ error: "NOT_FOUND" });

    const runRows = await app.db.query<{
      id: string;
      run_month: string;
      commission_month: string;
      timezone: string;
      status: string;
      created_by: string | null;
      created_at: string;
      approved_by: string | null;
      approved_at: string | null;
      posted_by: string | null;
      posted_at: string | null;
    }>(
      `
        select
          id, run_month, commission_month, timezone, status, created_by, created_at, approved_by, approved_at, posted_by, posted_at
        from settlement_runs
        where id = $1
        limit 1
      `,
      [entry.settlement_run_id],
    );
    const run = runRows.rows[0];
    if (!run) {
      const lc = await app.db.query<{ c: string | number }>(
        "select count(*) as c from ledger_entry_lines where ledger_entry_id = $1",
        [entryId],
      );
      const lineCount = Number(lc.rows[0]?.c ?? 0);

      await app.db.query("begin");
      try {
        await app.db.query("delete from ledger_entry_lines where ledger_entry_id = $1", [entryId]);
        const delEntry = await app.db.query("delete from ledger_entries where id = $1", [entryId]);
        if ((delEntry.rowCount ?? 0) === 0) {
          await app.db.query("rollback");
          return reply.code(404).send({ error: "NOT_FOUND" });
        }

        await writeAuditLog(app.db, {
          actorUserId: request.user.sub,
          actorRole: "ADMIN",
          action: "LEDGER_ENTRY_ORPHAN_DELETE",
          entityType: "ledger_entries",
          entityId: entryId,
          before: entry,
          meta: {
            orphan: true,
            sourceType: entry.source_type,
            sourceId: entry.source_id,
            settlementRunId: entry.settlement_run_id,
            commissionMonth: entry.commission_month,
            deletedLedgerEntryCount: Number(delEntry.rowCount ?? 0),
            deletedLedgerLineCount: lineCount,
          },
        });
        await app.db.query("commit");

        return reply.send({
          ok: true,
          orphan: true,
          entryId,
          commissionMonth: entry.commission_month,
          deletedLedgerEntryCount: Number(delEntry.rowCount ?? 0),
          deletedLedgerLineCount: lineCount,
        });
      } catch (err) {
        await app.db.query("rollback");
        throw err;
      }
    }

    const counts = await app.db.query<{
      item_count: string | number;
      entry_count: string | number;
      line_count: string | number;
      execution_log_count: string | number;
    }>(
      `
        select
          (select count(*) from settlement_items where settlement_run_id = $1) as item_count,
          (select count(*) from ledger_entries where settlement_run_id = $1) as entry_count,
          (
            select count(*)
            from ledger_entry_lines ll
            join ledger_entries le on le.id = ll.ledger_entry_id
            where le.settlement_run_id = $1
          ) as line_count,
          (select count(*) from settlement_execution_logs where settlement_run_id = $1) as execution_log_count
      `,
      [run.id],
    );
    const c = counts.rows[0] ?? { item_count: 0, entry_count: 0, line_count: 0, execution_log_count: 0 };

    await app.db.query("begin");
    try {
      await app.db.query(
        `
          delete from ledger_entry_lines
          where ledger_entry_id in (
            select id from ledger_entries where settlement_run_id = $1
          )
        `,
        [run.id],
      );
      await app.db.query("delete from ledger_entries where settlement_run_id = $1", [run.id]);
      await app.db.query("delete from settlement_items where settlement_run_id = $1", [run.id]);
      await app.db.query("delete from settlement_execution_logs where settlement_run_id = $1", [run.id]);
      const delRun = await app.db.query("delete from settlement_runs where id = $1", [run.id]);
      if ((delRun.rowCount ?? 0) === 0) {
        await app.db.query("rollback");
        return reply.code(404).send({ error: "RUN_NOT_FOUND" });
      }

      await writeAuditLog(app.db, {
        actorUserId: request.user.sub,
        actorRole: "ADMIN",
        action: "LEDGER_ENTRY_HARD_DELETE",
        entityType: "ledger_entries",
        entityId: entryId,
        before: entry,
        meta: {
          runId: run.id,
          runStatus: run.status,
          runMonth: run.run_month,
          commissionMonth: run.commission_month,
          sourceType: entry.source_type,
          sourceId: entry.source_id,
          deletedSettlementItemCount: Number(c.item_count),
          deletedLedgerEntryCount: Number(c.entry_count),
          deletedLedgerLineCount: Number(c.line_count),
          deletedExecutionLogCount: Number(c.execution_log_count),
        },
      });

      await app.db.query("commit");
      return reply.send({
        ok: true,
        entryId,
        runId: run.id,
        commissionMonth: run.commission_month,
        deletedSettlementItemCount: Number(c.item_count),
        deletedLedgerEntryCount: Number(c.entry_count),
        deletedLedgerLineCount: Number(c.line_count),
        deletedExecutionLogCount: Number(c.execution_log_count),
      });
    } catch (err) {
      await app.db.query("rollback");
      throw err;
    }
  });
};
