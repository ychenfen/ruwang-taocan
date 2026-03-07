import type { FastifyPluginAsync } from "fastify";
import * as XLSX from "xlsx";
import { z } from "zod";

import { requireRole } from "../../auth/prehandlers.js";
import { writeAuditLog } from "../../audit/log.js";

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

function snapshotObj(x: any): any {
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

function trunc2(n: number): number {
  return Math.trunc(n * 100) / 100;
}

function formatNumberCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return n.toFixed(2).replace(/\.?0+$/, "");
}

function formatPercentFromRatio(ratio: number): string {
  return `${formatNumberCompact(trunc2(ratio * 100))}%`;
}

function formatJoinMonth(dateText: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(dateText ?? ""));
  if (!m) return String(dateText ?? "");
  return `${m[1]}年${Number(m[2])}月`;
}

function statusZh(status: string): string {
  if (status === "NORMAL") return "正常";
  if (status === "PAUSED") return "停机";
  if (status === "LEFT") return "离网";
  if (status === "CONTROLLED") return "管控";
  if (status === "ABNORMAL") return "异常";
  return status;
}

function runStatusZh(status: string): string {
  if (status === "DRAFT") return "草稿";
  if (status === "APPROVED") return "已审核";
  if (status === "POSTED") return "已入账";
  return status;
}

function kindZh(kind: string): string {
  if (kind === "SELF") return "本人佣金";
  if (kind === "UPLINE_DIFF_1") return "一级差价";
  if (kind === "UPLINE_DIFF_2") return "二级差价";
  if (kind === "ADJUSTMENT") return "调整";
  return kind;
}

function periodZh(periodType: string): string {
  if (periodType === "SUPPORT") return "扶持期";
  if (periodType === "STABLE") return "稳定期";
  return periodType;
}

function nameWithEmployeeNo(name: string | null | undefined, employeeNo: string | null | undefined): string {
  const n = String(name ?? "").trim();
  const no = String(employeeNo ?? "").trim();
  if (n && no) return `${n}/${no}`;
  if (n) return n;
  if (no) return no;
  return "";
}

