# 进度追踪

> 说明：每次自动化或手工推进后，更新本文件勾选项，并在 `docs/auto/` 产出当次记录。
> 2026-02-18：当前里程碑条目均已勾选，无新增待办。

## Milestones

### M1: 结算引擎可运行
- [x] `shared/commission-engine` 结算逻辑实现
- [x] `npm test` 测试通过（黄金用例覆盖：扶持/稳定、异常一票否决、二级差价不重叠、截断）

### M2: 数据库与迁移
- [x] `docker-compose.yml` 提供 Postgres
- [x] 迁移器 `backend/scripts/migrate.ts`
- [x] 初始 schema `backend/migrations/001_init.sql`
- [x] 本地完成 `npm run migrate` + `npm run seed` + `/health/db` 全流程验证（默认 PGlite，无 Docker）

### M3: Backend API 骨架 + Auth/RBAC
- [x] Fastify 服务骨架与 `/health`
- [x] `/auth/login` + `/auth/me`
- [x] RBAC（ADMIN 全量；AGENT 仅 self + 一级/二级范围）

### M4: Admin 核心 CRUD
- [x] 团队管理（标签/名称自定义；成员管理）
- [x] 代理管理（星级、上下级、防环）
- [x] 星级管理（support_rate/stable_rate/stable_months）
- [x] 套餐管理（monthly_rent）
- [x] 网卡管理（录入/归属/激活日期/状态事件）

### M5: 结算跑批/重算/入账/调整
- [x] 每月 5 号自动结算上月（带 DB 锁与幂等）
- [x] 按代理重算（SELF+DIFF1+DIFF2；扫描本人+一级+二级）
- [x] 状态流转：DRAFT -> APPROVED -> POSTED
- [x] POSTED 后调整单（反冲 + 补记，审计链路）
- [x] 历史星级口径：按结算月末优先取 `agent_level_histories`，无命中时回退最早历史记录，避免当前星级污染历史重算
- [x] 入账分录闭环：POST 生成 `SETTLEMENT_POST` 分录，调整生成 `SETTLEMENT_ADJUST` 分录（按 `settlement_item` 明细落行）

### M6: Agent 端最小可用
- [x] 我的同事（姓名/在网卡数/星级/等级差价；并可查看下级在网卡（脱敏））
- [x] 我的 5G 网卡（默认仅在网；本人完整号；团队/下级脱敏 192******16）
- [x] 团队固定展示：`团队：{成员名}`

### M7: 报表/导出/对账
- [x] 按月导出行项目（按卡明细 + 按代理汇总 + 按团队汇总）
- [x] 支持筛选（月份/代理/团队/星级/卡状态/期别/类型/归属）
- [x] 调整单差异视图（前后对比）

### M8: 操作审计与安全完善
- [x] 审计日志（关键实体变更：团队/等级/卡/状态/结算/公告）
- [x] 登录失败限流 + 管理员禁用账号
- [x] 关键接口权限回归测试（ADMIN/AGENT/未登录/越权范围）
- [x] Dashboard 接口契约回归测试（`/admin/stats*` + `/agent/stats*`）

### M9: 运维与部署
- [x] backend Dockerfile + 生产 compose
- [x] 备份/恢复 runbook
- [x] CI：跑 test + typecheck

