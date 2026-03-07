import { randomUUID } from "node:crypto";

import type { Db } from "../db.js";
import type { YearMonth } from "../../../shared/commission-engine/src/index.js";
import { releaseDbLock, tryAcquireDbLock } from "../locks.js";
import { computeSettlementLinesFromDb } from "./compute.js";

export type RecalculateSettlementResult =
  | Readonly<{
      ok: true;
      runId: string;
      commissionMonth: YearMonth;
      scannedCardCount: number;
      producedLineCount: number;
      deleted: number;
      inserted: number;
    }>
  | Readonly<{
      ok: false;
      error: "NOT_DRAFT";
    }>
  | Readonly<{
      ok: false;
      error: "LOCKED";
    }>;

function toYearMonth(d: Date): YearMonth {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}` as YearMonth;
}

export async function recalculateSettlement(args: Readonly<{
  db: Db;
  tz: string;
  commissionMonth: YearMonth;
  agentId?: string;
  actorUserId?: string | null;
}>): Promise<RecalculateSettlementResult> {
  const { db, tz, commissionMonth, agentId, actorUserId } = args;

  // Compute first to keep the write transaction short.
  const computed = await computeSettlementLinesFromDb({
    db,
    commissionMonth,
    agentId,
    // Agent-scoped draft recalc should include related upline diff lines.
    scopeMode: agentId ? "RELATED_ALL" : "SELF_ONLY",
  });

  const runMonth = toYearMonth(new Date());

  const lockName = `settlement_recalc:${commissionMonth}`;
  const lockOwner = actorUserId ?? "job";
  const lockAcquired = await tryAcquireDbLock({ db, name: lockName, ttlMs: 5 * 60_000, owner: lockOwner });
  if (!lockAcquired) return { ok: false, error: "LOCKED" };

  try {
  await db.query("begin");
  try {
    let runId: string;
    const existing = await db.query<{ id: string; status: "DRAFT" | "APPROVED" | "POSTED" }>(
      "select id, status from settlement_runs where commission_month = $1 limit 1",
      [commissionMonth],
    );
    const ex = existing.rows[0];
    if (!ex) {
      runId = randomUUID();
      await db.query(
        `insert into settlement_runs (id, run_month, commission_month, timezone, status, created_by, created_at)
         values ($1, $2, $3, $4, 'DRAFT', $5, now())`,
        [runId, runMonth, commissionMonth, tz, actorUserId ?? null],
      );
    } else {
      if (ex.status !== "DRAFT") {
        await db.query("rollback");
        return { ok: false, error: "NOT_DRAFT" };
      }
      runId = ex.id;
    }

    let deleted = 0;
    if (agentId) {
      const scopedCardIds = Object.keys(computed.cardInfoById);
      if (scopedCardIds.length > 0) {
        const placeholders = scopedCardIds.map((_, i) => `$${i + 2}`).join(", ");
        const del = await db.query(
          `delete from settlement_items
           where settlement_run_id = $1
             and kind <> 'ADJUSTMENT'
             and card_id in (${placeholders})`,
          [runId, ...scopedCardIds],
        );
        deleted = del.rowCount;
      } else {
        // No scoped cards this month: fallback to clearing beneficiary-owned rows.
        const del = await db.query(
          "delete from settlement_items where settlement_run_id = $1 and beneficiary_agent_id = $2 and kind <> 'ADJUSTMENT'",
          [runId, agentId],
        );
        deleted = del.rowCount;
      }
    } else {
      const del = await db.query("delete from settlement_items where settlement_run_id = $1 and kind <> 'ADJUSTMENT'", [
        runId,
      ]);
      deleted = del.rowCount;
    }

    let inserted = 0;
    for (const line of computed.lines) {
      const id = randomUUID();
      const info = computed.cardInfoById[line.cardId];
      const snapshot = {
        algorithm: "commission-engine:v1",
        cardNo: line.cardNo,
        ownerAgentId: info?.ownerId,
        ownerAgentName: info?.ownerName,
        planId: info?.planId,
        planName: info?.planName,
        policyId: info?.policyId,
        policyName: info?.policyName,
        statusAtMonthStart: info?.statusAtMonthStart,
        statusAtMonthEnd: info?.statusAtMonthEnd,
        hadAbnormalInMonth: info?.hadAbnormalInMonth ?? false,
        eligibleForMonth: info?.eligibleForMonth ?? true,
        computedAt: new Date().toISOString(),
      };

      await db.query(
        `insert into settlement_items (
          id,
          settlement_run_id,
          commission_month,
          card_id,
          beneficiary_agent_id,
          kind,
          period_type,
          base_monthly_rent,
          ratio,
          amount,
          snapshot
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
        [
          id,
          runId,
          line.commissionMonth,
          line.cardId,
          line.beneficiaryAgentId,
          line.kind,
          line.periodType,
          line.baseMonthlyRent,
          line.ratio,
          line.amount,
          JSON.stringify(snapshot),
        ],
      );
      inserted += 1;
    }

    await db.query("commit");
    return {
      ok: true,
      runId,
      commissionMonth,
      scannedCardCount: computed.scannedCardCount,
      producedLineCount: computed.producedLineCount,
      deleted,
      inserted,
    };
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
  } finally {
    await releaseDbLock({ db, name: lockName, owner: lockOwner });
  }
}