export const adminReportRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireRole("ADMIN"));

  const commissionMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
  const settlementItemsExportQuerySchema = z.object({
    commissionMonth: commissionMonthSchema,
    beneficiaryAgentId: z.string().min(1).optional(),
    teamId: z.string().min(1).optional(),
    levelId: z.string().min(1).optional(),
    kind: z.enum(["SELF", "UPLINE_DIFF_1", "UPLINE_DIFF_2", "ADJUSTMENT"]).optional(),
    targetKind: z.enum(["SELF", "UPLINE_DIFF_1", "UPLINE_DIFF_2"]).optional(),
    periodType: z.enum(["SUPPORT", "STABLE"]).optional(),
    ownerAgentId: z.string().min(1).optional(),
    cardStatus: z.enum(["NORMAL", "PAUSED", "LEFT", "CONTROLLED", "ABNORMAL"]).optional(),
  });
  type SettlementItemsExportQuery = z.infer<typeof settlementItemsExportQuerySchema>;

  const settlementItemsExportColumns = [
    "佣金月份",
    "结算状态",
    "卡号",
    "月末状态",
    "归属职工",
    "收益职工",
    "团队",
    "收益星级",
    "佣金类型",
    "目标类型",
    "期别",
    "月租基数",
    "比例",
    "金额",
    "调整原因",
    "创建时间",
    "行项目ID",
    "卡ID",
    "调整来源ID",
  ] as const;
  type SettlementItemsExportRow = Readonly<Record<(typeof settlementItemsExportColumns)[number], string | number>>;

  const billColumns = [
    "卡号",
    "入网日期",
    "套餐",
    "月租（根据套餐自动判断）",
    "状态",
    "扶持期（根据星级自动判断）",
    "稳定期（根据星级自动判断）",
    "金额",
  ] as const;
  type BillColumn = (typeof billColumns)[number];
  type BillExportRow = Readonly<Record<BillColumn, string>>;

  function buildSettlementItemsWhere(paramsIn: SettlementItemsExportQuery): Readonly<{ where: string[]; params: any[] }> {
    const { commissionMonth, beneficiaryAgentId, teamId, levelId, kind, targetKind, periodType, ownerAgentId, cardStatus } =
      paramsIn;
    const where: string[] = ["sr.commission_month = $1"];
    const params: any[] = [commissionMonth];
    const push = (cond: string, v: any) => {
      params.push(v);
      where.push(cond.replaceAll("?", `$${params.length}`));
    };
    if (beneficiaryAgentId) push("si.beneficiary_agent_id = ?", beneficiaryAgentId);
    if (teamId) push("tm.team_id = ?", teamId);
    if (levelId) push("a.current_level_id = ?", levelId);
    if (kind) push("si.kind = ?", kind);
    if (targetKind) push("tk.target_kind = ?", targetKind);
    if (periodType) push("si.period_type = ?", periodType);
    if (ownerAgentId) push("(si.snapshot->>'ownerAgentId') = ?", ownerAgentId);
    if (cardStatus) push("cs.status = ?", cardStatus);
    return { where, params };
  }

  async function loadSettlementItemsExportRows(query: SettlementItemsExportQuery): Promise<SettlementItemsExportRow[] | null> {
    const run = await app.db.query<{ id: string; status: string }>(
      "select id, status from settlement_runs where commission_month = $1 limit 1",
      [query.commissionMonth],
    );
    if (!run.rows[0]) return null;

    const { where, params } = buildSettlementItemsWhere(query);
    const rows = await app.db.query<{
      id: string;
      run_status: string;
      commission_month: string;
      card_id: string;
      card_no: string | null;
      card_status_at_month_end: string | null;
      owner_agent_id: string | null;
      owner_agent_name: string | null;
      owner_employee_no: string | null;
      beneficiary_agent_id: string;
      beneficiary_name: string | null;
      beneficiary_employee_no: string | null;
      team_name: string | null;
      beneficiary_level_id: string | null;
      beneficiary_level_name: string | null;
      kind: string;
      target_kind: string;
      period_type: string;
      base_monthly_rent: string | number;
      ratio: string | number;
      amount: string | number;
      adjustment_of_item_id: string | null;
      adjustment_reason: string | null;
      snapshot: any;
      created_at: string;
    }>(
      `
        with m as (
          select (($1 || '-01T00:00:00+08:00')::timestamptz + interval '1 month' - interval '1 millisecond') as month_end
        ),
        tk as (
          select
            si.id as item_id,
            case
              when si.kind = 'ADJUSTMENT' then coalesce(base.kind, si.snapshot->>'targetKind')
              else si.kind
            end as target_kind
          from settlement_items si
          left join settlement_items base on base.id = si.adjustment_of_item_id
          where si.settlement_run_id = (select id from settlement_runs where commission_month = $1 limit 1)
        )
        select
          si.id,
          sr.status as run_status,
          sr.commission_month,
          si.card_id,
          c.card_no,
          cs.status as card_status_at_month_end,
          (si.snapshot->>'ownerAgentId') as owner_agent_id,
          (si.snapshot->>'ownerAgentName') as owner_agent_name,
          owner.employee_no as owner_employee_no,
          si.beneficiary_agent_id,
          a.name as beneficiary_name,
          a.employee_no as beneficiary_employee_no,
          t.name as team_name,
          a.current_level_id as beneficiary_level_id,
          al.name as beneficiary_level_name,
          si.kind,
          tk.target_kind,
          si.period_type,
          si.base_monthly_rent,
          si.ratio,
          si.amount,
          si.adjustment_of_item_id,
          si.adjustment_reason,
          si.snapshot,
          si.created_at
        from settlement_runs sr
        join settlement_items si on si.settlement_run_id = sr.id
        left join cards c on c.id = si.card_id
        left join agents a on a.id = si.beneficiary_agent_id
        left join agents owner on owner.id = (si.snapshot->>'ownerAgentId')
        join m on true
        left join agent_levels al on al.id = a.current_level_id
        left join team_memberships tm on tm.agent_id = a.id and tm.start_at <= m.month_end and (tm.end_at is null or tm.end_at > m.month_end)
        left join teams t on t.id = tm.team_id
        join tk on tk.item_id = si.id
        left join lateral (
          select e.status
          from card_status_events e
          where e.card_id = c.id and e.happened_at <= m.month_end
          order by e.happened_at desc, e.created_at desc, e.id desc
          limit 1
        ) cs on true
        where ${where.join(" and ")}
        order by si.created_at asc
      `,
      params,
    );

    return rows.rows.map((r) => {
      const snap = snapshotObj(r.snapshot);
      const targetKind = r.target_kind ?? (r.kind === "ADJUSTMENT" ? (snap?.targetKind ?? "") : r.kind);
      const ownerAgent = nameWithEmployeeNo(r.owner_agent_name, r.owner_employee_no) || (r.owner_agent_id ?? "");
      const beneficiaryAgent = nameWithEmployeeNo(r.beneficiary_name, r.beneficiary_employee_no) || r.beneficiary_agent_id;
      const beneficiaryLevelName = String(r.beneficiary_level_name ?? r.beneficiary_level_id ?? "");
      const cardNo = String(r.card_no ?? snap?.cardNo ?? "");
      const monthEndStatus = String(r.card_status_at_month_end ?? snap?.statusAtMonthEnd ?? snap?.cardStatusAtMonthEnd ?? "");
      return {
        佣金月份: r.commission_month,
        结算状态: runStatusZh(r.run_status),
        卡号: cardNo,
        月末状态: monthEndStatus ? statusZh(monthEndStatus) : "",
        归属职工: ownerAgent,
        收益职工: beneficiaryAgent,
        团队: r.team_name ?? "",
        收益星级: beneficiaryLevelName,
        佣金类型: kindZh(r.kind),
        目标类型: kindZh(targetKind),
        期别: periodZh(r.period_type),
        月租基数: formatNumberCompact(Number(r.base_monthly_rent)),
        比例: formatPercentFromRatio(Number(r.ratio)),
        金额: formatNumberCompact(Number(r.amount)),
        调整原因: r.adjustment_reason ?? "",
        创建时间: r.created_at,
        行项目ID: r.id,
        卡ID: r.card_id,
        调整来源ID: r.adjustment_of_item_id ?? "",
      };
    });
  }

  async function loadBillExportRows(
    query: SettlementItemsExportQuery,
  ): Promise<Readonly<{ rows: BillExportRow[]; totalAmount: number }> | null> {
    const run = await app.db.query<{ id: string }>(
      "select id from settlement_runs where commission_month = $1 limit 1",
      [query.commissionMonth],
    );
    if (!run.rows[0]) return null;

    const { where, params } = buildSettlementItemsWhere(query);
    if (!query.kind) {
      where.push("si.kind <> 'ADJUSTMENT'");
    }

    const dbRows = await app.db.query<{
      card_no: string;
      activated_at: string;
      plan_name: string;
      base_monthly_rent: string | number;
      card_status_at_month_end: string;
      period_type: string;
      ratio: string | number;
      amount: string | number;
      target_kind: string;
      created_at: string;
    }>(
      `
        with m as (
          select (($1 || '-01T00:00:00+08:00')::timestamptz + interval '1 month' - interval '1 millisecond') as month_end
        ),
        tk as (
          select
            si.id as item_id,
            case
              when si.kind = 'ADJUSTMENT' then coalesce(base.kind, si.snapshot->>'targetKind')
              else si.kind
            end as target_kind
          from settlement_items si
          left join settlement_items base on base.id = si.adjustment_of_item_id
          where si.settlement_run_id = (select id from settlement_runs where commission_month = $1 limit 1)
        )
        select
          c.card_no,
          c.activated_at::text as activated_at,
          p.name as plan_name,
          si.base_monthly_rent,
          cs.status as card_status_at_month_end,
          si.period_type,
          si.ratio,
          si.amount,
          tk.target_kind,
          si.created_at
        from settlement_runs sr
        join settlement_items si on si.settlement_run_id = sr.id
        join cards c on c.id = si.card_id
        join plans p on p.id = c.plan_id
        join agents a on a.id = si.beneficiary_agent_id
        join m on true
        left join team_memberships tm on tm.agent_id = a.id and tm.start_at <= m.month_end and (tm.end_at is null or tm.end_at > m.month_end)
        join tk on tk.item_id = si.id
        join lateral (
          select e.status
          from card_status_events e
          where e.card_id = c.id and e.happened_at <= m.month_end
          order by e.happened_at desc, e.created_at desc, e.id desc
          limit 1
        ) cs on true
        where ${where.join(" and ")}
        order by
          c.card_no asc,
          case when tk.target_kind = 'SELF' then 0 else 1 end asc,
          si.created_at asc
      `,
      params,
    );

    const withZeroSelfRows =
      (query.kind === undefined || query.kind === "SELF") &&
      (query.targetKind === undefined || query.targetKind === "SELF");

    const syntheticRows = withZeroSelfRows
      ? await app.db.query<{
          card_no: string;
          activated_at: string;
          plan_name: string;
          base_monthly_rent: string | number;
          card_status_at_month_end: string;
          period_type: "SUPPORT" | "STABLE" | null;
          created_at: string;
        }>(
          `
            with m as (
              select (($1 || '-01T00:00:00+08:00')::timestamptz + interval '1 month' - interval '1 millisecond') as month_end
            ),
            run as (
              select id from settlement_runs where commission_month = $1 limit 1
            )
            select
              c.card_no,
              c.activated_at::text as activated_at,
              p.name as plan_name,
              p.monthly_rent as base_monthly_rent,
              cs.status as card_status_at_month_end,
              case
                when mi.month_index < 2 then null
                when mi.month_index <= 11 then 'SUPPORT'
                when (mi.month_index - 11) <= al.stable_months then 'STABLE'
                else null
              end as period_type,
              c.created_at::text as created_at
            from run r
            join m on true
            join cards c on true
            join plans p on p.id = c.plan_id
            join card_assignments ca on ca.card_id = c.id and ca.start_at <= m.month_end and (ca.end_at is null or ca.end_at > m.month_end)
            join agents owner on owner.id = ca.owner_agent_id
            join lateral (
              select
                (
                  (extract(year from ($1 || '-01')::date)::int * 12 + extract(month from ($1 || '-01')::date)::int)
                  - (extract(year from c.activated_at)::int * 12 + extract(month from c.activated_at)::int)
                  + 1
                ) as month_index
            ) mi on true
            join agent_levels al on al.id = owner.current_level_id
            left join team_memberships tm on tm.agent_id = owner.id and tm.start_at <= m.month_end and (tm.end_at is null or tm.end_at > m.month_end)
            join lateral (
              select e.status
              from card_status_events e
              where e.card_id = c.id and e.happened_at <= m.month_end
              order by e.happened_at desc, e.created_at desc, e.id desc
              limit 1
            ) cs on true
            left join settlement_items self_si on self_si.settlement_run_id = r.id and self_si.card_id = c.id and self_si.beneficiary_agent_id = owner.id and self_si.kind = 'SELF'
            where self_si.id is null
              and ($2::text is null or owner.id = $2)
              and ($3::text is null or tm.team_id = $3)
              and ($4::text is null or owner.current_level_id = $4)
              and ($5::text is null or owner.id = $5)
              and ($6::text is null or cs.status = $6)
            order by c.card_no asc, c.created_at asc
          `,
          [
            query.commissionMonth,
            query.beneficiaryAgentId ?? null,
            query.teamId ?? null,
            query.levelId ?? null,
            query.ownerAgentId ?? null,
            query.cardStatus ?? null,
          ],
        )
      : { rows: [] as Array<any> };

    const mergedRows = [
      ...dbRows.rows.map((r) => ({
        card_no: r.card_no,
        activated_at: r.activated_at,
        plan_name: r.plan_name,
        base_monthly_rent: Number(r.base_monthly_rent),
        card_status_at_month_end: r.card_status_at_month_end,
        period_type: r.period_type as "SUPPORT" | "STABLE",
        ratio: Number(r.ratio),
        amount: Number(r.amount),
        target_kind: r.target_kind,
        created_at: r.created_at,
      })),
      ...syntheticRows.rows
        .filter((r) => (query.periodType ? r.period_type === query.periodType : true))
        .filter((r) => r.period_type === "SUPPORT" || r.period_type === "STABLE")
        .map((r) => ({
          card_no: r.card_no,
          activated_at: r.activated_at,
          plan_name: r.plan_name,
          base_monthly_rent: Number(r.base_monthly_rent),
          card_status_at_month_end: r.card_status_at_month_end,
          period_type: r.period_type as "SUPPORT" | "STABLE",
          ratio: 0,
          amount: 0,
          target_kind: "SELF",
          created_at: r.created_at,
        })),
    ];

    mergedRows.sort((a, b) => {
      const cardCmp = a.card_no.localeCompare(b.card_no, "zh-Hans-CN", { numeric: true });
      if (cardCmp !== 0) return cardCmp;
      const kindCmp = (a.target_kind === "SELF" ? 0 : 1) - (b.target_kind === "SELF" ? 0 : 1);
      if (kindCmp !== 0) return kindCmp;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

    const rows = mergedRows.map<BillExportRow>((r) => {
      const ratio = Number(r.ratio);
      const supportRatio = r.period_type === "SUPPORT" ? ratio : 0;
      const stableRatio = r.period_type === "STABLE" ? ratio : 0;
      const amount = Number(r.amount);
      const monthlyRent = Number(r.base_monthly_rent);
      const tag = r.target_kind === "SELF" ? "本人" : "团队";
      return {
        卡号: `${r.card_no}(${tag})`,
        入网日期: formatJoinMonth(r.activated_at),
        套餐: r.plan_name,
        "月租（根据套餐自动判断）": `${formatNumberCompact(monthlyRent)}元`,
        状态: statusZh(r.card_status_at_month_end),
        "扶持期（根据星级自动判断）": formatPercentFromRatio(supportRatio),
        "稳定期（根据星级自动判断）": formatPercentFromRatio(stableRatio),
        金额: formatNumberCompact(amount),
      };
    });
    const totalAmount = mergedRows.reduce((s, x) => s + Number(x.amount), 0);
    return { rows, totalAmount };
  }

  app.get("/reports/settlement-items.csv", async (request, reply) => {
    const parsed = settlementItemsExportQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const rows = await loadSettlementItemsExportRows(parsed.data);
    if (!rows) return reply.code(404).send({ error: "RUN_NOT_FOUND" });
    const lines: string[] = [];
    lines.push(settlementItemsExportColumns.map(escapeCsv).join(","));
    for (const r of rows) {
      const row = settlementItemsExportColumns.map((k) => escapeCsv(r[k]));
      lines.push(row.join(","));
    }

    const csv = lines.join("\n");
    await writeAuditLog(app.db, {
      actorUserId: request.user.sub,
      actorRole: "ADMIN",
      action: "REPORT_EXPORT_SETTLEMENT_ITEMS",
      entityType: "reports",
      meta: {
        format: "csv",
        filters: parsed.data,
        rowCount: rows.length,
      },
    });
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename=\"settlement-items-${parsed.data.commissionMonth}.csv\"`);
    return reply.send(csv);
  });

  app.get("/reports/settlement-items.xlsx", async (request, reply) => {
    const parsed = settlementItemsExportQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });

    const rows = await loadSettlementItemsExportRows(parsed.data);
    if (!rows) return reply.code(404).send({ error: "RUN_NOT_FOUND" });

    const sheet = toSheetByColumns(rows, [...settlementItemsExportColumns]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "SettlementItems");
    const buf = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    await writeAuditLog(app.db, {
      actorUserId: request.user.sub,
      actorRole: "ADMIN",
      action: "REPORT_EXPORT_SETTLEMENT_ITEMS",
      entityType: "reports",
      meta: {
        format: "xlsx",
        filters: parsed.data,
        rowCount: rows.length,
      },
    });

    reply.header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    reply.header("content-disposition", `attachment; filename=\"settlement-items-${parsed.data.commissionMonth}.xlsx\"`);
    return reply.send(buf);
  });

  app.get("/reports/bill.csv", async (request, reply) => {
    const parsed = settlementItemsExportQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });

    const bill = await loadBillExportRows(parsed.data);
    if (!bill) return reply.code(404).send({ error: "RUN_NOT_FOUND" });

    const lines: string[] = [];
    lines.push(billColumns.map(escapeCsv).join(","));
    for (const r of bill.rows) {
      const row = billColumns.map((k) => escapeCsv(r[k]));
      lines.push(row.join(","));
    }
    const summary: BillExportRow = {
      卡号: "",
      入网日期: "",
      套餐: "",
      "月租（根据套餐自动判断）": "",
      状态: "",
      "扶持期（根据星级自动判断）": "",
      "稳定期（根据星级自动判断）": "",
      金额: `总计：${formatNumberCompact(bill.totalAmount)}元`,
    };
    lines.push(billColumns.map((k) => escapeCsv(summary[k])).join(","));
    const csv = lines.join("\n");

    await writeAuditLog(app.db, {
      actorUserId: request.user.sub,
      actorRole: "ADMIN",
      action: "REPORT_EXPORT_BILL_FORMAT",
      entityType: "reports",
      meta: {
        format: "csv",
        filters: parsed.data,
        rowCount: bill.rows.length,
        totalAmount: trunc2(bill.totalAmount),
      },
    });

    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename=\"bill-${parsed.data.commissionMonth}.csv\"`);
    return reply.send(csv);
  });

  app.get("/reports/bill.xlsx", async (request, reply) => {
    const parsed = settlementItemsExportQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });

    const bill = await loadBillExportRows(parsed.data);
    if (!bill) return reply.code(404).send({ error: "RUN_NOT_FOUND" });

    const sheetRows: BillExportRow[] = [...bill.rows];
    sheetRows.push({
      卡号: "",
      入网日期: "",
      套餐: "",
      "月租（根据套餐自动判断）": "",
      状态: "",
      "扶持期（根据星级自动判断）": "",
      "稳定期（根据星级自动判断）": "",
      金额: `总计：${formatNumberCompact(bill.totalAmount)}元`,
    });
    const sheet = toSheetByColumns(sheetRows, [...billColumns]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Bill");
    const buf = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    await writeAuditLog(app.db, {
      actorUserId: request.user.sub,
      actorRole: "ADMIN",
      action: "REPORT_EXPORT_BILL_FORMAT",
      entityType: "reports",
      meta: {
        format: "xlsx",
        filters: parsed.data,
        rowCount: bill.rows.length,
        totalAmount: trunc2(bill.totalAmount),
      },
    });

    reply.header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    reply.header("content-disposition", `attachment; filename=\"bill-${parsed.data.commissionMonth}.xlsx\"`);
    return reply.send(buf);
  });

  app.get("/reports/settlement-items-preview", async (request, reply) => {
    const querySchema = z.object({
      commissionMonth: commissionMonthSchema,
      beneficiaryAgentId: z.string().min(1).optional(),
      teamId: z.string().min(1).optional(),
      levelId: z.string().min(1).optional(),
      kind: z.enum(["SELF", "UPLINE_DIFF_1", "UPLINE_DIFF_2", "ADJUSTMENT"]).optional(),
      targetKind: z.enum(["SELF", "UPLINE_DIFF_1", "UPLINE_DIFF_2"]).optional(),
      periodType: z.enum(["SUPPORT", "STABLE"]).optional(),
      ownerAgentId: z.string().min(1).optional(),
      cardStatus: z.enum(["NORMAL", "PAUSED", "LEFT", "CONTROLLED", "ABNORMAL"]).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
      offset: z.coerce.number().int().min(0).optional(),
    });

    const parsed = querySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const {
      commissionMonth,
      beneficiaryAgentId,
      teamId,
      levelId,
      kind,
      targetKind,
      periodType,
      ownerAgentId,
      cardStatus,
      limit: limitRaw,
      offset: offsetRaw,
    } = parsed.data;

    const run = await app.db.query<{ id: string; status: string }>(
      "select id, status from settlement_runs where commission_month = $1 limit 1",
      [commissionMonth],
    );
    const runRow = run.rows[0];
    if (!runRow) return reply.code(404).send({ error: "RUN_NOT_FOUND" });

    const where: string[] = ["sr.commission_month = $1"];
    const params: any[] = [commissionMonth];
    const push = (cond: string, v: any) => {
      params.push(v);
      where.push(cond.replaceAll("?", `$${params.length}`));
    };
    if (beneficiaryAgentId) push("si.beneficiary_agent_id = ?", beneficiaryAgentId);
    if (teamId) push("tm.team_id = ?", teamId);
    if (levelId) push("a.current_level_id = ?", levelId);
    if (kind) push("si.kind = ?", kind);
    if (targetKind) push("tk.target_kind = ?", targetKind);
    if (periodType) push("si.period_type = ?", periodType);
    if (ownerAgentId) push("(si.snapshot->>'ownerAgentId') = ?", ownerAgentId);
    if (cardStatus) push("cs.status = ?", cardStatus);

    const countR = await app.db.query<{ total: string | number }>(
      `
        with m as (
          select (($1 || '-01T00:00:00+08:00')::timestamptz + interval '1 month' - interval '1 millisecond') as month_end
        ),
        tk as (
          select
            si.id as item_id,
            case
              when si.kind = 'ADJUSTMENT' then coalesce(base.kind, si.snapshot->>'targetKind')
              else si.kind
            end as target_kind
          from settlement_items si
          left join settlement_items base on base.id = si.adjustment_of_item_id
          where si.settlement_run_id = (select id from settlement_runs where commission_month = $1 limit 1)
        )
        select count(*) as total
        from settlement_runs sr
        join settlement_items si on si.settlement_run_id = sr.id
        join cards c on c.id = si.card_id
        join agents a on a.id = si.beneficiary_agent_id
        join m on true
        left join team_memberships tm on tm.agent_id = a.id and tm.start_at <= m.month_end and (tm.end_at is null or tm.end_at > m.month_end)
        join tk on tk.item_id = si.id
        join lateral (
          select e.status
          from card_status_events e
          where e.card_id = c.id and e.happened_at <= m.month_end
          order by e.happened_at desc, e.created_at desc, e.id desc
          limit 1
        ) cs on true
        where ${where.join(" and ")}
      `,
      params,
    );
    const total = Number(countR.rows[0]?.total ?? 0);
    const limit = limitRaw ?? 50;
    const offset = offsetRaw ?? 0;

    const rows = await app.db.query<{
      id: string;
      run_status: string;
      commission_month: string;
      card_id: string;
      card_no: string;
      card_status_at_month_end: string;
      owner_agent_id: string | null;
      owner_agent_name: string | null;
      beneficiary_agent_id: string;
      beneficiary_name: string;
      team_name: string | null;
      beneficiary_level_id: string;
      beneficiary_level_name: string;
      kind: string;
      target_kind: string;
      period_type: string;
      base_monthly_rent: string | number;
      ratio: string | number;
      amount: string | number;
      adjustment_of_item_id: string | null;
      adjustment_reason: string | null;
      created_at: string;
    }>(
      `
        with m as (
          select (($1 || '-01T00:00:00+08:00')::timestamptz + interval '1 month' - interval '1 millisecond') as month_end
        ),
        tk as (
          select
            si.id as item_id,
            case
              when si.kind = 'ADJUSTMENT' then coalesce(base.kind, si.snapshot->>'targetKind')
              else si.kind
            end as target_kind
          from settlement_items si
          left join settlement_items base on base.id = si.adjustment_of_item_id
          where si.settlement_run_id = (select id from settlement_runs where commission_month = $1 limit 1)
        )
        select
          si.id,
          sr.status as run_status,
          sr.commission_month,
          si.card_id,
          c.card_no,
          cs.status as card_status_at_month_end,
          (si.snapshot->>'ownerAgentId') as owner_agent_id,
          (si.snapshot->>'ownerAgentName') as owner_agent_name,
          si.beneficiary_agent_id,
          a.name as beneficiary_name,
          t.name as team_name,
          a.current_level_id as beneficiary_level_id,
          al.name as beneficiary_level_name,
          si.kind,
          tk.target_kind,
          si.period_type,
          si.base_monthly_rent,
          si.ratio,
          si.amount,
          si.adjustment_of_item_id,
          si.adjustment_reason,
          si.created_at
        from settlement_runs sr
        join settlement_items si on si.settlement_run_id = sr.id
        join cards c on c.id = si.card_id
        join agents a on a.id = si.beneficiary_agent_id
        join m on true
        join agent_levels al on al.id = a.current_level_id
        left join team_memberships tm on tm.agent_id = a.id and tm.start_at <= m.month_end and (tm.end_at is null or tm.end_at > m.month_end)
        left join teams t on t.id = tm.team_id
        join tk on tk.item_id = si.id
        join lateral (
          select e.status
          from card_status_events e
          where e.card_id = c.id and e.happened_at <= m.month_end
          order by e.happened_at desc, e.created_at desc, e.id desc
          limit 1
        ) cs on true
        where ${where.join(" and ")}
        order by si.created_at asc
        limit $${params.length + 1}
        offset $${params.length + 2}
      `,
      [...params, limit, offset],
    );

    return {
      runId: runRow.id,
      runStatus: runRow.status,
      commissionMonth,
      total,
      limit,
      offset,
      rows: rows.rows.map((r) => ({
        itemId: r.id,
        runStatus: r.run_status,
        commissionMonth: r.commission_month,
        cardId: r.card_id,
        cardNo: r.card_no,
        cardStatusAtMonthEnd: r.card_status_at_month_end,
        ownerAgentId: r.owner_agent_id ?? undefined,
        ownerAgentName: r.owner_agent_name ?? undefined,
        beneficiaryAgentId: r.beneficiary_agent_id,
        beneficiaryName: r.beneficiary_name,
        teamName: r.team_name ?? undefined,
        beneficiaryLevelId: r.beneficiary_level_id,
        beneficiaryLevelName: r.beneficiary_level_name,
        kindRaw: r.kind,
        targetKind: r.target_kind,
        periodType: r.period_type,
        baseMonthlyRent: Number(r.base_monthly_rent),
        ratio: Number(r.ratio),
        amount: Number(r.amount),
        adjustmentOfItemId: r.adjustment_of_item_id ?? undefined,
        adjustmentReason: r.adjustment_reason ?? undefined,
        createdAt: r.created_at,
      })),
    };
  });

  app.get("/reports/settlement-summary/agents", async (request, reply) => {
    const querySchema = z.object({
      commissionMonth: commissionMonthSchema,
      beneficiaryAgentId: z.string().min(1).optional(),
      teamId: z.string().min(1).optional(),
      levelId: z.string().min(1).optional(),
      kind: z.enum(["SELF", "UPLINE_DIFF_1", "UPLINE_DIFF_2", "ADJUSTMENT"]).optional(),
      targetKind: z.enum(["SELF", "UPLINE_DIFF_1", "UPLINE_DIFF_2"]).optional(),
      periodType: z.enum(["SUPPORT", "STABLE"]).optional(),
      ownerAgentId: z.string().min(1).optional(),
      cardStatus: z.enum(["NORMAL", "PAUSED", "LEFT", "CONTROLLED", "ABNORMAL"]).optional(),
    });

    const parsed = querySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const {
      commissionMonth,
      beneficiaryAgentId,
      teamId,
      levelId,
      kind,
      targetKind,
      periodType,
      ownerAgentId,
      cardStatus,
    } = parsed.data;

    const where: string[] = ["sr.commission_month = $1"];
    const params: any[] = [commissionMonth];
    const push = (cond: string, v: any) => {
      params.push(v);
      where.push(cond.replaceAll("?", `$${params.length}`));
    };
    if (beneficiaryAgentId) push("si.beneficiary_agent_id = ?", beneficiaryAgentId);
    if (teamId) push("tm.team_id = ?", teamId);
    if (levelId) push("a.current_level_id = ?", levelId);
    if (kind) push("si.kind = ?", kind);
    if (targetKind) push("tk.target_kind = ?", targetKind);
    if (periodType) push("si.period_type = ?", periodType);
    if (ownerAgentId) push("(si.snapshot->>'ownerAgentId') = ?", ownerAgentId);
    if (cardStatus) push("cs.status = ?", cardStatus);

    const r = await app.db.query<{
      beneficiary_agent_id: string;
      beneficiary_name: string;
      team_id: string | null;
      team_name: string | null;
      line_count: string | number;
      total_amount: string | number;
    }>(
      `
        with m as (
          select (($1 || '-01T00:00:00+08:00')::timestamptz + interval '1 month' - interval '1 millisecond') as month_end
        ),
        tk as (
          select
            si.id as item_id,
            case
              when si.kind = 'ADJUSTMENT' then coalesce(base.kind, si.snapshot->>'targetKind')
              else si.kind
            end as target_kind
          from settlement_items si
          left join settlement_items base on base.id = si.adjustment_of_item_id
          where si.settlement_run_id = (select id from settlement_runs where commission_month = $1 limit 1)
        )
        select
          si.beneficiary_agent_id,
          a.name as beneficiary_name,
          tm.team_id,
          t.name as team_name,
          count(*) as line_count,
          sum(si.amount) as total_amount
        from settlement_runs sr
        join settlement_items si on si.settlement_run_id = sr.id
        join tk on tk.item_id = si.id
        join cards c on c.id = si.card_id
        join agents a on a.id = si.beneficiary_agent_id
        join m on true
        left join team_memberships tm on tm.agent_id = a.id and tm.start_at <= m.month_end and (tm.end_at is null or tm.end_at > m.month_end)
        left join teams t on t.id = tm.team_id
        join lateral (
          select e.status
          from card_status_events e
          where e.card_id = c.id and e.happened_at <= m.month_end
          order by e.happened_at desc, e.created_at desc, e.id desc
          limit 1
        ) cs on true
        where ${where.join(" and ")}
        group by si.beneficiary_agent_id, a.name, tm.team_id, t.name
        order by sum(si.amount) desc
      `,
      params,
    );

    return r.rows.map((x) => ({
      beneficiaryAgentId: x.beneficiary_agent_id,
      beneficiaryName: x.beneficiary_name,
      teamId: x.team_id ?? undefined,
      teamName: x.team_name ?? undefined,
      lineCount: Number(x.line_count),
      totalAmount: Number(x.total_amount),
    }));
  });

  app.get("/reports/settlement-summary/teams", async (request, reply) => {
    const querySchema = z.object({
      commissionMonth: commissionMonthSchema,
      teamId: z.string().min(1).optional(),
      kind: z.enum(["SELF", "UPLINE_DIFF_1", "UPLINE_DIFF_2", "ADJUSTMENT"]).optional(),
      targetKind: z.enum(["SELF", "UPLINE_DIFF_1", "UPLINE_DIFF_2"]).optional(),
      periodType: z.enum(["SUPPORT", "STABLE"]).optional(),
      ownerAgentId: z.string().min(1).optional(),
      cardStatus: z.enum(["NORMAL", "PAUSED", "LEFT", "CONTROLLED", "ABNORMAL"]).optional(),
    });

    const parsed = querySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
    const { commissionMonth, teamId, kind, targetKind, periodType, ownerAgentId, cardStatus } = parsed.data;

    const where: string[] = ["sr.commission_month = $1"];
    const params: any[] = [commissionMonth];
    const push = (cond: string, v: any) => {
      params.push(v);
      where.push(cond.replaceAll("?", `$${params.length}`));
    };
    if (teamId) push("tm.team_id = ?", teamId);
    if (kind) push("si.kind = ?", kind);
    if (targetKind) push("tk.target_kind = ?", targetKind);
    if (periodType) push("si.period_type = ?", periodType);
    if (ownerAgentId) push("(si.snapshot->>'ownerAgentId') = ?", ownerAgentId);
    if (cardStatus) push("cs.status = ?", cardStatus);

    const r = await app.db.query<{
      team_id: string | null;
      team_name: string | null;
      agent_count: string | number;
      total_amount: string | number;
    }>(
      `
        with m as (
          select (($1 || '-01T00:00:00+08:00')::timestamptz + interval '1 month' - interval '1 millisecond') as month_end
        ),
        tk as (
          select
            si.id as item_id,
            case
              when si.kind = 'ADJUSTMENT' then coalesce(base.kind, si.snapshot->>'targetKind')
              else si.kind
            end as target_kind
          from settlement_items si
          left join settlement_items base on base.id = si.adjustment_of_item_id
          where si.settlement_run_id = (select id from settlement_runs where commission_month = $1 limit 1)
        )
        select
          tm.team_id,
          t.name as team_name,
          count(distinct si.beneficiary_agent_id) as agent_count,
          sum(si.amount) as total_amount
        from settlement_runs sr
        join settlement_items si on si.settlement_run_id = sr.id
        join tk on tk.item_id = si.id
        join cards c on c.id = si.card_id
        join agents a on a.id = si.beneficiary_agent_id
        join m on true
        left join team_memberships tm on tm.agent_id = a.id and tm.start_at <= m.month_end and (tm.end_at is null or tm.end_at > m.month_end)
        left join teams t on t.id = tm.team_id
        join lateral (
          select e.status
          from card_status_events e
          where e.card_id = c.id and e.happened_at <= m.month_end
          order by e.happened_at desc, e.created_at desc, e.id desc
          limit 1
        ) cs on true
        where ${where.join(" and ")}
        group by tm.team_id, t.name
        order by sum(si.amount) desc
      `,
      params,
    );

    return r.rows.map((x) => ({
      teamId: x.team_id ?? undefined,
      teamName: x.team_name ?? undefined,
      agentCount: Number(x.agent_count),
      totalAmount: Number(x.total_amount),
    }));
  });
};
