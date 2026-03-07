# 服务器启动 Runbook（无 Docker）

适用场景：在 Linux 服务器上直接运行本项目（backend + admin-web + agent-web）。

## 1. 前置条件
- Node.js 22.x（推荐 `v22.17.0`）
- 可用的 npm（支持 workspaces）
- 建议使用 PostgreSQL（生产不建议使用 PGlite）

## 2. 环境变量
### 2.1 Backend
复制并编辑：
```bash
cp backend/.env.example backend/.env
```

至少配置：
- `JWT_SECRET=<长度>=16 的强随机密钥`
- `TZ=Asia/Shanghai`

生产建议：
- `DATABASE_URL=postgres://user:pass@host:5432/dbname`

### 2.2 Frontend
复制并编辑：
```bash
cp admin-web/.env.production.example admin-web/.env.production
cp agent-web/.env.production.example agent-web/.env.production
```

设置：
- `NEXT_PUBLIC_API_BASE_URL=http://<backend-host>:3000`

## 3. 首次部署
在仓库根目录执行：
```bash
npm run server:prepare
```

这一步会执行：
- `npm ci`
- `npm run migrate`
- `npm run seed`（幂等，不会重复创建已有 admin）
- `npm run build:all`

## 4. 启停与检查
启动：
```bash
npm run server:start
```

状态：
```bash
npm run server:status
```

健康检查：
```bash
npm run server:health
```

停止：
```bash
npm run server:stop
```

重启：
```bash
npm run server:restart
```

## 5. systemd 开机自启（推荐）
创建服务文件：
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
```

启用并立即生效：
```bash
sudo systemctl daemon-reload
sudo systemctl enable ruwang-taocan.service
sudo systemctl restart ruwang-taocan.service
sudo systemctl status ruwang-taocan.service
```

常用管理：
```bash
sudo systemctl restart ruwang-taocan.service
sudo systemctl stop ruwang-taocan.service
sudo systemctl start ruwang-taocan.service
```

## 6. 日志与 PID
- 日志：`logs/backend.log`, `logs/admin.log`, `logs/agent.log`
- PID：`.run/backend.pid`, `.run/admin.pid`, `.run/agent.pid`

## 7. 常见问题
- `JWT_SECRET is required`：未在环境变量或 `backend/.env` 设置密钥。
- 前端无法访问后端：检查两个 `*.env.production` 的 `NEXT_PUBLIC_API_BASE_URL` 是否正确，并重新 `npm run build:all`。
- 迁移失败：优先检查 `DATABASE_URL` 连通性和数据库权限。
- 外网打不开 `3000/3001/3002`：放行服务器防火墙（如 UFW）和云安全组入站规则。
