import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireRole } from "../../auth/prehandlers.js";
import { writeAuditLog } from "../../audit/log.js";

export const adminSettlementDeleteRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireRole("ADMIN"));

  const cleanupBody = z.object({
    dryRun: z.boolean().optional(),
    draftRetentionDays: z.coerce.number().int().min(7).max(3650).optional(),
    executionLogRetentionDays: z.coerce.number().int().min(7).max(3650).optional(),
  });

  // Safe cleanup: only clears old DRAFT runs and execution logs. POSTED/APPROVED are untouched.
  app.post("/settlements/cleanup", async (request, reply) => {
    const parsed = cleanupBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const dryRun = parsed.data.dryRun ?? true;
    const draftRetentionDays = parsed.data.draftRetentionDays ?? 90;
    const executionLogRetentionDays = parsed.data.executionLogRetentionDays ?? 180;

    const oldDraftRuns = await app.db.query<{
      id: string;
      commission_month: string;
      created_at: string;
      line_count: string | number;
    }>(
      `
        select
          sr.id,
          sr.commission_month,
          sr.created_at::text,
          count(si.id) as line_count
        from settlement_runs sr
        left join settlement_items si on si.settlement_run_id = sr.id
        where sr.status = 'DRAFT'
          and sr.created_at < now() - ($1::text || ' days')::interval
        group by sr.id, sr.commission_month, sr.created_at
        order by sr.created_at asc
        limit 5000
      `,
      [draftRetentionDays],
    );
    const draftRunIds = oldDraftRuns.rows.map((x) => x.id);
    const oldDraftLineCount = oldDraftRuns.rows.reduce((s, x) => s + Number(x.line_count), 0);

    const oldLogs = await app.db.query<{ cnt: string | number }>(
      `
        select count(*) as cnt
        from settlement_execution_logs
        where created_at < now() - ($1::text || ' days')::interval
      `,
      [executionLogRetentionDays],
    );
    const oldLogCount = Number(oldLogs.rows[0]?.cnt ?? 0);

    if (dryRun) {
      return reply.send({
        ok: true,
        dryRun: true,
        draftRetentionDays,
        executionLogRetentionDays,
        oldDraftRunCount: draftRunIds.length,
        oldDraftLineCount,
        oldExecutionLogCount: oldLogCount,
        draftRuns: oldDraftRuns.rows.map((x) => ({
          id: x.id,
          commissionMonth: x.commission_month,
          createdAt: x.created_at,
          lineCount: Number(x.line_count),
        })),
      });
    }

    let deletedRunCount = 0;
    let deletedDraftLogCount = 0;
    let deletedOldLogCount = 0;

    await app.db.query("begin");
    try {
      if (draftRunIds.length > 0) {
        const delDraftLogs = await app.db.query(
          `
            delete from settlement_execution_logs
            where settlement_run_id = any($1::text[])
          `,
          [draftRunIds],
        );
        deletedDraftLogCount = delDraftLogs.rowCount ?? 0;

        const delRuns = await app.db.query(
          `
            delete from settlement_runs
            where id = any($1::text[])
              and status = 'DRAFT'
          `,
          [draftRunIds],
        );
        deletedRunCount = delRuns.rowCount ?? 0;
      }

      const delOldLogs = await app.db.query(
        `
          delete from settlement_execution_logs
          where created_at < now() - ($1::text || ' days')::interval
        `,
        [executionLogRetentionDays],
      );
      deletedOldLogCount = delOldLogs.rowCount ?? 0;

      await writeAuditLog(app.db, {
        actorUserId: request.user.sub,
        actorRole: "ADMIN",
        action: "SETTLEMENT_CACHE_CLEANUP",
        entityType: "settlement_runs",
        meta: {
          dryRun: false,
          draftRetentionDays,
          executionLogRetentionDays,
          deletedRunCount,
          deletedDraftLogCount,
          deletedOldLogCount,
          oldDraftLineCount,
        },
      });

      await app.db.query("commit");
    } catch (err) {
      await app.db.query("rollback");
      throw err;
    }

    return reply.send({
      ok: true,
      dryRun: false,
      draftRetentionDays,
      executionLogRetentionDays,
      deletedRunCount,
      deletedDraftLogCount,
      deletedOldLogCount,
      oldDraftLineCount,
    });
  });

  app.delete("/settlements/runs/:id", async (request, reply) => {
    const runId = String((request.params as any).id ?? "");
    if (!runId) return reply.code(400).send({ error: "BAD_REQUEST" });

    await app.db.query("begin");
    try {
      const before = await app.db.query(
        `select id, run_month, commission_month, timezone, status, created_by, created_at, approved_by, approved_at, posted_by, posted_at
         from settlement_runs where id = $1 limit 1`,
        [runId],
      );
      const run = before.rows[0] as Record<string, unknown> | undefined;
      if (!run) {
        await app.db.query("rollback");
        return reply.code(404).send({ error: "NOT_FOUND" });
      }

      if (String(run.status) !== "DRAFT") {
        await app.db.query("rollback");
        return reply.code(409).send({ error: "RUN_NOT_DRAFT" });
      }

      const linkedEntries = await app.db.query<{ id: string }>(
        "select id from ledger_entries where settlement_run_id = $1 limit 1",
        [runId],
      );
      if (linkedEntries.rows[0]) {
        await app.db.query("rollback");
        return reply.code(409).send({ error: "RUN_HAS_LEDGER_ENTRIES" });
      }

      const delLogs = await app.db.query("delete from settlement_execution_logs where settlement_run_id = $1", [runId]);
      const delRun = await app.db.query("delete from settlement_runs where id = $1", [runId]);
      if ((delRun.rowCount ?? 0) === 0) {
        await app.db.query("rollback");
        return reply.code(404).send({ error: "NOT_FOUND" });
      }

      await writeAuditLog(app.db, {
        actorUserId: request.user.sub,
        actorRole: "ADMIN",
        action: "SETTLEMENT_RUN_DELETE",
        entityType: "settlement_runs",
        entityId: runId,
        before: run,
      });

      await app.db.query("commit");
      return reply.send({
        ok: true,
        runId,
        deletedExecutionLogs: delLogs.rowCount ?? 0,
      });
    } catch (err) {
      await app.db.query("rollback");
      throw err;
    }
  });

  app.delete("/settlements/runs/:id/hard-delete", async (request, reply) => {
    const runId = String((request.params as any).id ?? "");
    if (!runId) return reply.code(400).send({ error: "BAD_REQUEST" });

    const before = await app.db.query<{
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
      `select id, run_month, commission_month, timezone, status, created_by, created_at, approved_by, approved_at, posted_by, posted_at
       from settlement_runs
       where id = $1
       limit 1`,
      [runId],
    );
    const run = before.rows[0];
    if (!run) return reply.code(404).send({ error: "NOT_FOUND" });

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
      [runId],
    );
    const c = counts.rows[0] ?? { item_count: 0, entry_count: 0, line_count: 0, execution_log_count: 0 };

    await app.db.query("begin");
    try {
      // Explicit delete order avoids FK(RESTRICT) between ledger lines and settlement items.
      await app.db.query(
        `
          delete from ledger_entry_lines
          where ledger_entry_id in (
            select id from ledger_entries where settlement_run_id = $1
          )
        `,
        [runId],
      );
      await app.db.query("delete from ledger_entries where settlement_run_id = $1", [runId]);
      await app.db.query("delete from settlement_items where settlement_run_id = $1", [runId]);
      await app.db.query("delete from settlement_execution_logs where settlement_run_id = $1", [runId]);

      const delRun = await app.db.query("delete from settlement_runs where id = $1", [runId]);
      if ((delRun.rowCount ?? 0) === 0) {
        await app.db.query("rollback");
        return reply.code(404).send({ error: "NOT_FOUND" });
      }

      await writeAuditLog(app.db, {
        actorUserId: request.user.sub,
        actorRole: "ADMIN",
        action: "SETTLEMENT_RUN_HARD_DELETE",
        entityType: "settlement_runs",
        entityId: runId,
        before: run,
        meta: {
          runStatus: run.status,
          runMonth: run.run_month,
          commissionMonth: run.commission_month,
          deletedSettlementItemCount: Number(c.item_count),
          deletedLedgerEntryCount: Number(c.entry_count),
          deletedLedgerLineCount: Number(c.line_count),
          deletedExecutionLogCount: Number(c.execution_log_count),
        },
      });

      await app.db.query("commit");
      return reply.send({
        ok: true,
        runId,
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
