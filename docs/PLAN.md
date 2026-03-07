# 开发规划 (v2: 机器完善版)

目标：不止做 MVP，而是由机器持续推进，最终交付一个“可上线、可运维、可审计”的完整系统（后台 + 代理端 + 结算 + 报表 + 运维部署）。

## Definition of Done (完成标准)
- 功能：
  - `docs/PRD.md` 中管理员端与代理端功能全部落地
  - 结算：每月 5 号自动结算上月；支持按代理重算预览；POSTED 后走调整单
  - 报表：支持按月导出（CSV/Excel）与按代理/团队汇总查询
- 可靠性：
  - 结算可复算、幂等、可审计（含快照字段与操作日志）
  - 核心规则变更必须有 ADR
  - 单元测试覆盖佣金引擎 + 结算写库逻辑（黄金用例）
- 运维：
  - 一键本地启动（DB + 后端 + 迁移），并有清晰 README
  - 生产部署方案（Dockerfile/compose 或等价），含备份/迁移策略
  - 基础监控：health、结构化日志（可选接入 Sentry）

## 0. 技术选型 (建议默认)
- Backend: Node.js + TypeScript + Fastify
- DB: PostgreSQL (生产)；本地默认使用 PGlite (WASM) 持久化到 `backend/.data/`，无需 Docker（可通过 `DATABASE_URL` 切换真实 Postgres）
- Jobs: 后端内置 cron + DB 幂等/锁（单实例可直接跑；多实例用 DB advisory lock）
- Shared: `shared/commission-engine` 纯函数引擎 + 黄金用例测试
- Frontend (后续): admin-web/agent-web 各自独立（React/Next 或 Vue 均可，先不锁死）

若你有既定技术栈（Spring/Vue、Laravel、Django 等），现在说一声我可以按你的栈重新规划目录。

## 1. 里程碑与交付物

### M1: 结算引擎可运行 (优先级最高)
交付：
- `shared/commission-engine`：
  - 支持：扶持期/稳定期/到期、二级差价不重叠、当月异常一票否决、金额截断
  - `vitest` 测试覆盖：月份边界、异常状态跨月、差价三种典型场景、截断
验收：
- `npm test` 全绿
- 给定固定输入数据，输出行项目完全一致（可复算）

### M2: 数据库与迁移 (支撑可审计/可复算)
交付：
- `docker-compose.yml`（可选，用于接入真实 Postgres）
- 默认本地 DB：PGlite (WASM)，无需 Docker
- 迁移脚本（SQL migrations）：
  - users, agents, teams, team_memberships
  - agent_levels, plans, cards, card_assignments, card_status_events
  - settlement_runs, settlement_items (+ adjustment 关联)
- 必要的唯一键与索引（幂等/查询性能）
验收：
- 本地无需 Docker：`npm run migrate` + `npm run seed` + `GET /health/db` 全链路跑通（默认 PGlite）
- 可选：接入真实 Postgres（`DATABASE_URL` 或 `docker compose up`）后迁移同样成功
- 能插入一组样例数据并跑通一次结算写库

### M3: Backend API 骨架 + Auth/RBAC
交付：
- Fastify 服务、配置系统、JWT 登录
- RBAC：
  - ADMIN: 全权限
  - AGENT: 仅 self + 一级/二级下级范围
- 基础接口：
  - health
  - auth/login, auth/me
验收：
- 角色越权访问被拒绝

### M4: Admin 核心 CRUD (支撑跑批)
交付（最小集合）：
- 团队管理：团队标签/名称自定义；成员归属（代理同一时间仅一个团队）
- 代理管理：基本信息、星级、上下级关系（防环）、归属团队
- 星级管理：support_rate/stable_rate/stable_months（编辑后立即生效）
- 套餐管理：monthly_rent
- 网卡管理：录入/归属/激活日期；状态事件维护
验收：
- 能录入一张卡，从激活到状态变更
- 能配置星级比例并影响下一次结算预览

### M5: 结算跑批/重算/入账/调整
交付：
- 每月 5 号自动结算上月（可手动触发）
- 结算单状态流转：DRAFT -> APPROVED -> POSTED
- “按代理重算”：
  - 重算该代理作为收益人的所有行项目（SELF+DIFF1+DIFF2）
  - 扫描卡范围：本人 + 一级下级 + 二级下级
- POSTED 后禁止覆盖，走 ADJUSTMENT
验收：
- 重复跑批不重复入账（幂等）
- 手工重算能在 DRAFT 中覆盖该代理行项目
- POSTED 后重算生成调整行，历史可追溯

### M6: Agent 端接口与页面 (最低可用)
交付：
- 我的同事：一级/二级列表（姓名、在网卡数、星级）
- 我的 5G 网卡：本人开卡完整号；非本人卡号脱敏（192******16）
- 团队展示固定文案：`团队：{成员名}`，团队两个字不可改
验收：
- 权限隔离正确，号码脱敏正确

### M7: 报表/导出/对账 (从可用到可运营)
交付：
- 结算报表：
  - 按月导出行项目（CSV/Excel）：按卡明细 + 按代理汇总 + 按团队汇总
  - 支持筛选：月份、代理、团队、星级、卡状态
