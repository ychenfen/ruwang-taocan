import { randomUUID } from "node:crypto";

import type { Db } from "../db.js";
import type { SettlementKind, YearMonth } from "../../../shared/commission-engine/src/index.js";

type AmountLike = string | number;

function toAmountNumber(v: AmountLike): number {
  if (typeof v === "number") return v;
  return Number(v);
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

export async function createLedgerEntryForPostedRunIfMissing(args: Readonly<{
  db: Db;
  runId: string;
  actorUserId?: string | null;
}>): Promise<
  Readonly<{
    entryId: string;
    created: boolean;
    lineCount: number;
    totalAmount: number;
  }>
> {
  const { db, runId, actorUserId } = args;

  const exists = await db.query<{ id: string }>(
    `
      select id
      from ledger_entries
      where source_type = 'SETTLEMENT_POST' and source_id = $1
      limit 1
    `,
    [runId],
  );
  if (exists.rows[0]) {
    return { entryId: exists.rows[0].id, created: false, lineCount: 0, totalAmount: 0 };
  }

  const run = await db.query<{ id: string; commission_month: YearMonth }>(
    "select id, commission_month from settlement_runs where id = $1 limit 1",
    [runId],
  );
  const r0 = run.rows[0];
  if (!r0) throw new Error("RUN_NOT_FOUND");

  const items = await db.query<{
    id: string;
    beneficiary_agent_id: string;
    kind: Exclude<SettlementKind, "ADJUSTMENT">;
    period_type: "SUPPORT" | "STABLE";
    amount: AmountLike;
  }>(
    `
      select id, beneficiary_agent_id, kind, period_type, amount
      from settlement_items
      where settlement_run_id = $1
        and kind <> 'ADJUSTMENT'
      order by created_at asc
    `,
    [runId],
  );

  const entryId = randomUUID();
  await db.query(
    `
      insert into ledger_entries (
        id, source_type, source_id, settlement_run_id, commission_month, note, created_by
      ) values (
        $1, 'SETTLEMENT_POST', $2, $3, $4, $5, $6
      )
    `,
    [entryId, runId, runId, r0.commission_month, "POSTED settlement snapshot", actorUserId ?? null],
  );

  let totalAmount = 0;
  for (const it of items.rows) {
    totalAmount += toAmountNumber(it.amount);
    await db.query(
      `
        insert into ledger_entry_lines (
          id,
          ledger_entry_id,
          settlement_item_id,
          beneficiary_agent_id,
          kind,
          target_kind,
          period_type,
          amount
        ) values ($1,$2,$3,$4,$5,$6,$7,$8)
      `,
      [randomUUID(), entryId, it.id, it.beneficiary_agent_id, it.kind, it.kind, it.period_type, it.amount],
    );
  }

  return { entryId, created: true, lineCount: items.rows.length, totalAmount };
}

export async function createLedgerEntryForAdjustments(args: Readonly<{
  db: Db;
  runId: string;
  commissionMonth: YearMonth;
  actorUserId?: string | null;
  adjustmentBatchId: string;
  reason: string;
  insertedItemIds: readonly string[];
}>): Promise<
  Readonly<{
    entryId: string;
    lineCount: number;
    totalAmount: number;
  }>
> {
  const { db, runId, commissionMonth, actorUserId, adjustmentBatchId, reason, insertedItemIds } = args;
  if (insertedItemIds.length === 0) {
    throw new Error("NO_ADJUSTMENT_ITEMS");
  }

  const entryId = randomUUID();
  await db.query(
    `
      insert into ledger_entries (
        id, source_type, source_id, settlement_run_id, commission_month, note, created_by
      ) values (
        $1, 'SETTLEMENT_ADJUST', $2, $3, $4, $5, $6
      )
    `,
    [entryId, adjustmentBatchId, runId, commissionMonth, `Adjustment batch: ${reason}`, actorUserId ?? null],
  );

  const placeholders = insertedItemIds.map((_, i) => `$${i + 1}`).join(", ");
  const items = await db.query<{
    id: string;
    beneficiary_agent_id: string;
    period_type: "SUPPORT" | "STABLE";
    amount: AmountLike;
    snapshot: any;
    base_kind: SettlementKind | null;
  }>(
    `
      select
        si.id,
        si.beneficiary_agent_id,
        si.period_type,
        si.amount,
        si.snapshot,
        base.kind as base_kind
      from settlement_items si
      left join settlement_items base on base.id = si.adjustment_of_item_id
      where si.id in (${placeholders})
    `,
    [...insertedItemIds],
  );

  let totalAmount = 0;
  for (const it of items.rows) {
    const snap = parseSnapshot(it.snapshot);
    const targetKind = (it.base_kind ?? snap?.targetKind ?? "SELF") as SettlementKind;
    if (!["SELF", "UPLINE_DIFF_1", "UPLINE_DIFF_2"].includes(targetKind)) continue;
    totalAmount += toAmountNumber(it.amount);
    await db.query(
      `
        insert into ledger_entry_lines (
          id,
          ledger_entry_id,
          settlement_item_id,
          beneficiary_agent_id,
          kind,
          target_kind,
          period_type,
          amount
        ) values ($1,$2,$3,$4,'ADJUSTMENT',$5,$6,$7)
      `,
      [randomUUID(), entryId, it.id, it.beneficiary_agent_id, targetKind, it.period_type, it.amount],
    );
  }

  return { entryId, lineCount: items.rows.length, totalAmount };
}
