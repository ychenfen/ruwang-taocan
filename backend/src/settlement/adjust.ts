import { randomUUID } from "node:crypto";

import type { Db } from "../db.js";
import type { SettlementKind, YearMonth } from "../../../shared/commission-engine/src/index.js";
import { releaseDbLock, tryAcquireDbLock } from "../locks.js";
import { createLedgerEntryForAdjustments } from "../ledger/entries.js";
import { computeSettlementLinesFromDb } from "./compute.js";

type AmountLike = string | number;

function toCents(v: AmountLike): number {
  if (typeof v === "number") {
    // v is expected to already have <= 2 decimals in our DB. Convert safely.
    return Math.trunc(v * 100 + (v >= 0 ? 1e-6 : -1e-6));
  }
  const s = String(v).trim();
  if (s.length === 0) return 0;
  const neg = s.startsWith("-");
  const t = neg ? s.slice(1) : s;
  const [i, fRaw] = t.split(".");
  const f = (fRaw ?? "").padEnd(2, "0").slice(0, 2);
  const cents = Number(i || "0") * 100 + Number(f || "0");
  return neg ? -cents : cents;
}

function centsToAmountString(cents: number): string {
  const neg = cents < 0;
  const v = Math.abs(cents);
  const i = Math.floor(v / 100);
  const f = String(v % 100).padStart(2, "0");
  return `${neg ? "-" : ""}${i}.${f}`;
}

function keyOf(cardId: string, beneficiaryAgentId: string, targetKind: SettlementKind): string {
  return `${cardId}::${beneficiaryAgentId}::${targetKind}`;
}

function parseSnapshot(x: any): any {
  if (x == null) return {};
  if (typeof x === "string") {
    try {
      return JSON.parse(x);
    } catch {
      return {};
    }
  }
  return x;
}

export type AdjustSettlementResult =
  | Readonly<{
      ok: true;
      runId: string;
      commissionMonth: YearMonth;
      adjustmentBatchId: string;
      inserted: number;
      ledgerEntryId?: string;
      insertedItemIds: string[];
      reason: string;
    }>
  | Readonly<{
      ok: false;
      error: "NOT_FOUND" | "NOT_POSTED" | "LOCKED";
    }>;

