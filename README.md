# 入网套餐后台 (WIP)

该仓库目前已落地：
- 需求与口径文档：`docs/`
- 佣金结算引擎（纯函数 + 测试）：`shared/commission-engine`
- 后端骨架 + DB 迁移：`backend/`

默认无需 Docker：后端使用内置 Postgres（PGlite，WASM）持久化到 `backend/.data/`。
如你未来要接真实 Postgres，只需设置 `DATABASE_URL`。

## Node 版本建议
- 推荐 Node.js `22.x`（已在本地验证 `v22.17.0`）。
- 仓库已提供 `.node-version`：`22.17.0`。
- 若你使用 `fnm`：
```bash
fnm use v22.17.0
```
- 部分环境在 Node `24.x` 下运行 Next 构建可能出现不稳定报错，建议切回 22.x 再执行前端构建。

## 本地启动 (Backend + DB)
1. 安装依赖
```bash
npm install
```

推荐一键启动（自动迁移 + 初始化管理员 + 同时启动后端/管理端/代理端）：
```bash
npm run dev:all
```

如果你已经迁移并初始化过数据，使用快速启动：
```bash
npm run dev:all:fast
```

2. 配置后端环境变量
- 复制 `backend/.env.example` 为 `backend/.env` 并按需修改

3. 执行迁移（默认使用 PGlite）
```bash
npm run migrate
```

4. 初始化管理员账号（开发环境）
```bash
npm run seed
```

5. 启动后端
```bash
npm run dev:backend
```

后台内置定时任务：
- 每月 5 号 00:10（本地时区）自动生成上月结算草稿（DRAFT）
- 也可手动调用 `POST /admin/settlements/recalculate`

> 说明：`dev:backend` 脚本已带开发默认 `JWT_SECRET` 与 `TZ=Asia/Shanghai` 兜底，无需 Docker 可直接启动。

## 本地启动 (Admin + Agent 前端)
管理端与代理端均使用 Next.js，默认端口如下：
- Admin Web: `http://localhost:3001`
- Agent Web: `http://localhost:3002`

启动命令（各开一个终端）：
```bash
npm run dev:admin
npm run dev:agent
```

或直接用上一节的一键命令：
```bash
npm run dev:all
```

说明：
- 已默认使用 webpack 模式（`next dev --webpack` / `next build --webpack`），避免 Turbopack 在中文路径下崩溃。
- 管理员默认账号来自 `npm run seed`：`admin / admin123456`。
- 代理账号需在管理端“代理管理”中新增后再登录代理端。

健康检查：
- `GET http://localhost:3000/health`
- `GET http://localhost:3000/health/db`

登录接口：
- `POST http://localhost:3000/auth/login` `{ "username": "admin", "password": "admin123456" }`
- `GET http://localhost:3000/auth/me` (Bearer token)

已实现的代理端接口（部分，需 AGENT JWT）：
- `GET /agent/me`
- `GET /agent/downlines`
- `GET /agent/downlines/cards`（下级/二级下级在网卡列表，卡号脱敏）
- `GET /agent/team-members`
- `GET /agent/team/cards`（团队在网卡列表：本人完整号；非本人脱敏）
- `GET /agent/cards`（默认仅在网卡；可用 `?onNetOnly=false` 查看全部）
- `GET /agent/announcements`

已实现的管理端接口（部分）：
- 星级：`GET/POST/PUT /admin/agent-levels`
- 套餐：`GET/POST/PUT /admin/plans`
- 政策：`GET/POST/PUT /admin/policies`
- 团队：`GET/POST/PUT /admin/teams`、`GET /admin/teams/:id/members`、`POST /admin/teams/:id/members`、`DELETE /admin/teams/:id/members/:agentId`
- 代理：`GET/POST/PUT /admin/agents`、`GET/PUT /admin/agents/:id/upline`
- 网卡：`GET/POST/PUT /admin/cards`、`POST /admin/cards/:id/assign`、`GET/POST /admin/cards/:id/status-events`
  - 删除网卡：`DELETE /admin/cards/:id`（仅未参与任何结算行项目的网卡可删除）
- 结算草稿：`POST /admin/settlements/recalculate`、`GET /admin/settlements/runs`（支持 `commissionMonth/limit/offset`）、`GET /admin/settlements/runs/:id/items`
  - 删除草稿账单：`DELETE /admin/settlements/runs/:id`（仅 `DRAFT` 可删除）
- 结算执行记录：`GET /admin/settlements/executions`（支持 `commissionMonth/status/triggerType/limit/offset`）
- 结算审核/入账/调整：
  - `POST /admin/settlements/runs/:id/approve`
  - `POST /admin/settlements/runs/:id/unapprove`
  - `POST /admin/settlements/runs/:id/post`
  - `POST /admin/settlements/runs/:id/adjust`
  - `GET /admin/settlements/runs/:id/diff`（调整单前后对比视图）
