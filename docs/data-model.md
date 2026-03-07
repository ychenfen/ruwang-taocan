# 数据模型与约束 (草案)

目标：既能支撑后台管理，又能保证“历史可复算、可审计”。

## 1. 设计原则
- 结算结果必须可复算：结算行项目保存“快照字段”，不能只靠当前配置回推。
- 关键关系建议用“有效期”建模：
  - 团队成员、代理上下级、卡归属、卡状态，都可能随时间变化。
- MVP 可以先做“事件表 + 快照”，高级版再做严格的有效期区间。

## 2. 核心表 (建议)

### 2.1 身份与授权
- `users`
  - id, username, password_hash, role (ADMIN/AGENT), status, created_at
- `agents`
  - id, user_id, name, phone, employee_no, province, channel_id, team_id (current), current_level_id, created_at

备注：也可将 agent 作为 user 的扩展资料，RBAC 由 role + scope 决定。

### 2.2 团队
- `teams`
  - id, name, tag, leader_agent_id (nullable), status, created_at
- `team_memberships` (推荐做历史)
  - id, team_id, agent_id, start_at, end_at (nullable), created_by

口径补充：
- 代理同一时间只能归属一个团队：
  - 通过 `team_memberships` 保证同一 agent 只能有一条 end_at is null 的有效记录
- 团队标签/名称允许自定义（创建者或团队队长可编辑）

### 2.3 渠道
- `channels`
  - id, name, company_name, status
- `channel_memberships` (可选)
  - id, channel_id, agent_id, start_at, end_at

### 2.4 代理上下级 (分级)
- `agent_relations` (推荐做历史，且必须防环)
  - id, agent_id (child), upline_agent_id (parent), start_at, end_at

查询需求：
- 查一级/二级下级：基于当前有效关系 (end_at is null)
- 查整棵树：后期可引入 closure table / materialized path

### 2.5 等级与政策版本
- `agent_levels`
  - id, code, name, description, status
- `policies`
  - id, name, status
- `policy_versions`
  - id, policy_id, version_no, effective_from_month, effective_to_month (nullable), created_at
- `policy_level_rates`
  - id, policy_version_id, level_id
  - support_total_months (default 11, all levels same)
  - support_rate (decimal), stable_rate (decimal)
  - stable_months (int, per-level)

口径补充：
- 扶持期固定 11 个月（所有星级一致），激活月为第 1 个月但不计佣；计佣月为第 2..11 月。
- 稳定期有效月份 `stable_months` 在星级管理中可编辑，编辑后立即同步用于后续计算。
  - 但已入账结算禁止被“配置编辑”追溯性改变：历史靠结算明细快照解释。

### 2.6 套餐与网卡
- `plans`
  - id, name, monthly_rent, status
- `cards`
  - id, card_no (unique), activated_at, plan_id, policy_id, status, created_at
- `card_assignments` (推荐做历史)
  - id, card_id, owner_agent_id, start_at, end_at
- `card_status_events` (事件表，保证审计)
  - id, card_id, status, reason, happened_at, created_by

### 2.7 结算与记账
- `settlement_runs`
  - id, run_month, commission_month, timezone
  - status (DRAFT/APPROVED/POSTED)
  - created_by, approved_by, posted_by, created_at, approved_at, posted_at
  - policy_version_ids (json) 或单独关联表
- `settlement_items`
  - id, settlement_run_id
  - commission_month
  - card_id, card_no_snapshot
  - beneficiary_agent_id
  - kind (SELF/UPLINE_DIFF/ADJUSTMENT)
  - base_monthly_rent_snapshot
  - ratio_snapshot, amount
  - snapshots:
    - plan_id_snapshot, plan_name_snapshot
    - policy_version_id_snapshot
    - beneficiary_level_id_snapshot
    - owner_agent_id_snapshot
    - upline_agent_id_snapshot (for diff line)
    - card_status_snapshot
  - adjustment_of_item_id (nullable), adjustment_reason (nullable)

隐私展示（Agent 端）：
- 数据库存完整 `card_no`。
- API 返回给代理时：
  - 仅“自己开的卡”返回完整号
  - 非本人卡号返回脱敏格式（例：`192******16`）

可选：如果你需要“会计式账本”：
- `ledger_entries`
  - id, source_type (SETTLEMENT_RUN/ADJUSTMENT), source_id, entry_date, created_at
- `ledger_entry_lines`
  - id, ledger_entry_id, account_code, debit, credit, agent_id(optional), memo

当前实现（已落地）：
- `ledger_entries`
  - id, source_type (`SETTLEMENT_POST`/`SETTLEMENT_ADJUST`), source_id, settlement_run_id, commission_month, note, created_by, created_at
- `ledger_entry_lines`
  - id, ledger_entry_id, settlement_item_id, beneficiary_agent_id, kind, target_kind, period_type, amount, created_at

## 3. 关键约束与索引 (必须)
- `cards.card_no` 唯一
- `agent_relations` 防环：
  - MVP: 写入时检测 parent 链是否包含 child
  - 后期: closure table + DB 约束/触发器
- `settlement_items` 幂等唯一键（建议）：
  - (commission_month, card_id, beneficiary_agent_id, kind, upline_agent_id_snapshot) 唯一
- `team_memberships` 约束（建议）：
  - agent 同时只能有一个有效 team（Postgres 可用部分唯一索引：`unique (agent_id) where end_at is null`）
- 历史有效期：
  - `start_at < end_at`，同一实体在同一时间只能有一个有效记录（通过业务校验或排他约束实现）

## 4. “快照 vs 有效期”取舍建议
- MVP：
  - 结算时把所有必要字段写入 `settlement_items` 快照，保证可解释。
  - 关系变更用事件表记录，便于追责。
- 强一致版本（后期）：
  - 所有关联都用有效期表，并在结算时按 `commission_month` 取有效记录。