export async function adjustPostedSettlement(args: Readonly<{
  db: Db;
  tz: string;
  runId: string;
  agentId?: string;
  reason: string;
  actorUserId?: string | null;
}>): Promise<AdjustSettlementResult> {
  const { db, tz, runId, agentId, reason, actorUserId } = args;
  const adjustmentBatchId = randomUUID();
  const lockName = `settlement_adjust:${runId}`;
  const lockOwner = actorUserId ?? "job";
  const lockAcquired = await tryAcquireDbLock({ db, name: lockName, ttlMs: 5 * 60_000, owner: lockOwner });
  if (!lockAcquired) return { ok: false, error: "LOCKED" };

  try {
    const run = await db.query<{ id: string; commission_month: string; status: string }>(
      "select id, commission_month, status from settlement_runs where id = $1 limit 1",
      [runId],
    );
    const r0 = run.rows[0];
    if (!r0) return { ok: false, error: "NOT_FOUND" };
    if (r0.status !== "POSTED") return { ok: false, error: "NOT_POSTED" };
    const commissionMonth = r0.commission_month as YearMonth;

    const computed = await computeSettlementLinesFromDb({ db, commissionMonth, agentId });
    const desiredByKey = new Map<
      string,
      Readonly<{
        targetKind: SettlementKind;
        cardId: string;
        beneficiaryAgentId: string;
        periodType: string;
        base: number;
        ratio: number;
        amountCents: number;
      }>
    >();
    for (const l of computed.lines) {
      const k = keyOf(l.cardId, l.beneficiaryAgentId, l.kind);
      desiredByKey.set(k, {
        targetKind: l.kind,
        cardId: l.cardId,
        beneficiaryAgentId: l.beneficiaryAgentId,
        periodType: l.periodType,
        base: l.baseMonthlyRent,
        ratio: l.ratio,
        amountCents: toCents(l.amount),
      });
    }

    const baseItems = await db.query<{
      id: string;
      card_id: string;
      beneficiary_agent_id: string;
      kind: SettlementKind;
      period_type: string;
      base_monthly_rent: AmountLike;
      ratio: AmountLike;
      amount: AmountLike;
    }>(
      `
        select id, card_id, beneficiary_agent_id, kind, period_type, base_monthly_rent, ratio, amount
        from settlement_items
        where settlement_run_id = $1
          and kind <> 'ADJUSTMENT'
          ${agentId ? "and beneficiary_agent_id = $2" : ""}
      `,
      agentId ? [runId, agentId] : [runId],
    );

    const baseByKey = new Map<
      string,
      Readonly<{
        id: string;
        cardId: string;
        beneficiaryAgentId: string;
        targetKind: SettlementKind;
        periodType: string;
        base: AmountLike;
        ratio: AmountLike;
        amountCents: number;
      }>
    >();
    for (const b of baseItems.rows) {
      const k = keyOf(b.card_id, b.beneficiary_agent_id, b.kind);
      baseByKey.set(k, {
        id: b.id,
        cardId: b.card_id,
        beneficiaryAgentId: b.beneficiary_agent_id,
        targetKind: b.kind,
        periodType: b.period_type,
        base: b.base_monthly_rent,
        ratio: b.ratio,
        amountCents: toCents(b.amount),
      });
    }

    const adjItems = await db.query<{
      id: string;
      card_id: string;
      beneficiary_agent_id: string;
      period_type: string;
      base_monthly_rent: AmountLike;
      ratio: AmountLike;
      amount: AmountLike;
      snapshot: any;
      adjustment_of_item_id: string | null;
      base_kind: SettlementKind | null;
    }>(
      `
        select
          si.id,
          si.card_id,
          si.beneficiary_agent_id,
          si.period_type,
          si.base_monthly_rent,
          si.ratio,
          si.amount,
          si.snapshot,
          si.adjustment_of_item_id,
          base.kind as base_kind
        from settlement_items si
        left join settlement_items base on base.id = si.adjustment_of_item_id
        where si.settlement_run_id = $1
          and si.kind = 'ADJUSTMENT'
          ${agentId ? "and si.beneficiary_agent_id = $2" : ""}
      `,
      agentId ? [runId, agentId] : [runId],
    );

    const adjSumByKey = new Map<string, number>();
    for (const a of adjItems.rows) {
      const snap = parseSnapshot(a.snapshot);
      const targetKind = (a.base_kind ?? snap?.targetKind) as SettlementKind | undefined;
      if (!targetKind) continue;
      const k = keyOf(a.card_id, a.beneficiary_agent_id, targetKind);
      const cur = adjSumByKey.get(k) ?? 0;
      adjSumByKey.set(k, cur + toCents(a.amount));
    }

    const keys = new Set<string>([...baseByKey.keys(), ...desiredByKey.keys(), ...adjSumByKey.keys()]);

    await db.query("begin");
    try {
      let inserted = 0;
      const insertedItemIds: string[] = [];
      for (const k of keys) {
        const base = baseByKey.get(k) ?? null;
        const adjSum = adjSumByKey.get(k) ?? 0;
        const desired = desiredByKey.get(k) ?? null;

        const oldCents = (base?.amountCents ?? 0) + adjSum;
        const newCents = desired?.amountCents ?? 0;
        const delta = newCents - oldCents;
        if (delta === 0) continue;

        // Determine fields to satisfy NOT NULL constraints.
        const cardId = desired?.cardId ?? base?.cardId;
        const beneficiaryAgentId = desired?.beneficiaryAgentId ?? base?.beneficiaryAgentId;
        const periodType = desired?.periodType ?? base?.periodType ?? "SUPPORT";
        const baseMonthlyRent = desired?.base ?? (base ? Number(base.base) : 0);
        const ratio = desired?.ratio ?? (base ? Number(base.ratio) : 0);

        if (!cardId || !beneficiaryAgentId) continue;

        const targetKind = (desired?.targetKind ?? base?.targetKind) as SettlementKind;

        const id = randomUUID();
        const snapshot = {
          algorithm: "commission-engine:v1",
          adjustmentBatchId,
          targetKind,
          old: {
            baseMonthlyRent: base ? Number(base.base) : 0,
            ratio: base ? Number(base.ratio) : 0,
            amount: centsToAmountString(oldCents),
          },
          new: {
            baseMonthlyRent,
            ratio,
            amount: centsToAmountString(newCents),
          },
          deltaAmount: centsToAmountString(delta),
          reason,
          computedAt: new Date().toISOString(),
          timezone: tz,
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
            snapshot,
            adjustment_of_item_id,
            adjustment_reason
          ) values ($1,$2,$3,$4,$5,'ADJUSTMENT',$6,$7,$8,$9,$10::jsonb,$11,$12)`,
          [
            id,
            runId,
            commissionMonth,
            cardId,
            beneficiaryAgentId,
            periodType,
            baseMonthlyRent,
            ratio,
            centsToAmountString(delta),
            JSON.stringify(snapshot),
            base?.id ?? null,
            reason,
          ],
        );
        inserted += 1;
        insertedItemIds.push(id);
      }

      let ledgerEntryId: string | undefined;
      if (insertedItemIds.length > 0) {
        const ledger = await createLedgerEntryForAdjustments({
          db,
          runId,
          commissionMonth,
          actorUserId,
          adjustmentBatchId,
          reason,
          insertedItemIds,
        });
        ledgerEntryId = ledger.entryId;
      }

      await db.query("commit");
      return {
        ok: true,
        runId,
        commissionMonth,
        adjustmentBatchId,
        inserted,
        ledgerEntryId,
        insertedItemIds,
        reason,
      };
    } catch (err) {
      await db.query("rollback");
      throw err;
    }
  } finally {
    await releaseDbLock({ db, name: lockName, owner: lockOwner });
  }
}
