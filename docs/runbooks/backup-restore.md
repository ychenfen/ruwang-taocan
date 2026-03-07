# 备份与恢复 Runbook（PostgreSQL）

适用范围：生产部署使用 `infra/docker-compose.prod.yml` 的 PostgreSQL。

## 1. 备份

### 1.1 逻辑备份（推荐，按日）
在宿主机执行：

```bash
export PGPASSWORD='你的数据库密码'
pg_dump \
  -h 127.0.0.1 \
  -p 5432 \
  -U ruwang \
  -d ruwang \
  -Fc \
  -f ./backup/ruwang_$(date +%F_%H%M%S).dump
```

说明：
- `-Fc` 为自定义格式，支持按对象恢复与压缩。
- 建议同时保留最近 7~30 天备份，并同步到异地对象存储。

### 1.2 结构备份（DDL）
```bash
export PGPASSWORD='你的数据库密码'
pg_dump \
  -h 127.0.0.1 \
  -p 5432 \
  -U ruwang \
  -d ruwang \
  --schema-only \
  -f ./backup/ruwang_schema_$(date +%F_%H%M%S).sql
```

## 2. 恢复

## 2.1 新库恢复（推荐）
1. 创建新数据库（例如 `ruwang_restore`）  
2. 执行：

```bash
export PGPASSWORD='你的数据库密码'
pg_restore \
  -h 127.0.0.1 \
  -p 5432 \
  -U ruwang \
  -d ruwang_restore \
  --clean \
  --if-exists \
  ./backup/ruwang_xxx.dump
```

3. 验证核心表行数：
```sql
select count(*) from settlement_runs;
select count(*) from settlement_items;
select count(*) from audit_logs;
```

## 2.2 覆盖恢复（高风险）
仅在明确停机窗口下执行，且必须先确认有可回滚备份。

## 3. 恢复后校验清单
- `GET /health` 返回 `{"ok":true}`
- `GET /health/db` 返回 `{"ok":true}`
- 最近一个月结算单可查询：`GET /admin/settlements/runs?commissionMonth=YYYY-MM`
- 审计日志可查询：`GET /admin/audit-logs`

## 4. 常见故障
- `role does not exist`：恢复时使用了错误用户名，检查 `-U` 与目标实例角色。
- `database ... does not exist`：先创建目标库，再执行 `pg_restore`。
- `permission denied`：确保执行账户对目标库有 `CREATE/ALTER/DROP` 权限。

