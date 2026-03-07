import { randomUUID } from "node:crypto";

import type { Db } from "../db.js";
import type { RecalculateSettlementResult } from "./recalculate.js";

type TriggerType = "MANUAL" | "AUTO";

export async function recordSettlementExecution(args: Readonly<{
  db: Db;
  triggerType: TriggerType;
  commissionMonth: string;
  timezone: string;
  actorUserId?: string | null;
  targetAgentId?: string;
  startedAt: Date;
  endedAt: Date;
  result:
    | (RecalculateSettlementResult & Readonly<{ ok: true }>)
    | (RecalculateSettlementResult & Readonly<{ ok: false }>)
    | Readonly<{ ok: false; error: "EXCEPTION"; message?: string }>;
}>): Promise<void> {
  const {
    db,
    triggerType,
    commissionMonth,
    timezone,
    actorUserId,
    targetAgentId,
    startedAt,
    endedAt,
    result,
  } = args;
  const durationMs = Math.max(endedAt.getTime() - startedAt.getTime(), 0);

  if (result.ok) {
    await db.query(
      `
        insert into settlement_execution_logs (
          id, trigger_type, status, commission_month, timezone, settlement_run_id,
          actor_user_id, target_agent_id,
          scanned_card_count, produced_line_count, inserted_count, deleted_count,
          started_at, ended_at, duration_ms
        ) values (
          $1, $2, 'SUCCEEDED', $3, $4, $5,
          $6, $7,
          $8, $9, $10, $11,
          $12, $13, $14
        )
      `,
      [
        randomUUID(),
        triggerType,
        commissionMonth,
        timezone,
        result.runId,
        actorUserId ?? null,
        targetAgentId ?? null,
        result.scannedCardCount,
        result.producedLineCount,
        result.inserted,
        result.deleted,
        startedAt.toISOString(),
        endedAt.toISOString(),
        durationMs,
      ],
    );
    return;
  }

  const errorMessage = result.error === "EXCEPTION" ? (result.message ?? null) : null;
  await db.query(
    `
      insert into settlement_execution_logs (
        id, trigger_type, status, commission_month, timezone,
        actor_user_id, target_agent_id,
        scanned_card_count, produced_line_count, inserted_count, deleted_count,
        error_code, error_message, started_at, ended_at, duration_ms
      ) values (
        $1, $2, 'FAILED', $3, $4,
        $5, $6,
        0, 0, 0, 0,
        $7, $8, $9, $10, $11
      )
    `,
    [
      randomUUID(),
      triggerType,
      commissionMonth,
      timezone,
      actorUserId ?? null,
      targetAgentId ?? null,
      result.error,
      errorMessage,
      startedAt.toISOString(),
      endedAt.toISOString(),
      durationMs,
    ],
  );
}

