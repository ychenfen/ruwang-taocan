# 性能基线 Runbook（关键索引 + 慢查询）

## 1. 目标
- 在不改业务语义前提下，优先优化结算与报表热点查询。
- 用统一脚本产出可追踪的慢查询基线，避免“感觉变快/变慢”。

## 2. 已落地索引
- 迁移文件：`backend/migrations/006_perf_indexes.sql`
- 覆盖场景：
  - 结算月末归属扫描：`card_assignments(card_id/owner_agent_id, start_at, end_at)`
  - 上下级月末有效关系：`agent_relations(upline_agent_id/agent_id, start_at, end_at)`
  - 团队月末有效关系：`team_memberships(agent_id/team_id, start_at, end_at)`
  - 结算单与行项目查询：`settlement_runs(created_at)`、`settlement_items(settlement_run_id, created_at/kind/beneficiary)`
  - 调整单链路：`settlement_items(adjustment_of_item_id)`

## 3. 生成慢查询基线
在项目根目录执行：

```bash
npm run migrate
npm run perf:baseline
```

输出文件：`docs/perf/slow-query-baseline.md`

可选环境变量：
- `BASELINE_MONTH=YYYY-MM`：指定结算月（默认取最新结算月，否则当前月）
- `BASELINE_AGENT_ID=<agentId>`：指定代理样本（用于代理范围查询）
- `DATABASE_URL=...`：连接外部 Postgres（不传则使用本地 PGlite）

## 4. 判读口径
- 先看 `Execution Time`，再看执行计划是否命中新索引（`Index Scan` / `Bitmap Index Scan`）。
- 首次运行可能出现较高 `Planning Time`（冷启动现象），建议连续跑 2~3 次取中位数。
- 如果 `Execution Time` 明显上升，优先排查：
  - 是否命中预期索引
  - 数据量增长是否超出当前分页/查询策略
  - 是否新增了高选择性差的筛选条件

## 5. 回归建议
- 每次改动结算 SQL、报表 SQL、索引策略后，必须重跑一次基线并提交产物。
- PR 描述中至少附：
  - 变更前后 `Execution Time` 对比
  - 关键查询是否命中目标索引
