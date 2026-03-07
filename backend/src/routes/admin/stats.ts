import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireRole } from "../../auth/prehandlers.js";

export const adminStatsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireRole("ADMIN"));

  const trendQuery = z.object({
    months: z.coerce.number().int().min(1).max(24).optional(),
  });
  const alertQuery = z.object({
    lookbackDays: z.coerce.number().int().min(1).max(365).optional(),
    draftStaleHours: z.coerce.number().int().min(1).max(24 * 30).optional(),
    adjustmentRatioThreshold: z.coerce.number().min(0).max(1).optional(),
    exportLookbackHours: z.coerce.number().int().min(1).max(24 * 30).optional(),
    exportCountThreshold: z.coerce.number().int().min(1).max(10_000).optional(),
  });

  app.get("/stats", async () => {
    const [agents, cards, teams, onNetCards, latestRun, latestExecution] = await Promise.all([
      app.db.query<{ cnt: string | number }>("select count(*) as cnt from agents"),
      app.db.query<{ cnt: string | number }>("select count(*) as cnt from cards"),
      app.db.query<{ cnt: string | number }>("select count(*) as cnt from teams"),
      app.db.query<{ cnt: string | number }>(
        `
          select count(*) as cnt
          from card_assignments ca
          join cards c on c.id = ca.card_id
          join lateral (
            select e.status
            from card_status_events e
            where e.card_id = c.id
            order by e.happened_at desc, e.created_at desc, e.id desc
            limit 1
          ) s on true
          where ca.end_at is null and s.status = 'NORMAL'
        `,
      ),
      app.db.query<{
        id: string;
        commission_month: string;
        status: "DRAFT" | "APPROVED" | "POSTED";
        created_at: string;
      }>(
        `
          select id, commission_month, status, created_at
          from settlement_runs
          order by created_at desc
          limit 1
        `,
      ),
      app.db.query<{
        commission_month: string;
        status: "SUCCEEDED" | "FAILED";
        trigger_type: "MANUAL" | "AUTO";
        started_at: string;
        duration_ms: number;
      }>(
        `
          select commission_month, status, trigger_type, started_at, duration_ms
          from settlement_execution_logs
          order by started_at desc
          limit 1
        `,
      ),
    ]);

    const run = latestRun.rows[0];
    const execution = latestExecution.rows[0];

    return {
      agentsTotal: Number(agents.rows[0]?.cnt ?? 0),
      cardsTotal: Number(cards.rows[0]?.cnt ?? 0),
      teamsTotal: Number(teams.rows[0]?.cnt ?? 0),
      cardsOnNet: Number(onNetCards.rows[0]?.cnt ?? 0),
      latestRun: run
        ? {
            id: run.id,
            commissionMonth: run.commission_month,
            status: run.status,
            createdAt: run.created_at,
          }
        : undefined,
      latestExecution: execution
        ? {
            commissionMonth: execution.commission_month,
            status: execution.status,
            triggerType: execution.trigger_type,
            startedAt: execution.started_at,
            durationMs: execution.duration_ms,
          }
        : undefined,
    };
  });

  app.get("/stats/trends", async (request, reply) => {
    const parsed = trendQuery.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const months = parsed.data.months ?? 6;

    const r = await app.db.query<{
      commission_month: string;
      run_status: "DRAFT" | "APPROVED" | "POSTED";
      line_count: string | number;
      adjustment_line_count: string | number;
      total_amount: string | number;
      latest_exec_status: "SUCCEEDED" | "FAILED" | null;
      latest_exec_trigger: "MANUAL" | "AUTO" | null;
      latest_exec_duration_ms: number | null;
      latest_exec_started_at: string | null;
    }>(
      `
        select
          sr.commission_month,
          sr.status as run_status,
          count(si.id) as line_count,
          sum(case when si.kind = 'ADJUSTMENT' then 1 else 0 end) as adjustment_line_count,
          coalesce(sum(si.amount), 0) as total_amount,
          el.status as latest_exec_status,
          el.trigger_type as latest_exec_trigger,
          el.duration_ms as latest_exec_duration_ms,
          el.started_at as latest_exec_started_at
        from settlement_runs sr
        left join settlement_items si on si.settlement_run_id = sr.id
        left join lateral (
          select status, trigger_type, duration_ms, started_at
          from settlement_execution_logs l
          where l.commission_month = sr.commission_month
          order by l.started_at desc
          limit 1
        ) el on true
        group by
          sr.id,
          sr.commission_month,
          sr.status,
          el.status,
          el.trigger_type,
          el.duration_ms,
          el.started_at
        order by sr.commission_month desc
        limit $1
      `,
      [months],
    );

    const list = r.rows.map((x) => ({
      commissionMonth: x.commission_month,
      runStatus: x.run_status,
      lineCount: Number(x.line_count),
      adjustmentLineCount: Number(x.adjustment_line_count),
      totalAmount: Number(x.total_amount),
      latestExecution: x.latest_exec_status
        ? {
            status: x.latest_exec_status,
            triggerType: x.latest_exec_trigger,
            durationMs: x.latest_exec_duration_ms,
            startedAt: x.latest_exec_started_at,
          }
        : undefined,
    }));
    return list.reverse();
  });

  app.get("/stats/alerts", async (request, reply) => {
    const parsed = alertQuery.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const lookbackDays = parsed.data.lookbackDays ?? 30;
    const draftStaleHours = parsed.data.draftStaleHours ?? 24;
    const adjustmentRatioThreshold = parsed.data.adjustmentRatioThreshold ?? 0.2;
    const exportLookbackHours = parsed.data.exportLookbackHours ?? 24;
    const exportCountThreshold = parsed.data.exportCountThreshold ?? 20;

    const alerts: Array<{
      code: "FAILED_EXECUTION_RECENT" | "DRAFT_RUN_STALE" | "HIGH_ADJUSTMENT_RATIO" | "EXPORT_VOLUME_SPIKE";
      severity: "HIGH" | "MEDIUM";
      title: string;
      description: string;
      meta: Record<string, unknown>;
    }> = [];

    const failedExecution = await app.db.query<{
      cnt: string | number;
      latest_commission_month: string | null;
      latest_started_at: string | null;
      latest_error_code: string | null;
      latest_error_message: string | null;
    }>(
      `
        with failed as (
          select *
          from settlement_execution_logs
          where status = 'FAILED'
            and started_at >= now() - ($1::text || ' days')::interval
          order by started_at desc
        )
        select
          count(*) as cnt,
          (select commission_month from failed limit 1) as latest_commission_month,
          (select started_at::text from failed limit 1) as latest_started_at,
          (select error_code from failed limit 1) as latest_error_code,
          (select error_message from failed limit 1) as latest_error_message
        from failed
      `,
      [lookbackDays],
    );
    const failedCount = Number(failedExecution.rows[0]?.cnt ?? 0);
    if (failedCount > 0) {
      alerts.push({
        code: "FAILED_EXECUTION_RECENT",
        severity: "HIGH",
        title: `最近 ${lookbackDays} 天存在失败跑批`,
        description: `检测到 ${failedCount} 次失败跑批，建议优先排查。`,
        meta: {
          count: failedCount,
          latestCommissionMonth: failedExecution.rows[0]?.latest_commission_month ?? undefined,
          latestStartedAt: failedExecution.rows[0]?.latest_started_at ?? undefined,
          latestErrorCode: failedExecution.rows[0]?.latest_error_code ?? undefined,
          latestErrorMessage: failedExecution.rows[0]?.latest_error_message ?? undefined,
        },
      });
    }

    const staleDraft = await app.db.query<{
      cnt: string | number;
      oldest_created_at: string | null;
      oldest_commission_month: string | null;
    }>(
      `
        with stale as (
          select commission_month, created_at
          from settlement_runs
          where status = 'DRAFT'
            and created_at <= now() - ($1::text || ' hours')::interval
          order by created_at asc
        )
        select
          count(*) as cnt,
          (select created_at::text from stale limit 1) as oldest_created_at,
          (select commission_month from stale limit 1) as oldest_commission_month
        from stale
      `,
      [draftStaleHours],
    );
    const staleCount = Number(staleDraft.rows[0]?.cnt ?? 0);
    if (staleCount > 0) {
      alerts.push({
        code: "DRAFT_RUN_STALE",
        severity: "MEDIUM",
        title: `存在超过 ${draftStaleHours} 小时未处理草稿`,
        description: `当前有 ${staleCount} 个结算草稿未审核/入账。`,
        meta: {
          count: staleCount,
          oldestCommissionMonth: staleDraft.rows[0]?.oldest_commission_month ?? undefined,
          oldestCreatedAt: staleDraft.rows[0]?.oldest_created_at ?? undefined,
        },
      });
    }

    const highAdjustment = await app.db.query<{
      run_id: string;
      commission_month: string;
      adjustment_count: string | number;
      line_count: string | number;
      ratio: string | number;
    }>(
      `
        select
          sr.id as run_id,
          sr.commission_month,
          sum(case when si.kind = 'ADJUSTMENT' then 1 else 0 end) as adjustment_count,
          count(si.id) as line_count,
          case
            when count(si.id) = 0 then 0
            else (sum(case when si.kind = 'ADJUSTMENT' then 1 else 0 end)::numeric / count(si.id)::numeric)
          end as ratio
        from settlement_runs sr
        left join settlement_items si on si.settlement_run_id = sr.id
        where sr.created_at >= now() - ($1::text || ' days')::interval
        group by sr.id, sr.commission_month
        having count(si.id) > 0
          and (
            sum(case when si.kind = 'ADJUSTMENT' then 1 else 0 end)::numeric / count(si.id)::numeric
          ) >= $2
        order by ratio desc
        limit 1
      `,
      [lookbackDays, adjustmentRatioThreshold],
    );
    const ratioRow = highAdjustment.rows[0];
    if (ratioRow) {
      alerts.push({
        code: "HIGH_ADJUSTMENT_RATIO",
        severity: "MEDIUM",
        title: "调整单占比偏高",
        description: `最近结算中存在调整占比较高月份，建议核查源数据与配置稳定性。`,
        meta: {
          runId: ratioRow.run_id,
          commissionMonth: ratioRow.commission_month,
          adjustmentCount: Number(ratioRow.adjustment_count),
          lineCount: Number(ratioRow.line_count),
          ratio: Number(ratioRow.ratio),
          threshold: adjustmentRatioThreshold,
        },
      });
    }

    const exportVolume = await app.db.query<{
      total_count: string | number;
      distinct_actor_count: string | number;
      top_actor_user_id: string | null;
      top_actor_count: string | number | null;
      top_action: string | null;
      top_action_count: string | number | null;
      first_at: string | null;
      last_at: string | null;
    }>(
      `
        with scoped as (
          select actor_user_id, action, created_at
          from audit_logs
          where action in (
            'REPORT_EXPORT_SETTLEMENT_ITEMS',
            'REPORT_EXPORT_BILL_FORMAT',
            'LEDGER_EXPORT_ENTRIES',
            'AUDIT_EXPORT_LOGS'
          )
            and created_at >= now() - ($1::text || ' hours')::interval
        ),
        top_actor as (
          select actor_user_id, count(*) as cnt
          from scoped
          group by actor_user_id
          order by cnt desc, actor_user_id nulls last
          limit 1
        ),
        top_action as (
          select action, count(*) as cnt
          from scoped
          group by action
          order by cnt desc, action
          limit 1
        )
        select
          count(*) as total_count,
          count(distinct actor_user_id) as distinct_actor_count,
          (select actor_user_id from top_actor) as top_actor_user_id,
          (select cnt from top_actor) as top_actor_count,
          (select action from top_action) as top_action,
          (select cnt from top_action) as top_action_count,
          min(created_at)::text as first_at,
          max(created_at)::text as last_at
        from scoped
      `,
      [exportLookbackHours],
    );
    const exportRow = exportVolume.rows[0];
    const exportTotalCount = Number(exportRow?.total_count ?? 0);
    if (exportTotalCount >= exportCountThreshold) {
      alerts.push({
        code: "EXPORT_VOLUME_SPIKE",
        severity: exportTotalCount >= exportCountThreshold * 2 ? "HIGH" : "MEDIUM",
        title: `最近 ${exportLookbackHours} 小时导出量偏高`,
        description: `检测到 ${exportTotalCount} 次导出行为，超过阈值 ${exportCountThreshold}。`,
        meta: {
          totalCount: exportTotalCount,
          threshold: exportCountThreshold,
          lookbackHours: exportLookbackHours,
          distinctActorCount: Number(exportRow?.distinct_actor_count ?? 0),
          topActorUserId: exportRow?.top_actor_user_id ?? undefined,
          topActorCount: Number(exportRow?.top_actor_count ?? 0),
          topAction: exportRow?.top_action ?? undefined,
          topActionCount: Number(exportRow?.top_action_count ?? 0),
          firstAt: exportRow?.first_at ?? undefined,
          lastAt: exportRow?.last_at ?? undefined,
        },
      });
    }

    return alerts;
  });
};
