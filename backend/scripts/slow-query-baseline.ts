import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";

import { createDb, type Db } from "../src/db.js";

type QueryCase = Readonly<{
  name: string;
  description: string;
  sql: string;
  params: ReadonlyArray<string>;
}>;

type QueryReport = Readonly<{
  name: string;
  description: string;
  sql: string;
  params: ReadonlyArray<string>;
  executionMs: number | null;
  planLines: string[];
}>;

function toYearMonth(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function parseExecutionMs(planLines: ReadonlyArray<string>): number | null {
  for (const line of planLines) {
    const m = line.match(/Execution Time:\s*([0-9.]+)\s*ms/i);
    if (m?.[1]) return Number(m[1]);
  }
  return null;
}

async function detectCommissionMonth(db: Db): Promise<string> {
  const r = await db.query<{ commission_month: string }>(
    "select commission_month from settlement_runs order by created_at desc limit 1",
  );
  return r.rows[0]?.commission_month ?? toYearMonth(new Date());
}

async function detectAgentId(db: Db): Promise<string> {
  const r = await db.query<{ id: string }>("select id from agents order by created_at asc limit 1");
  return r.rows[0]?.id ?? "";
}

async function explainAnalyze(db: Db, query: QueryCase): Promise<QueryReport> {
  const explainSql = `EXPLAIN ANALYZE ${query.sql}`;
  const r = await db.query<Record<string, unknown>>(explainSql, [...query.params]);
  const planLines = r.rows.map((row) => {
    const hit = (row as Record<string, unknown>)["QUERY PLAN"];
    if (typeof hit === "string") return hit;
    const first = Object.values(row)[0];
    return typeof first === "string" ? first : JSON.stringify(first);
  });

  return {
    name: query.name,
    description: query.description,
    sql: query.sql,
    params: query.params,
    executionMs: parseExecutionMs(planLines),
    planLines,
  };
}

function renderMarkdown(args: {
  dbKind: string;
  commissionMonth: string;
  scopedAgentId: string;
  reports: ReadonlyArray<QueryReport>;
}): string {
  const { dbKind, commissionMonth, scopedAgentId, reports } = args;
  const generatedAt = new Date().toISOString();
  const sorted = [...reports].sort((a, b) => (b.executionMs ?? -1) - (a.executionMs ?? -1));

  const lines: string[] = [];
  lines.push("# 慢查询基线（EXPLAIN ANALYZE）");
  lines.push("");
  lines.push(`- 生成时间：${generatedAt}`);
  lines.push(`- 数据库类型：${dbKind}`);
  lines.push(`- 结算月：${commissionMonth}`);
  lines.push(`- 代理范围样本：${scopedAgentId || "(无代理样本，使用空值)"}`);
  lines.push("");
  lines.push("## 概览（按执行耗时降序）");
  lines.push("");
  lines.push("| Query | Execution Time (ms) | 描述 |");
  lines.push("|---|---:|---|");
  for (const q of sorted) {
    lines.push(`| ${q.name} | ${q.executionMs === null ? "N/A" : q.executionMs.toFixed(3)} | ${q.description} |`);
  }

  for (const q of sorted) {
    lines.push("");
    lines.push(`## ${q.name}`);
    lines.push("");
    lines.push(q.description);
    lines.push("");
    lines.push("```sql");
    lines.push(q.sql.trim());
    lines.push("```" );
    lines.push("");
    lines.push(`参数：${JSON.stringify(q.params)}`);
    lines.push("");
    lines.push("```text");
    lines.push(...q.planLines);
    lines.push("```");
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const pglitePath = process.env.PGLITE_PATH ?? "./.data/pglite";
  const db = await createDb({ databaseUrl, pglitePath });

  try {
    const commissionMonth = process.env.BASELINE_MONTH ?? (await detectCommissionMonth(db));
    const scopedAgentId = process.env.BASELINE_AGENT_ID ?? (await detectAgentId(db));

    const queries: QueryCase[] = [
      {
        name: "settlement_cards_scan",
        description: "结算计算：按月末生效归属扫描卡池（owner scope 可选）。",
        params: [commissionMonth],
        sql: `
with m as (
  select (($1 || '-01T00:00:00+08:00')::timestamptz + interval '1 month' - interval '1 millisecond') as month_end
)
select c.id, ca.owner_agent_id
from cards c
join card_assignments ca on ca.card_id = c.id
join m on true
where ca.start_at <= m.month_end
  and (ca.end_at is null or ca.end_at > m.month_end)
order by c.created_at asc
`,
      },
      {
        name: "settlement_relations_l1",
        description: "结算计算：查某代理一级下级（按月末有效关系）。",
        params: [commissionMonth, scopedAgentId],
        sql: `
with m as (
  select (($1 || '-01T00:00:00+08:00')::timestamptz + interval '1 month' - interval '1 millisecond') as month_end
)
select r.agent_id
from agent_relations r, m
where r.upline_agent_id = $2
  and r.start_at <= m.month_end
  and (r.end_at is null or r.end_at > m.month_end)
`,
      },
      {
        name: "report_agent_summary",
        description: "报表聚合：按代理汇总结算金额并关联当月团队。",
        params: [commissionMonth],
        sql: `
with m as (
  select (($1 || '-01T00:00:00+08:00')::timestamptz + interval '1 month' - interval '1 millisecond') as month_end
)
select si.beneficiary_agent_id, count(*) as line_count, sum(si.amount) as total_amount
from settlement_runs sr
join settlement_items si on si.settlement_run_id = sr.id
join agents a on a.id = si.beneficiary_agent_id
join m on true
left join team_memberships tm on tm.agent_id = a.id and tm.start_at <= m.month_end and (tm.end_at is null or tm.end_at > m.month_end)
where sr.commission_month = $1
group by si.beneficiary_agent_id
order by sum(si.amount) desc
`,
      },
      {
        name: "adjust_base_items_scope",
        description: "调整单生成：读取指定结算单非调整类行项目（可按代理过滤）。",
        params: [commissionMonth, scopedAgentId],
        sql: `
select id, card_id, beneficiary_agent_id, kind, amount
from settlement_items
where settlement_run_id = (select id from settlement_runs where commission_month = $1 limit 1)
  and kind <> 'ADJUSTMENT'
  and ($2 = '' or beneficiary_agent_id = $2)
`,
      },
    ];

    const reports: QueryReport[] = [];
    for (const q of queries) {
      reports.push(await explainAnalyze(db, q));
    }

    const output = renderMarkdown({
      dbKind: db.kind,
      commissionMonth,
      scopedAgentId,
      reports,
    });

    const outDir = path.resolve(process.cwd(), "..", "docs", "perf");
    await fs.mkdir(outDir, { recursive: true });
    const outFile = path.join(outDir, "slow-query-baseline.md");
    await fs.writeFile(outFile, output, "utf-8");

    // eslint-disable-next-line no-console
    console.log(`wrote: ${outFile}`);
    for (const r of reports.sort((a, b) => (b.executionMs ?? -1) - (a.executionMs ?? -1))) {
      // eslint-disable-next-line no-console
      console.log(`${r.name}: ${r.executionMs === null ? "N/A" : r.executionMs.toFixed(3)} ms`);
    }
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
