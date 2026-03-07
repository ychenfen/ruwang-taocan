import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import type { Db } from "../../db.js";
import { setupAdminTestApp } from "../../test/setupAdminTestApp.js";

describe("/admin/settlements/runs/:id DELETE", () => {
  let app: FastifyInstance;
  let db: Db;
  let token: string;

  beforeAll(async () => {
    const t = await setupAdminTestApp();
    app = t.app;
    db = t.db;
    token = t.token;
  });

  afterAll(async () => {
    await app.close();
  });

  async function prepareSimpleSettlement(commissionMonth: string, suffix: string): Promise<string> {
    const levelId = randomUUID();
    await db.query(
      `insert into agent_levels (id, name, support_rate, stable_rate, stable_months)
       values ($1, $2, $3, $4, $5)`,
      [levelId, `DEL-L-${suffix}`, 0.03, 0.01, 12],
    );

    const owner = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        username: `del_settle_owner_${suffix}`,
        password: "agent123456",
        name: `删除结算代理${suffix}`,
        levelId,
      },
    });
    expect(owner.statusCode).toBe(201);
    const ownerId = owner.json().id as string;

    const planId = randomUUID();
    await db.query(
      `insert into plans (id, name, monthly_rent, status, created_at)
       values ($1, $2, $3, 'ACTIVE', now())`,
      [planId, `DEL-PLAN-${suffix}`, 29],
    );

    const card = await app.inject({
      method: "POST",
      url: "/admin/cards",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        cardNo: `188${suffix.padEnd(8, "0").slice(0, 8)}`,
        activatedAt: "2026-01-01",
        planId,
        ownerAgentId: ownerId,
        initialStatus: "NORMAL",
      },
    });
    expect(card.statusCode).toBe(201);

    const recalc = await app.inject({
      method: "POST",
      url: "/admin/settlements/recalculate",
      headers: { authorization: `Bearer ${token}` },
      payload: { commissionMonth },
    });
    expect(recalc.statusCode).toBe(200);
    return recalc.json().runId as string;
  }

  it("deletes DRAFT run and related line items/execution logs", async () => {
    const suffix = randomUUID().slice(0, 8);
    const runId = await prepareSimpleSettlement("2026-02", suffix);

    const del = await app.inject({
      method: "DELETE",
      url: `/admin/settlements/runs/${runId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().ok).toBe(true);

    const runRows = await db.query<{ id: string }>("select id from settlement_runs where id = $1", [runId]);
    expect(runRows.rows.length).toBe(0);

    const itemRows = await db.query<{ id: string }>("select id from settlement_items where settlement_run_id = $1", [runId]);
    expect(itemRows.rows.length).toBe(0);

    const logRows = await db.query<{ id: string }>("select id from settlement_execution_logs where settlement_run_id = $1", [runId]);
    expect(logRows.rows.length).toBe(0);
  });

  it("blocks deleting non-DRAFT run", async () => {
    const suffix = randomUUID().slice(0, 8);
    const runId = await prepareSimpleSettlement("2026-03", suffix);

    const approve = await app.inject({
      method: "POST",
      url: `/admin/settlements/runs/${runId}/approve`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(approve.statusCode).toBe(200);

    const del = await app.inject({
      method: "DELETE",
      url: `/admin/settlements/runs/${runId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.statusCode).toBe(409);
    expect(del.json().error).toBe("RUN_NOT_DRAFT");
  });

  it("hard-deletes POSTED run with ledger data and allows recalculation again", async () => {
    const suffix = randomUUID().slice(0, 8);
    const runId = await prepareSimpleSettlement("2026-04", suffix);

    const approve = await app.inject({
      method: "POST",
      url: `/admin/settlements/runs/${runId}/approve`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(approve.statusCode).toBe(200);

    const post = await app.inject({
      method: "POST",
      url: `/admin/settlements/runs/${runId}/post`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(post.statusCode).toBe(200);

    const hardDelete = await app.inject({
      method: "DELETE",
      url: `/admin/settlements/runs/${runId}/hard-delete`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(hardDelete.statusCode).toBe(200);
    expect(hardDelete.json().ok).toBe(true);
    expect(hardDelete.json().deletedLedgerEntryCount).toBeGreaterThanOrEqual(1);

    const runRows = await db.query<{ id: string }>("select id from settlement_runs where id = $1", [runId]);
    expect(runRows.rows.length).toBe(0);
    const itemRows = await db.query<{ id: string }>("select id from settlement_items where settlement_run_id = $1", [runId]);
    expect(itemRows.rows.length).toBe(0);
    const entryRows = await db.query<{ id: string }>("select id from ledger_entries where settlement_run_id = $1", [runId]);
    expect(entryRows.rows.length).toBe(0);

    const recalcAgain = await app.inject({
      method: "POST",
      url: "/admin/settlements/recalculate",
      headers: { authorization: `Bearer ${token}` },
      payload: { commissionMonth: "2026-04" },
    });
    expect(recalcAgain.statusCode).toBe(200);
    expect(typeof recalcAgain.json().runId).toBe("string");
  });

  it("supports safe cleanup preview and execution", async () => {
    const adminUser = await db.query<{ id: string }>("select id from users where username = 'admin' limit 1");
    const adminUserId = adminUser.rows[0]?.id;
    expect(typeof adminUserId).toBe("string");

    const oldDraftRunId = randomUUID();
    const oldPostedRunId = randomUUID();
    await db.query(
      `
        insert into settlement_runs (id, run_month, commission_month, timezone, status, created_by, created_at)
        values
          ($1, '2199-02', '2199-01', 'Asia/Shanghai', 'DRAFT', $3, now() - interval '220 days'),
          ($2, '2199-02', '2198-12', 'Asia/Shanghai', 'POSTED', $3, now() - interval '220 days')
      `,
      [oldDraftRunId, oldPostedRunId, adminUserId],
    );

    const insertLog = async (args: Readonly<{ runId?: string; daysAgo: number }>) => {
      await db.query(
        `
          insert into settlement_execution_logs (
            id, trigger_type, status, commission_month, timezone,
            settlement_run_id, actor_user_id, target_agent_id,
            scanned_card_count, produced_line_count, inserted_count, deleted_count,
            error_code, error_message,
            started_at, ended_at, duration_ms, created_at
          )
          values (
            $1, 'MANUAL', 'FAILED', '2199-01', 'Asia/Shanghai',
            $2, $3, null,
            0, 0, 0, 0,
            'NOT_DRAFT', 'cleanup-test',
            now() - ($4::text || ' days')::interval - interval '1 minute',
            now() - ($4::text || ' days')::interval,
            60000,
            now() - ($4::text || ' days')::interval
          )
        `,
        [randomUUID(), args.runId ?? null, adminUserId, args.daysAgo],
      );
    };

    await insertLog({ runId: oldDraftRunId, daysAgo: 220 });
    await insertLog({ runId: oldPostedRunId, daysAgo: 220 });
    await insertLog({ daysAgo: 220 });
    await insertLog({ daysAgo: 1 });

    const preview = await app.inject({
      method: "POST",
      url: "/admin/settlements/cleanup",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        dryRun: true,
        draftRetentionDays: 120,
        executionLogRetentionDays: 120,
      },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().dryRun).toBe(true);
    expect(preview.json().oldDraftRunCount).toBe(1);
    expect(preview.json().oldExecutionLogCount).toBeGreaterThanOrEqual(3);

    const execute = await app.inject({
      method: "POST",
      url: "/admin/settlements/cleanup",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        dryRun: false,
        draftRetentionDays: 120,
        executionLogRetentionDays: 120,
      },
    });
    expect(execute.statusCode).toBe(200);
    expect(execute.json().dryRun).toBe(false);
    expect(execute.json().deletedRunCount).toBe(1);
    expect(execute.json().deletedOldLogCount + execute.json().deletedDraftLogCount).toBeGreaterThanOrEqual(3);

    const runDraft = await db.query<{ id: string }>("select id from settlement_runs where id = $1", [oldDraftRunId]);
    expect(runDraft.rows.length).toBe(0);

    const runPosted = await db.query<{ id: string }>("select id from settlement_runs where id = $1", [oldPostedRunId]);
    expect(runPosted.rows.length).toBe(1);

    const oldLogCount = await db.query<{ cnt: string | number }>(
      "select count(*) as cnt from settlement_execution_logs where created_at < now() - interval '120 days'",
    );
    expect(Number(oldLogCount.rows[0]?.cnt ?? 0)).toBe(0);

    const newLogCount = await db.query<{ cnt: string | number }>(
      "select count(*) as cnt from settlement_execution_logs where created_at >= now() - interval '120 days'",
    );
    expect(Number(newLogCount.rows[0]?.cnt ?? 0)).toBeGreaterThanOrEqual(1);
  });
});
