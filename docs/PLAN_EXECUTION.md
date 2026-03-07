## Goal
- 交付一个“可上线、可运维、可审计”的完整系统：管理员后台 + 代理端 + 月结算自动跑批 + 调整单 + 报表导出。

## Assumptions / constraints
- 本地开发环境无 Docker：默认 DB 使用 PGlite（持久化到 `backend/.data/`），可选接真实 Postgres（`DATABASE_URL`）。
- 时区口径：结算与“当月异常一票否决”以 `Asia/Shanghai`（+08:00）为准。
- 结算数据以 `settlement_items` 作为“记账行项目”主账本；POSTED 后修正走 ADJUSTMENT（delta 方式，不回写历史）。

## Research (current state)
- Modules/subprojects involved:
  - `backend/`: Fastify + JWT + PGlite/pg，SQL migrations，Admin/Agent API，定时任务
  - `shared/commission-engine/`: 纯函数佣金引擎（扶持/稳定、二级差价、不结算口径、截断）
- Key files/paths:
  - `backend/src/app.ts`, `backend/src/server.ts`
  - `backend/migrations/*.sql`
  - `backend/src/routes/admin/*`, `backend/src/routes/agent/*`
  - `backend/src/settlement/*`
  - `shared/commission-engine/src/*`
  - `docs/PRD.md`, `docs/commission.md`, `docs/settlement-engine.md`, `docs/PROGRESS.md`
- Entrypoints (API/UI/CLI/Jobs):
  - API:
    - `/auth/*`, `/admin/*`, `/agent/*`
  - Jobs:
    - `backend/src/jobs/monthlySettlement.ts`（每月 5 号 00:10 自动生成上月 DRAFT）
  - CLI:
    - `npm run migrate`, `npm run seed`, `npm run dev:backend`, `npm test`
- Related configs/flags:
  - `backend/.env`：`JWT_SECRET`, `TZ`, `DATABASE_URL?`, `PGLITE_PATH`
- Data models/storage touched:
  - users/agents/teams/team_memberships/agent_relations/plans/policies/cards/card_assignments/card_status_events
  - settlement_runs/settlement_items
  - job_locks
- Interfaces/contracts (APIs/events/IPC):
  - Admin CRUD + settlement workflow endpoints
  - Agent scope endpoints（self + 一级/二级）
- Existing patterns to follow:
  - 用 zod 做 body 校验
  - `DRAFT` 可重算覆盖；`POSTED` 只允许 delta 调整
  - 测试用 `setupAdminTestApp()`（独立 PGlite + migrations + admin login）

## Analysis
### Options
1) 先把 Backend 完成到“可运营”（报表/审计/安全/导出/调账），最后再做前端。
2) 先做前端（Admin/Agent 页面），再补齐审计/导出/安全。

### Decision
- Chosen: 1) 后端优先
- Why: 结算/调账/报表的口径一旦确定，前端只是 UI 映射；先把“账本”打牢更省返工。

### Risks / edge cases
- 金额精度：JS number 可能产生极端浮点误差；后续可切换为“分/万分比整型计算”以完全规避。
- 时区边界：PGlite 默认 timezone=GMT，必须显式用 +08 月末时间点参与“当月异常”判定。
- 并发：重算/跑批并发会互相覆盖；已用 `job_locks` 做互斥，后续多实例再加 advisory lock 也可。
- 历史可复算：配置变更后，历史 POSTED 不应被改变；依赖快照与 ADJUSTMENT delta 解释。

### Open questions
- 暂无（按当前 PRD 口径继续推进；如你后续要“会计科目/分录”再加 ledger 表）。

## Q&A results (captured after the session)
- Outcome/acceptance criteria:
  - 管理员可完整录入配置/代理/团队/网卡并结算、审核入账、发现错误可调账、可导出报表
  - 代理端能看同事（一级/二级）、团队成员、本人在网卡
  - 每月 5 号自动结算上月（生成 DRAFT），并可按代理重算
- Scope boundaries:
  - 先以 `settlement_items` 作为账本；不强制引入“会计科目/借贷分录”
- Constraints/non-goals:
  - 本地无 Docker 优先；生产部署方案后置（M9）
- Known modules/paths/subprojects:
  - 同 Research
- Decisions made in Q&A:
  - POSTED 修正走 delta ADJUSTMENT
  - 时区以 +08 口径
- Remaining open questions (if any):
  - 无

## Implementation plan
1) 报表增强（M7 补齐）
   - 增加筛选：按代理/团队/星级/卡状态过滤
   - 增加“调整差异视图”：对比 base vs net（base + adjustments）
   - 增加 Excel 导出（在 CSV 基础上引入 exceljs）
2) Agent 端完善（M6 补齐）
   - “我的 5G 网卡”口径：仅返回当前在网（NORMAL）卡
   - 新增“团队/下级网卡”视图时，非本人卡号脱敏 `192******16`
   - 增加公告（简单 `announcements` 表 + Agent GET）
3) 操作审计与安全（M8）
   - 新增 `audit_logs` 表（who/when/entity/action/before/after）
   - 在关键 Admin 路由写入审计（团队/代理/等级/卡/状态/结算/调账）
   - 登录失败限流（按 ip+username 简易滑窗）+ 管理员禁用账号入口
4) 运维与部署（M9）
   - `backend/Dockerfile` + 生产 compose（可选）
   - 备份/恢复 runbook（PGlite 文件备份 + Postgres pg_dump）
   - CI（npm test + typecheck）
5) 前端（M10）
   - admin-web/agent-web（Next.js）
   - 登录、CRUD 列表/表单、结算运行记录、导出入口

## Tests to run
- `npm test`
- `npm run typecheck`
- 手工冒烟：
  - 录入等级/代理/网卡 -> `POST /admin/settlements/recalculate`
  - approve/post -> 调整 -> 导出 CSV