- 对账辅助：
  - 结算单与调整单的差异视图（前后对比）
验收：
- 给定某月结算单，能一键导出并复现汇总 totals

### M8: 操作审计与安全完善
交付：
- 操作日志（audit log）：
  - 记录：谁在什么时候对哪些实体做了什么变更（前后快照/差异）
- 登录安全：
  - 密码策略、登录失败限流（最小防爆破）
  - 管理员可禁用账号
- 权限回归测试（关键接口）
验收：
- 任意一个结算结果都能追溯到对应配置版本与关键数据变更记录

### M9: 运维与部署 (可上线)
交付：
- Dockerfile（backend）+ 生产 compose（backend + db）
- 环境变量清单与样例 `.env.example`
- 备份/恢复说明（pg_dump/restore）+ 数据迁移策略
- CI（至少跑：npm test + backend typecheck）
验收：
- 新机器按 README 可启动并完成一次结算 demo

### M10: 前端与体验完善
交付：
- Admin/Agent 前端：
  - 分页、搜索、筛选、导出入口
  - 关键表单校验与错误提示
- 性能与可用性：
  - 关键查询加索引、慢查询基准用例
  - 结算跑批的运行记录（耗时、行数、失败原因）
验收：
- 管理员日常操作无需手工 SQL；代理端查询在合理时间内完成

## 2. 风险点与提前决策
- 多实例跑批重复执行：需要 DB 锁 + 幂等唯一键，或把跑批搬到单独的 CronJob
- “状态异常一票否决”需要按状态时间线判定（跨月延续异常也应判 0）
- 归属/上下级/星级若允许月中变更，需要定义“按月取哪个时点的快照”
  - MVP 建议：按月末快照（或月初快照），并写入结算快照字段

## 3. 立刻开工顺序 (下一步)
当前后端已覆盖 M1-M8 的核心闭环（结算/报表/审计/代理端接口）。下一阶段把“可用接口”落到“可用产品”。

1. 前端（Admin/Agent）落地：可登录、可配置、可结算、可导出、可对账、可审计查询
2. 运维交付：Dockerfile/生产 compose（可选）、备份/恢复 runbook、基础 CI
3. 安全与回归：关键权限回归测试持续补齐（越权/号码脱敏/结算不可变更）

## 4. 前端实施清单 (详细)

### 4.1 Admin Web (Next.js)
目标：管理员不用写 SQL 就能完成“录入-结算-对账-纠错-追责”闭环。

页面与接口映射（优先级从高到低）：
1. 登录
   - `POST /auth/login`
2. 总览
   - 基础统计（可后端补一个 `/admin/stats`，或先前端聚合现有列表）
3. 基础配置
   - 星级：`/admin/agent-levels`（GET/POST/PUT）
   - 套餐：`/admin/plans`（GET/POST/PUT）
   - 政策：`/admin/policies`（GET/POST/PUT）
4. 组织与人员
   - 团队：`/admin/teams`（GET/POST/PUT）+ 成员管理（members list/add/remove）
   - 代理：`/admin/agents`（GET/POST/PUT）+ 上下级（GET/PUT upline）
5. 网卡与状态
   - 网卡：`/admin/cards`（GET/POST/PUT）
   - 归属转移：`POST /admin/cards/:id/assign`
   - 状态事件：`GET/POST /admin/cards/:id/status-events`
6. 结算与对账
   - 跑批/重算：`POST /admin/settlements/recalculate`
   - 结算单列表：`GET /admin/settlements/runs`
   - 明细：`GET /admin/settlements/runs/:id/items`
   - 审核/入账：`POST /admin/settlements/runs/:id/approve|unapprove|post`
   - 调整：`POST /admin/settlements/runs/:id/adjust`
   - 差异：`GET /admin/settlements/runs/:id/diff`
7. 报表导出
   - 明细 CSV：`GET /admin/reports/settlement-items.csv`（带筛选参数）
   - 汇总：`GET /admin/reports/settlement-summary/agents|teams`（带筛选参数）
8. 公告与审计
   - 公告：`/admin/announcements`（GET/POST/PUT）
   - 审计：`GET /admin/audit-logs`（筛选/分页）

体验要求：
- 列表：分页/搜索/筛选/导出按钮（按功能逐步补齐）
- 表单：强校验（前端 zod + 后端 zod），错误提示清晰
- 操作风险：结算“POSTED 后不可覆盖”的提示与护栏必须明显

### 4.2 Agent Web (Next.js)
目标：代理能清楚看到同事/团队/卡状态/公告，并严格遵守号码脱敏。

页面与接口映射：
1. 登录：`POST /auth/login`
2. 首页：我的资料（`GET /agent/me`）+ 公告（`GET /agent/announcements`）
3. 我的同事：`GET /agent/downlines`
4. 团队成员：`GET /agent/team-members`
5. 我的 5G 网卡：`GET /agent/cards`（默认在网）
6. 团队网卡：`GET /agent/team/cards`（非本人脱敏）
7. 下级网卡：`GET /agent/downlines/cards`（全部脱敏）

体验要求：
- 默认移动端优先（大字号/可点击行/列表卡片化）
- 明确标识：本人卡与非本人卡（isOwn）
