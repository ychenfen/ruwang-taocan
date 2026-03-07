# 结算引擎设计 (伪代码 + 测试清单)

本文件描述“按月结算”的核心实现思路，目标是：可复算、幂等、可审计。

## 1. 运行时概念
- 输入：
  - `run_month`：本次跑批月份（YYYY-MM），每月 5 号自动触发
  - `commission_month = run_month - 1`
  - 可选 `agent_id`：只重算某个代理（管理员手动触发）
- 输出：
  - `settlement_run`（草稿/已审核/已入账）
  - `settlement_items`（行项目：SELF/UPLINE_DIFF_1/UPLINE_DIFF_2/ADJUSTMENT）

## 2. 关键函数
### 2.1 trunc2
```text
trunc2(x):
  return sign(x) * floor(abs(x) * 100) / 100
```

### 2.2 month arithmetic
```text
add_months("2026-01", 1) => "2026-02"
month_diff("2026-01", "2026-01") => 0
month_diff("2026-01", "2026-02") => 1
```

## 3. 期别与资格判定
已确认口径：
- 激活月不计佣，次月起算。
- 扶持期固定 11 个月（从激活月算第 1 个月），可结算扶持期佣金的月份为第 2..11 月。
- 稳定期有效月份由“卡归属代理星级”配置；到期后不再结算。
- 当月出现任何异常状态事件，本月完全不结算佣金。

### 3.1 periodType(card, commission_month, owner_level)
```text
periodType:
  activation_month = month(card.activated_at)
  if commission_month < add_months(activation_month, 1):
    return NONE

  m = month_diff(activation_month, commission_month) + 1
  # m=1 activation month; m=2 first commission month
  if 2 <= m <= 11:
    return SUPPORT

  stable_index = m - 11  # 1-based
  if stable_index <= stable_months(owner_level):
    return STABLE
  return NONE
```

### 3.2 eligible(card, commission_month)
```text
eligible:
  month_start = start_of_month(commission_month)
  month_end = end_of_month(commission_month)

  status_at_start = latest_event_status(card, happened_at <= month_start) default NORMAL
  if status_at_start != NORMAL:
    return false

  if exists status_event where month_start < happened_at <= month_end and status != NORMAL:
    return false

  return true
```

## 4. 比例函数
```text
rate(level, periodType):
  if periodType == SUPPORT: return level.support_rate
  if periodType == STABLE:  return level.stable_rate
  return 0
```

注意：level 的 stable_months/support_rate/stable_rate 来自结算月对应的“配置版本快照/版本号”。

## 5. 差价佣金 (最多二级，且不重叠)
对某张卡，归属代理为 C，一级上级 B，二级上级 A：
```text
rC = rate(levelC, periodType)
rB = rate(levelB, periodType)
rA = rate(levelA, periodType)

diff1 = max(rB - rC, 0)  # pays to B
diff2 = max(rA - max(rB, rC), 0)  # pays to A, no overlap
```

若不存在上级，则对应 diff=0。

## 6. 结算主流程 (伪代码)
```text
runSettlement(run_month, agent_id?):
  commission_month = run_month - 1

  assert run_month is today_month when scheduled (5th), but allow manual override

  # 1) Create or load settlement_run (DRAFT)
  run = upsert_settlement_run(run_month, commission_month, scope=agent_id?)

  # 2) Determine card set
  # Confirmed product intent: "recalculate for agent" should show that agent's full earnings preview.
  # Therefore scope=agent_id means: recompute all settlement items where beneficiary == agent,
  # which are driven by cards owned by {agent} union {direct downline} union {2nd downline}.
  cards = list_cards_for_beneficiary(agent_id, commission_month)

  for card in cards:
    base = card.plan.monthly_rent
    owner = owner_of_card_in_month(card, commission_month)
    B = upline1(owner, commission_month)
    A = upline2(owner, commission_month)

    e = eligible(card, commission_month)
    period = periodType(card, commission_month, owner.level_in_month)

    if not e or period == NONE:
      continue (or write zero lines consistently)

    rC = rate(owner.level, period)
    amountC = trunc2(base * rC)
    upsert_item(run, card, commission_month, beneficiary=owner, kind=SELF, ratio=rC, amount=amountC, snapshots=...)

    if B exists:
      rB = rate(B.level, period)
      diff1 = max(rB - rC, 0)
      if diff1 > 0:
        amountB = trunc2(base * diff1)
        upsert_item(run, card, commission_month, beneficiary=B, kind=UPLINE_DIFF_1, ratio=diff1, amount=amountB, snapshots=...)

    if A exists:
      rA = rate(A.level, period)
      rB0 = rate(B.level, period) if B exists else 0
      diff2 = max(rA - max(rB0, rC), 0)
      if diff2 > 0:
        amountA = trunc2(base * diff2)
        upsert_item(run, card, commission_month, beneficiary=A, kind=UPLINE_DIFF_2, ratio=diff2, amount=amountA, snapshots=...)

  return run
```

幂等策略：
- `upsert_item` 以 (commission_month, card_id, beneficiary_agent_id, kind) 为唯一键更新/插入（仅限 DRAFT）。
- 对 POSTED run 禁止覆盖：若手动重算，需要生成 ADJUSTMENT（负行反冲 + 正行补记）。

## 7. 测试用例清单 (必须覆盖)

### 7.1 月份与期别
- 激活月不计佣；次月开始计佣。
- 激活 2026-01：
  - 2026-02..2026-11 为 SUPPORT
  - 2026-12 起进入 STABLE，且稳定期到期后 period=NONE

### 7.2 状态一票否决
- commission_month 任意一天出现非 NORMAL 事件 => 当月所有行项目都不生成/金额为 0（按实现选择一致口径）。
- 最后一天异常也不结算（边界）。

### 7.3 差价到二级且不重叠
- rA > rB > rC：B 收 (rB-rC)，A 收 (rA-rB)
- rA > rC > rB：B 收 0，A 收 (rA-rC)
- rA == rB == rC：全部差价为 0

### 7.4 截断规则
- base=29, ratio=0.033333 => amount=0.96 (29*0.033333=0.966657 截断)
- 负数调整行的截断行为一致（例如 -0.969 => -0.96）

### 7.5 幂等
- 同一 run 重复执行，行项目数量不变、金额不变。
- DRAFT 可覆盖更新；POSTED 走调整单而非覆盖。

## 8. 管理后台“按代理重算”口径 (已定)
- 重算范围：覆盖该代理在该月作为收益人的所有行项目（SELF + DIFF_1 + DIFF_2）。
- 需要扫描的卡范围：该代理本人名下卡 + 一级下级名下卡 + 二级下级名下卡（用于差价来源）。
- 不重算其他代理的结算行（避免影响全局草稿）；全量修正通过“全量重跑”或该代理多次重算实现。
