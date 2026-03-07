import type { FastifyInstance } from "fastify";

import { writeAuditLog } from "../audit/log.js";
import { recordSettlementExecution } from "../settlement/executionLog.js";
import { recalculateSettlement } from "../settlement/recalculate.js";

function ymPrevOf(d: Date): `${number}-${string}` {
  const y = d.getFullYear();
  const m = d.getMonth() + 1; // 1..12
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}`;
}

export type MonthlySettlementJob = Readonly<{
  stop(): void;
}>;

export function startMonthlySettlementJob(app: FastifyInstance): MonthlySettlementJob {
  let timer: NodeJS.Timeout | null = null;

  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);

    // Run on the 5th at 00:10 local time.
    const targetDay = 5;
    next.setHours(0, 10, 0, 0);
    if (now.getDate() < targetDay || (now.getDate() === targetDay && now.getTime() < next.getTime())) {
      next.setDate(targetDay);
    } else {
      // Next month
      next.setMonth(next.getMonth() + 1, targetDay);
    }

    const delayMs = Math.max(next.getTime() - now.getTime(), 1_000);
    timer = setTimeout(async () => {
      const startedAt = new Date();
      const commissionMonth = ymPrevOf(new Date()) as any;
      try {
        const res = await recalculateSettlement({
          db: app.db,
          tz: app.config.TZ,
          commissionMonth,
          actorUserId: null,
        });
        const endedAt = new Date();
        try {
          await recordSettlementExecution({
            db: app.db,
            triggerType: "AUTO",
            commissionMonth,
            timezone: app.config.TZ,
            actorUserId: null,
            startedAt,
            endedAt,
            result: res as any,
          });
        } catch (e) {
          app.log.warn({ job: "monthly_settlement", err: e }, "failed to write settlement execution log");
        }
        if (res.ok) {
          await writeAuditLog(app.db, {
            actorUserId: null,
            actorRole: "SYSTEM",
            action: "SETTLEMENT_RECALC_JOB",
            entityType: "settlement_runs",
            entityId: res.runId,
            meta: {
              commissionMonth,
              scannedCardCount: res.scannedCardCount,
              producedLineCount: res.producedLineCount,
              inserted: res.inserted,
              deleted: res.deleted,
            },
          });
          app.log.info(
            {
              job: "monthly_settlement",
              commissionMonth,
              runId: res.runId,
              scannedCardCount: res.scannedCardCount,
              inserted: res.inserted,
              deleted: res.deleted,
            },
            "monthly settlement job completed",
          );
        } else {
          app.log.warn({ job: "monthly_settlement", commissionMonth, error: res.error }, "monthly settlement job skipped");
        }
      } catch (err) {
        const endedAt = new Date();
        try {
          await recordSettlementExecution({
            db: app.db,
            triggerType: "AUTO",
            commissionMonth,
            timezone: app.config.TZ,
            actorUserId: null,
            startedAt,
            endedAt,
            result: {
              ok: false,
              error: "EXCEPTION",
              message: err instanceof Error ? err.message : String(err),
            },
          });
        } catch (e) {
          app.log.warn({ job: "monthly_settlement", err: e }, "failed to write settlement execution log");
        }
        app.log.error({ job: "monthly_settlement", err }, "monthly settlement job failed");
      } finally {
        scheduleNext();
      }
    }, delayMs);
  };

  scheduleNext();

  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  app.addHook("onClose", async () => {
    stop();
  });

  return { stop };
}