### M10: 前端与体验完善
- [x] Admin UI 核心页面：登录、总览、星级、套餐、政策、团队、代理、网卡、结算、报表、公告、审计
- [x] Agent UI 核心页面：登录、总览、我的网卡、我的团队、我的同事、公告
- [x] 本地构建与运行验证（无 Docker；Next.js 使用 webpack 规避中文路径 Turbopack 崩溃）
- [x] 结算页分页：结算单列表 + 跑批执行记录（limit/offset）
- [x] Admin UI：分页能力补齐（结算/代理/网卡/审计/团队/公告）
- [x] Agent UI：分页能力补齐（我的网卡/我的团队网卡/同事网卡）
- [x] Dashboard 聚合统计：`/admin/stats` + `/agent/stats`（减少首页多请求）
- [x] Dashboard 趋势看板：最近 6 个月结算/佣金趋势（Admin + Agent）
- [x] Dashboard 趋势窗口切换：3/6/12 个月（Admin + Agent）
- [x] Dashboard 运营预警：失败跑批/草稿积压/调整占比异常（Admin）
- [x] Dashboard 可视化增强：趋势金额占比条 + 趋势汇总卡（Admin + Agent）
- [x] Dashboard 预警详情增强：展示预警 `meta` 字段（Admin）
- [x] 团队标签前端显式展示：固定 `团队：{成员名}`（团队成员/团队网卡）
- [x] 报表接口增强：`/admin/reports/settlement-items-preview`（分页预览 + 全筛选口径）
- [x] 报表页增强：筛选自动记忆 + 列配置 + 导出前预览分页
- [x] 结算详情增强：行项目筛选/排序/分页 + 列配置记忆 + 过滤口径汇总
- [x] 结算跑批运行记录（耗时/行数/失败原因）
- [x] 性能优化：关键索引 + 慢查询基准
- [x] 前后端本地全量验证：`npm test`、`npm run typecheck`、`npm -w admin-web run build`、`npm -w agent-web run build` 全绿
- [x] Admin 新增“入账分录”页：支持按月份/来源/结算单/收益人筛选并查看分录行明细
- [x] 入账分录增强：支持 CSV 导出（`/admin/ledger/entries.csv`）与按收益人汇总（`/admin/ledger/summary/agents`）
- [x] 本地无 Docker 一键联调：`npm run dev:all`（迁移+seed+三端并发）与 `npm run dev:all:fast`
- [x] 新增全量回归命令：`npm run verify`（test + typecheck + admin/agent build）
- [x] 报表导出链路修复：Admin 报表页与结算详情页导出 CSV 改为 Bearer token 下载（移除未鉴权裸链接）
- [x] 报表导出增强：新增 `/admin/reports/settlement-items.xlsx`，并在 Admin 报表页/结算详情页支持 CSV + XLSX 双格式导出
- [x] 分录导出增强：新增 `/admin/ledger/entries.xlsx`，并在 Admin 分录页支持 CSV + XLSX 双格式导出
- [x] 导出审计增强：报表与分录 CSV/XLSX 导出写入审计日志（`REPORT_EXPORT_SETTLEMENT_ITEMS` / `LEDGER_EXPORT_ENTRIES`），审计页新增一键筛选
- [x] 审计导出增强：新增 `/admin/audit-logs.csv`、`/admin/audit-logs.xlsx`，支持与列表同口径筛选导出
- [x] 审计统计增强：新增 `/admin/audit-logs/export-summary`，审计页补齐导出汇总 + 按日明细视图
- [x] 审计导出留痕增强：审计页 CSV/XLSX 导出写入 `AUDIT_EXPORT_LOGS`，形成“导出行为全链路审计”
- [x] Dashboard 预警增强：`/admin/stats/alerts` 新增导出频次异常预警 `EXPORT_VOLUME_SPIKE`（支持阈值和窗口配置）
- [x] 前端导出能力收敛：统一 `apiDownload`（报表/分录/结算详情/审计四页复用，统一鉴权与错误处理）
- [x] 账单格式导出：新增 `/admin/reports/bill.csv|xlsx`，按“卡号/入网日期/套餐/月租/状态/扶持期/稳定期/金额”模板输出并附总计
- [x] 账单导出审计：新增审计动作 `REPORT_EXPORT_BILL_FORMAT`，并纳入审计统计与导出频次预警
- [x] 验证链路稳定性修复：`npm ci --force` 清理重装依赖后恢复 Next 构建稳定；`npm run typecheck` 调整为后端口径，前端类型检查由 build 覆盖
- [x] 运行时版本约束落地：新增 `.node-version=22.17.0` 并在 README 标注 Node 22.x 推荐
- [x] 新增联调冒烟命令：`npm run smoke:live`（检查健康、登录、权限与关键管理接口可用性）
- [x] 全量回归再验证：`fnm exec --using v22.17.0 -- npm run verify` 通过（test + typecheck + admin/agent build）
- [x] 本地稳定性收尾：将历史依赖备份目录移出仓库根目录（迁移到 `/Users/yuchenxu/Desktop/_ruwang_backup_modules/`），避免构建/测试误扫描
- [x] 联调冒烟增强：`scripts/smoke-live.mjs` 增加服务就绪重试（默认 120s），降低三端启动阶段误报失败
- [x] 服务器启动能力补齐（无 Docker）：新增 `server:*` 脚本（prepare/start/stop/status/health）与启动脚本 `scripts/server-*.sh`
- [x] 服务器配置模板补齐：新增 `admin-web/.env.production.example`、`agent-web/.env.production.example`，并补充 runbook `docs/runbooks/server-startup.md`
- [x] 服务器开机自启补齐：新增 `systemd` 部署指引（`ruwang-taocan.service`），支持重启后自动拉起三端
- [x] 启停脚本防混版本修复：`scripts/server-stop.sh` 增加按端口清理遗留监听进程，避免旧 `next start` 进程残留导致“已重启但仍跑旧前端代码”
- [x] 管理端中文化完善：结算/结算详情/入账分录/网卡状态核心字段与枚举改为中文展示，降低操作门槛
- [x] 删除能力补齐：新增删除草稿账单（仅 DRAFT）与删除网卡（仅未参与结算），并补齐前端入口与回归测试
- [x] 佣金口径一致性修复：网卡转移支持“生效日期”入参并按生效时点切换归属；状态事件支持 `YYYY-MM-DD` 规范化为 `+08:00` 零点，避免日期偏移导致“异常月仍结算”；结算计算改为严格按结算月月末关系快照（不回退当前关系）
- [x] 管理端可解释性增强：结算详情元信息同时展示“结算月份”与“运行月份(创建月)”；网卡详情日期展示改为本地日历日格式，避免 UTC 截断错位
- [x] 状态事件更正能力补齐：新增 `DELETE /admin/cards/:id/status-events/:eventId`（禁止删除最后一条事件；若已进入 `POSTED` 月份窗口则锁定并要求走调整单），管理端网卡详情页新增删除入口与错误提示
- [x] 网卡列表兼容修复：`GET /admin/cards` 新增兼容分页协议（`withTotal=1` 返回 `{rows,total,limit,offset}`）并支持 `keyword/status/ownerAgentId` 筛选，修复“已有网卡未显示”
- [x] 网卡详情白屏修复：详情页改为直连 `GET /admin/cards/:id`，不再依赖列表返回结构；补充详情接口回归测试，避免接口契约变化导致前端崩溃
- [x] 网卡转移同日生效修复：`POST /admin/cards/:id/assign` 在 `effectiveAt == 当前 assignment.start_at` 时改为原地改归属，避免触发 `card_assignments_check` 导致 500；`effectiveAt` 早于当前开始时间返回明确错误码
- [x] 代理上下级生效时间增强：`PUT /admin/agents/:id/upline` 新增 `effectiveAt(YYYY-MM-DD)`，支持回填生效日/同关系回填开始日/开始前重写，保障历史月重算可对齐真实层级
- [x] 管理端职工详情页增强：上下级设置新增“生效日期”输入并提交 `effectiveAt`；错误码（循环/本人/不存在/生效日非法）补齐中文提示
- [x] 结算详情页可用性回补：恢复“仅查看收益人为当前输入”快捷按钮与“汇总-搜索某职工”输入框，支持一键套用收益人过滤