- 报表：
  - `GET /admin/reports/settlement-items.csv?commissionMonth=YYYY-MM`
  - `GET /admin/reports/settlement-items.xlsx?commissionMonth=YYYY-MM`
  - `GET /admin/reports/bill.csv?commissionMonth=YYYY-MM`（账单格式：卡号/入网日期/套餐/月租/状态/扶持期/稳定期/金额/总计）
  - `GET /admin/reports/bill.xlsx?commissionMonth=YYYY-MM`（同上）
  - `GET /admin/reports/settlement-summary/agents?commissionMonth=YYYY-MM`
  - `GET /admin/reports/settlement-summary/teams?commissionMonth=YYYY-MM`
  - 上述报表支持可选筛选：`beneficiaryAgentId/teamId/levelId/kind/targetKind/periodType/ownerAgentId/cardStatus`
- 分录导出：
  - `GET /admin/ledger/entries.csv`
  - `GET /admin/ledger/entries.xlsx`
  - 支持可选筛选：`commissionMonth/sourceType/settlementRunId/beneficiaryAgentId`
- 公告：`GET/POST/PUT /admin/announcements`
- 审计：
  - `GET /admin/audit-logs`（支持 `entityType/entityId/action/actorUserId` + `limit/offset`）
  - `GET /admin/audit-logs.csv`（支持与列表同口径筛选）
  - `GET /admin/audit-logs.xlsx`（支持与列表同口径筛选）
  - `GET /admin/audit-logs/export-summary`（导出行为统计，支持 `days/actorUserId/action`；action 支持 `REPORT_EXPORT_SETTLEMENT_ITEMS` / `REPORT_EXPORT_BILL_FORMAT` / `LEDGER_EXPORT_ENTRIES` / `AUDIT_EXPORT_LOGS`）

## 运行测试
```bash
npm test
```

全量验证（测试 + 后端类型检查 + 两个前端 build）：
```bash
npm run verify
```

联调冒烟检查（需先启动 backend/admin/agent）：
```bash
npm run smoke:live
```
默认会校验：
- `backend /health`
- `admin-web /login`
- `agent-web /login`
- 管理员登录与 `/auth/me`
- `/admin/audit-logs`、`/admin/reports/settlement-items-preview`、`/admin/ledger/entries`

## 服务器启动（无 Docker，推荐）
适用于后续部署到 Linux 服务器并长期运行。

### 1) 准备环境变量
- 后端：复制 `backend/.env.example` 为 `backend/.env`，至少设置：
  - `JWT_SECRET=<强随机密钥，长度>=16`
  - `TZ=Asia/Shanghai`
  - 生产建议配置 `DATABASE_URL=postgres://...`（不建议生产使用 PGlite）
- 前端：分别复制
  - `admin-web/.env.production.example` -> `admin-web/.env.production`
  - `agent-web/.env.production.example` -> `agent-web/.env.production`
  - 并把 `NEXT_PUBLIC_API_BASE_URL` 改成服务器后端地址（例如 `http://127.0.0.1:3000` 或你的域名 API 地址）

### 2) 首次准备（安装依赖 + 迁移 + 构建）
```bash
npm run server:prepare
```

### 3) 后台启动
```bash
npm run server:start
```

### 4) 状态与健康检查
```bash
npm run server:status
npm run server:health
```

### 5) 停止/重启
```bash
npm run server:stop
npm run server:restart
```

### 6) 开机自启（systemd，推荐）
```bash
sudo tee /etc/systemd/system/ruwang-taocan.service >/dev/null <<'EOF'
[Unit]
Description=Ruwang Taocan Fullstack Service (backend/admin/agent)
After=network.target
Wants=network.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/ruwang-taocan
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run -s server:start
ExecStop=/usr/bin/npm run -s server:stop
ExecReload=/usr/bin/npm run -s server:restart
TimeoutStartSec=900
TimeoutStopSec=120

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable ruwang-taocan.service
sudo systemctl restart ruwang-taocan.service
```

说明：
- 日志目录：`logs/`
- PID 目录：`.run/`
- 该模式使用 `next start` + `backend start`，不依赖 `tsx watch`，比 `dev:all` 更适合服务器常驻。

## 可选：接入真实 Postgres
如果你本机已有 Postgres，可以在 `backend/.env` 里设置：
- `DATABASE_URL=postgres://user:pass@localhost:5432/dbname`

`docker-compose.yml` 仍保留作为参考，但本项目开发不依赖 Docker。

## 生产部署（Docker）
- Backend 镜像：`backend/Dockerfile`
- 生产 compose：`infra/docker-compose.prod.yml`

示例：
```bash
cd infra
JWT_SECRET='replace-with-strong-secret' docker compose -f docker-compose.prod.yml up -d --build
```

说明：
- 容器启动时会自动执行 `npm run migrate`，再启动后端服务。
- 生产建议使用真实 Postgres，禁止使用 PGlite。
- 备份与恢复参考：`docs/runbooks/backup-restore.md`。
