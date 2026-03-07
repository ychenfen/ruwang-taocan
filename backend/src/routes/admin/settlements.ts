import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireRole } from "../../auth/prehandlers.js";
import { writeAuditLog } from "../../audit/log.js";
import { adjustPostedSettlement } from "../../settlement/adjust.js";
import { recordSettlementExecution } from "../../settlement/executionLog.js";
import { createLedgerEntryForPostedRunIfMissing } from "../../ledger/entries.js";
import { recalculateSettlement } from "../../settlement/recalculate.js";

const recalcBody = z.object({
  commissionMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  agentId: z.string().min(1).optional(),
});

export const adminSettlementRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireRole("ADMIN"));

  const runListQuery = z.object({
    commissionMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  });

  // Generate/refresh DRAFT settlement items for a month.
  // If agentId is provided, only refresh rows for that beneficiary agent.
  app.post("/settlements/recalculate", async (request, reply) => {
    const parsed = recalcBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "invalid payload" });
    }
    const { commissionMonth, agentId } = parsed.data;
    const startedAt = new Date();
    try {
      const res = await recalculateSettlement({
        db: app.db,
        tz: app.config.TZ,
        commissionMonth: commissionMonth as any,
        agentId,
        actorUserId: request.user.sub,
      });
      const endedAt = new Date();
      try {
        await recordSettlementExecution({
          db: app.db,
          triggerType: "MANUAL",
          commissionMonth,
          timezone: app.config.TZ,
          actorUserId: request.user.sub,
          targetAgentId: agentId,
          startedAt,
          endedAt,
          result: res as any,
        });
      } catch (e) {
        request.log.warn({ err: e, commissionMonth, agentId }, "failed to write settlement execution log");
      }

      if (!res.ok) return reply.code(409).send({ error: res.error });
      await writeAuditLog(app.db, {
        actorUserId: request.user.sub,
        actorRole: "ADMIN",
        action: "SETTLEMENT_RECALC",
        entityType: "settlement_runs",
        entityId: res.runId,
        meta: {
          commissionMonth: res.commissionMonth,
          agentId,
          scannedCardCount: res.scannedCardCount,
          producedLineCount: res.producedLineCount,
          inserted: res.inserted,
          deleted: res.deleted,
        },
      });
      return reply.send(res);
    } catch (err) {
      const endedAt = new Date();
      try {
        await recordSettlementExecution({
          db: app.db,
          triggerType: "MANUAL",
          commissionMonth,
          timezone: app.config.TZ,
          actorUserId: request.user.sub,
          targetAgentId: agentId,
          startedAt,
          endedAt,
          result: {
            ok: false,
            error: "EXCEPTION",
            message: err instanceof Error ? err.message : String(err),
          },
        });
      } catch (e) {
        request.log.warn({ err: e, commissionMonth, agentId }, "failed to write settlement execution log");
      }
      throw err;
    }
  });

  const executionQuery = z.object({
    commissionMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    status: z.enum(["SUCCEEDED", "FAILED"]).optional(),
    triggerType: z.enum(["MANUAL", "AUTO"]).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  });

  app.get("/settlements/executions", async (request, reply) => {
    const parsed = executionQuery.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "invalid query" });
    }
    const q = parsed.data;

    const where: string[] = [];
    const params: any[] = [];
    const add = (clause: string, val: any) => {
      params.push(val);
      where.push(`${clause} $${params.length}`);
    };
    if (q.commissionMonth) add("commission_month =", q.commissionMonth);
    if (q.status) add("status =", q.status);
    if (q.triggerType) add("trigger_type =", q.triggerType);

    params.push(q.limit ?? 100);
    const limitIdx = params.length;
    params.push(q.offset ?? 0);
    const offsetIdx = params.length;

    const sqlWhere = where.length > 0 ? `where ${where.join(" and ")}` : "";
    const r = await app.db.query<{
      id: string;
      trigger_type: "MANUAL" | "AUTO";
      status: "SUCCEEDED" | "FAILED";
      commission_month: string;
      timezone: string;
      settlement_run_id: string | null;
      actor_user_id: string | null;
      target_agent_id: string | null;
      scanned_card_count: number;
      produced_line_count: number;
      inserted_count: number;
      deleted_count: number;
      error_code: string | null;
      error_message: string | null;
      started_at: string;
      ended_at: string;
      duration_ms: number;
      created_at: string;
    }>(
      `
        select
          id, trigger_type, status, commission_month, timezone,
          settlement_run_id, actor_user_id, target_agent_id,
          scanned_card_count, produced_line_count, inserted_count, deleted_count,
          error_code, error_message, started_at, ended_at, duration_ms, created_at
        from settlement_execution_logs
        ${sqlWhere}
        order by started_at desc
        limit $${limitIdx}
        offset $${offsetIdx}
      `,
      params,
    );
    return r.rows.map((x) => ({
      id: x.id,
      triggerType: x.trigger_type,
      status: x.status,
      commissionMonth: x.commission_month,
      timezone: x.timezone,
      runId: x.settlement_run_id ?? undefined,
      actorUserId: x.actor_user_id ?? undefined,
      targetAgentId: x.target_agent_id ?? undefined,
      scannedCardCount: x.scanned_card_count,
      producedLineCount: x.produced_line_count,
      insertedCount: x.inserted_count,
      deletedCount: x.deleted_count,
      errorCode: x.error_code ?? undefined,
      errorMessage: x.error_message ?? undefined,
      startedAt: x.started_at,
      endedAt: x.ended_at,
      durationMs: x.duration_ms,
      createdAt: x.created_at,
    }));
  });

  app.get("/settlements/runs", async (request, reply) => {
    const parsed = runListQuery.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "invalid query" });
    }
    const q = parsed.data;

    const params: any[] = [];
    const where: string[] = [];
    if (q.commissionMonth) {
      params.push(q.commissionMonth);
      where.push(`commission_month = $${params.length}`);
    }
    params.push(q.limit ?? 100);
    const limitIdx = params.length;
    params.push(q.offset ?? 0);
    const offsetIdx = params.length;
    const sqlWhere = where.length > 0 ? `where ${where.join(" and ")}` : "";

    const r = await app.db.query<{
      id: string;
      run_month: string;
      commission_month: string;
      timezone: string;
      status: string;
      created_at: string;
    }>(
      `
        select id, run_month, commission_month, timezone, status, created_at
        from settlement_runs
        ${sqlWhere}
        order by created_at desc
        limit $${limitIdx}
        offset $${offsetIdx}
      `,
      params,
    );

    return r.rows.map((x) => ({
      id: x.id,
      runMonth: x.run_month,
      commissionMonth: x.commission_month,
      timezone: x.timezone,
      status: x.status,
      createdAt: x.created_at,
    }));
  });

  app.get("/settlements/runs/:id", async (request, reply) => {
    const runId = String((request.params as any).id ?? "");
    if (!runId) return reply.code(400).send({ error: "BAD_REQUEST" });

    const r = await app.db.query<{
      id: string;
      run_month: string;
      commission_month: string;
      timezone: string;
      status: string;
      created_at: string;
      approved_at: string | null;
      posted_at: string | null;
    }>(
      `
        select
          id, run_month, commission_month, timezone, status, created_at, approved_at, posted_at
        from settlement_runs
        where id = $1
        limit 1
      `,
      [runId],
    );
    const row = r.rows[0];
    if (!row) return reply.code(404).send({ error: "NOT_FOUND" });

    return {
      id: row.id,
      runMonth: row.run_month,
      commissionMonth: row.commission_month,
      timezone: row.timezone,
      status: row.status,
      createdAt: row.created_at,
      approvedAt: row.approved_at ?? undefined,
      postedAt: row.posted_at ?? undefined,
    };
  });

  app.post("/settlements/runs/:id/approve", async (request, reply) => {
    const runId = String((request.params as any).id ?? "");
    if (!runId) return reply.code(400).send({ error: "BAD_REQUEST" });
    const r = await app.db.query<{ status: string }>("select status from settlement_runs where id = $1 limit 1", [runId]);
    const row = r.rows[0];
    if (!row) return reply.code(404).send({ error: "NOT_FOUND" });
    if (row.status !== "DRAFT") return reply.code(409).send({ error: "NOT_DRAFT" });

    await app.db.query(
      "update settlement_runs set status = 'APPROVED', approved_by = $2, approved_at = now() where id = $1",
      [runId, request.user.sub],
    );
    const after = await app.db.query(
      "select id, status, approved_by, approved_at from settlement_runs where id = $1",
      [runId],
    );
    await writeAuditLog(app.db, {
      actorUserId: request.user.sub,
      actorRole: "ADMIN",
      action: "SETTLEMENT_APPROVE",
      entityType: "settlement_runs",
      entityId: runId,
      before: { status: row.status },
      after: after.rows[0] ?? { id: runId, status: "APPROVED" },
    });
    return reply.send({ ok: true });
  });

  app.post("/settlements/runs/:id/unapprove", async (request, reply) => {
    const runId = String((request.params as any).id ?? "");
    if (!runId) return reply.code(400).send({ error: "BAD_REQUEST" });
    const r = await app.db.query<{ status: string }>("select status from settlement_runs where id = $1 limit 1", [runId]);
    const row = r.rows[0];
    if (!row) return reply.code(404).send({ error: "NOT_FOUND" });
    if (row.status !== "APPROVED") return reply.code(409).send({ error: "NOT_APPROVED" });

    await app.db.query(
      "update settlement_runs set status = 'DRAFT', approved_by = null, approved_at = null where id = $1",
      [runId],
    );
    const after = await app.db.query("select id, status from settlement_runs where id = $1", [runId]);
    await writeAuditLog(app.db, {
      actorUserId: request.user.sub,
      actorRole: "ADMIN",
      action: "SETTLEMENT_UNAPPROVE",
      entityType: "settlement_runs",
      entityId: runId,
      before: { status: row.status },
      after: after.rows[0] ?? { id: runId, status: "DRAFT" },
    });
    return reply.send({ ok: true });
  });

  app.post("/settlements/runs/:id/post", async (request, reply) => {
    const runId = String((request.params as any).id ?? "");
    if (!runId) return reply.code(400).send({ error: "BAD_REQUEST" });
    await app.db.query("begin");
    try {
      const r = await app.db.query<{ status: string }>("select status from settlement_runs where id = $1 limit 1", [runId]);
      const row = r.rows[0];
      if (!row) {
        await app.db.query("rollback");
        return reply.code(404).send({ error: "NOT_FOUND" });
      }
      if (row.status !== "APPROVED") {
        await app.db.query("rollback");
        return reply.code(409).send({ error: "NOT_APPROVED" });
      }

      await app.db.query(
        "update settlement_runs set status = 'POSTED', posted_by = $2, posted_at = now() where id = $1",
        [runId, request.user.sub],
      );
      const ledger = await createLedgerEntryForPostedRunIfMissing({
        db: app.db,
        runId,
        actorUserId: request.user.sub,
      });
      const after = await app.db.query("select id, status, posted_by, posted_at from settlement_runs where id = $1", [runId]);
      await writeAuditLog(app.db, {
        actorUserId: request.user.sub,
        actorRole: "ADMIN",
        action: "SETTLEMENT_POST",
        entityType: "settlement_runs",
        entityId: runId,
        before: { status: row.status },
        after: after.rows[0] ?? { id: runId, status: "POSTED" },
        meta: {
          ledgerEntryId: ledger.entryId,
          ledgerCreated: ledger.created,
          ledgerLineCount: ledger.lineCount,
          ledgerTotalAmount: ledger.totalAmount,
        },
      });
      await app.db.query("commit");
    } catch (err) {
      await app.db.query("rollback");
      throw err;
    }
    return reply.send({ ok: true });
  });

  const adjustBody = z.object({
    agentId: z.string().min(1).optional(),
    reason: z.string().min(1),
  });

  app.post("/settlements/runs/:id/adjust", async (request, reply) => {
    const runId = String((request.params as any).id ?? "");
    if (!runId) return reply.code(400).send({ error: "BAD_REQUEST" });
    const parsed = adjustBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "invalid payload" });
    }
    const { agentId, reason } = parsed.data;

    const res = await adjustPostedSettlement({
      db: app.db,
      tz: app.config.TZ,
      runId,
      agentId,
      reason,
      actorUserId: request.user.sub,
    });
    if (!res.ok) return reply.code(409).send({ error: res.error });
    await writeAuditLog(app.db, {
      actorUserId: request.user.sub,
      actorRole: "ADMIN",
      action: "SETTLEMENT_ADJUST",
      entityType: "settlement_runs",
      entityId: runId,
      meta: {
        agentId,
        inserted: res.inserted,
        reason: res.reason,
        commissionMonth: res.commissionMonth,
        adjustmentBatchId: res.adjustmentBatchId,
        ledgerEntryId: res.ledgerEntryId ?? null,
      },
    });
    return reply.send(res);
  });

  const diffQuery = z.object({
    beneficiaryAgentId: z.string().min(1).optional(),
  });

  // Adjustment diff view: base vs adjustments vs net (for posted runs).
  app.get("/settlements/runs/:id/diff", async (request, reply) => {
    const runId = String((request.params as any).id ?? "");
    if (!runId) return reply.code(400).send({ error: "BAD_REQUEST" });

    const parsed = diffQuery.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "invalid query" });
    }
    const q = parsed.data;

    const run = await app.db.query<{ id: string; commission_month: string; status: string }>(
      "select id, commission_month, status from settlement_runs where id = $1 limit 1",
      [runId],
    );
    const r0 = run.rows[0];
    if (!r0) return reply.code(404).send({ error: "NOT_FOUND" });

    const params: any[] = [runId];
    let baseBeneficiaryFilter = "";
    let adjBeneficiaryFilter = "";
    if (q.beneficiaryAgentId) {
      params.push(q.beneficiaryAgentId);
      baseBeneficiaryFilter = `and beneficiary_agent_id = $${params.length}`;
      adjBeneficiaryFilter = `and si.beneficiary_agent_id = $${params.length}`;
    }

    const rows = await app.db.query<{
      card_id: string;
      card_no: string;
      beneficiary_agent_id: string;
      beneficiary_name: string;
      target_kind: string;
      base_amount: string | number;
      adjustment_amount: string | number;
      net_amount: string | number;
    }>(
      `
        with base as (
          select
            card_id,
            beneficiary_agent_id,
            kind as target_kind,
            sum(amount) as base_amount
          from settlement_items
          where settlement_run_id = $1
            and kind <> 'ADJUSTMENT'
            ${baseBeneficiaryFilter}
          group by card_id, beneficiary_agent_id, kind
        ),
        adj as (
          select
            si.card_id,
            si.beneficiary_agent_id,
            coalesce(base.kind, si.snapshot->>'targetKind') as target_kind,
            sum(si.amount) as adjustment_amount
          from settlement_items si
          left join settlement_items base on base.id = si.adjustment_of_item_id
          where si.settlement_run_id = $1
            and si.kind = 'ADJUSTMENT'
            ${adjBeneficiaryFilter}
          group by si.card_id, si.beneficiary_agent_id, coalesce(base.kind, si.snapshot->>'targetKind')
        ),
        merged as (
          select
            b.card_id,
            b.beneficiary_agent_id,
            b.target_kind,
            b.base_amount,
            coalesce(a.adjustment_amount, 0) as adjustment_amount
          from base b
          left join adj a
            on a.card_id = b.card_id
           and a.beneficiary_agent_id = b.beneficiary_agent_id
           and a.target_kind = b.target_kind

          union all

          select
            a.card_id,
            a.beneficiary_agent_id,
            a.target_kind,
            0 as base_amount,
            a.adjustment_amount
          from adj a
          left join base b
            on b.card_id = a.card_id
           and b.beneficiary_agent_id = a.beneficiary_agent_id
           and b.target_kind = a.target_kind
          where b.card_id is null
        )
        select
          m.card_id,
          c.card_no,
          m.beneficiary_agent_id,
          ag.name as beneficiary_name,
          m.target_kind,
          m.base_amount,
          m.adjustment_amount,
          (m.base_amount + m.adjustment_amount) as net_amount
        from merged m
        join cards c on c.id = m.card_id
        join agents ag on ag.id = m.beneficiary_agent_id
        order by ag.name asc, c.card_no asc, m.target_kind asc
      `,
      params,
    );

    return {
      runId: r0.id,
      commissionMonth: r0.commission_month,
      status: r0.status,
      rows: rows.rows.map((x) => ({
        cardId: x.card_id,
        cardNo: x.card_no,
        beneficiaryAgentId: x.beneficiary_agent_id,
        beneficiaryName: x.beneficiary_name,
        targetKind: x.target_kind,
        baseAmount: Number(x.base_amount),
        adjustmentAmount: Number(x.adjustment_amount),
        netAmount: Number(x.net_amount),
        changed: Number(x.adjustment_amount) !== 0,
      })),
    };
  });

  app.get("/settlements/runs/:id/items", async (request, reply) => {
    const runId = String((request.params as any).id ?? "");
    if (!runId) return reply.code(400).send({ error: "BAD_REQUEST" });
    const r = await app.db.query<{
      id: string;
      commission_month: string;
      card_id: string;
      beneficiary_agent_id: string;
      kind: string;
      period_type: string;
      base_monthly_rent: string | number;
      ratio: string | number;
      amount: string | number;
      snapshot: any;
      adjustment_of_item_id: string | null;
      adjustment_reason: string | null;
      created_at: string;
    }>(
      `
        select
          id, commission_month, card_id, beneficiary_agent_id, kind, period_type,
          base_monthly_rent, ratio, amount, snapshot, adjustment_of_item_id, adjustment_reason, created_at
        from settlement_items
        where settlement_run_id = $1
        order by created_at asc
      `,
      [runId],
    );
    return r.rows.map((x) => ({
      id: x.id,
      commissionMonth: x.commission_month,
      cardId: x.card_id,
      beneficiaryAgentId: x.beneficiary_agent_id,
      kind: x.kind,
      periodType: x.period_type,
      baseMonthlyRent: Number(x.base_monthly_rent),
      ratio: Number(x.ratio),
      amount: Number(x.amount),
      snapshot: x.snapshot,
      adjustmentOfItemId: x.adjustment_of_item_id ?? undefined,
      adjustmentReason: x.adjustment_reason ?? undefined,
      createdAt: x.created_at,
    }));
  });
};
