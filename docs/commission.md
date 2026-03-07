# 佣金结算规则 (口径确认版 v1)

本文件将“确认后的口径”整理成可实现、可测试的算法说明，作为后续开发与验收的依据。

## 0. 结算周期
- 每月 5 号自动执行结算，结算上一个自然月的佣金：
  - run_month = 当月 (YYYY-MM)
  - commission_month = run_month - 1
- 后台支持选择某个代理，对指定 `commission_month` 重新计算并预览：
  - 若该月尚未入账：可覆盖该代理在该月的草稿结算明细。
  - 若该月已入账：必须走“调整单”(反冲 + 补记)，不允许直接改历史结算。

## 1. 月份与名词定义
- 激活月 (activation_month)：网卡激活日期所在自然月 (YYYY-MM)。
- 计佣月 (commission_month)：佣金归属自然月 (YYYY-MM)。
- 结算月 (run_month)：系统执行结算跑批的自然月 (YYYY-MM)。

## 2. 输入数据 (必须可追溯)
每条“卡 x 月”的计算至少需要：
- 卡：卡号、套餐月租、激活日期
- 卡状态：该 `commission_month` 内是否出现过异常状态（见 3.2）
- 归属：该 `commission_month` 的卡归属代理、一级上级、二级上级（最多二级）
- 配置：代理星级、星级对应扶持/稳定比例、稳定期有效月份

结算落库时要写入“快照字段”，保证未来配置变更后仍可解释历史结果。

## 3. 资格与期别判定

### 3.1 起算规则
- 激活月不计佣。
- 从次月开始计佣：
  - `commission_month >= activation_month + 1` 才可能产生佣金行。

### 3.2 状态规则 (当月一票否决)
口径：
- 当月出现卡状态异常，则本月完全不结算佣金，哪怕是最后一天异常了也不结算。

实现建议：
- 使用 `card_status_events` 记录状态变更事件（含发生时间），并保证“建卡时写入一条初始状态事件”。
- 判定规则应覆盖跨月延续的异常状态：
  - 若“月初状态”不是 NORMAL，则该月 `eligible=false`（即使本月没有事件）。
  - 或者本月内任意时刻切换为非 NORMAL，也 `eligible=false`。

等价实现（对某卡）：
1. 取 `commission_month` 月初时刻 `month_start`；
2. 找到 `happened_at <= month_start` 的最新一条状态事件，得到 `status_at_start`（无则按 NORMAL 处理，但建议强制有初始事件）；
3. 若 `status_at_start != NORMAL` => `eligible=false`
4. 若存在 `month_start < happened_at <= month_end` 的任意事件其 `status != NORMAL` => `eligible=false`
5. 否则 `eligible=true`

非正常状态范围（停机/离网/管控/异常等）应做成枚举，并可在后台配置映射。

### 3.3 扶持期/稳定期/结束 (按卡激活月计算)
口径：
- 扶持期总长度固定 11 个月（所有星级一致），从激活月记为第 1 个月开始计算。
- 计佣从第 2 个月开始；因此扶持期内可结算的计佣月份为“第 2 月到第 11 月”
  - 对应自然月：`activation_month + 1` 到 `activation_month + 10`。
- 扶持期结束后进入稳定期。
- 稳定期有效月份由“卡归属代理(本人)星级”配置：`stable_months(level_owner)`。
  - 稳定期到期后，该卡不再结算佣金（比例视为 0）。

定义（方便实现）：
- `m = number_of_months_between(activation_month, commission_month) + 1`
  - m=1 表示激活月
  - m=2 表示激活次月（第一个计佣月）
- periodType：
  - if m < 2 => NONE
  - else if 2 <= m <= 11 => SUPPORT
  - else:
    - `stable_index = m - 11` (1-based，扶持期后第几个月)
    - if `stable_index <= stable_months(level_owner)` => STABLE
    - else => NONE

示例：
- 2026-01 激活：
  - 2026-02..2026-11：扶持期计佣
  - 2026-12 起：进入稳定期（稳定期时长取决于卡归属代理星级配置）

## 4. 金额计算 (截断，不四舍五入)
口径：
- 金额保留小数点后 2 位，2 位后的直接去掉（不四舍五入）。

建议定义函数：
- `trunc2(x) = sign(x) * floor(abs(x) * 100) / 100`

单行公式：
- `base = plan_monthly_rent`
- `amount = trunc2(base * ratio)`

## 5. 代理本人佣金 (Self)
对每张卡在 `commission_month`：
- 若 `eligible=false` 或 `periodType=NONE`：本人佣金为 0（可选择不生成行项目，但要全系统一致）。
- 否则：
  - `ratio_self = rate(level_owner, periodType)`（扶持期用扶持比例，稳定期用稳定比例）
  - `amount_self = trunc2(base * ratio_self)`

## 6. 上级/团队差价佣金 (最多二级)
口径：
- 差价佣金计算到二级代理：
  - A 发展 B，B 发展 C，则 A 可以吃到 C 的差价（在“二级范围内”）。
- 同样星级的返佣比例一样，不存在差价（差额为 0）。

链路定义（卡归属代理为 C）：
- 一级上级：B
- 二级上级：A

名义比例定义：
- 对任意代理 X：`r(X) = rate(level_X, periodType)`；若 `eligible=false` 或 `periodType=NONE`，则 `r(X)=0`。

差价计算（避免重复叠加）：
- 一级差价（给 B）：`diff1 = max(r(B) - r(C), 0)`
- 二级差价（给 A）：`diff2 = max(r(A) - max(r(B), r(C)), 0)`
  - 含义：二级只吃到“比下游最高比例多出来的那一段”，避免重复叠加。

金额：
- `amount_diff1 = trunc2(base * diff1)`
- `amount_diff2 = trunc2(base * diff2)`

## 7. 结算产物 (Settlement output)
结算应生成：
- SettlementRun：run_month、commission_month、状态（DRAFT/APPROVED/POSTED）、操作人、时间等
- SettlementItem（行项目）最少字段：
  - `card_id`, `commission_month`, `beneficiary_agent_id`
  - `kind`: SELF / UPLINE_DIFF_1 / UPLINE_DIFF_2 / ADJUSTMENT
  - `base_monthly_rent_snapshot`, `ratio_snapshot`, `amount`
  - 快照：plan/policy/levels/status/owner/upline 等

幂等唯一约束（建议）：
- (commission_month, card_id, beneficiary_agent_id, kind) 唯一

## 8. 幂等与修正策略
- 同一 `commission_month` 的结算可反复生成草稿；一旦“已入账(POSTED)”，禁止覆盖。
- 修正用 Adjustment：
  - 反冲旧行（负数）+ 写入新行（正数）
  - 保留关联：`adjustment_of_item_id` / `reason` / `operator`

## 9. 已确认口径清单
- 每月 5 号自动结算上月佣金；支持按代理选择重新计算预览。
- 扶持期固定 11 个月（所有星级一致）；扶持期内可结算计佣月份为第 2..11 月（从激活次月起）。
- 稳定期有效月份按卡归属代理星级配置；到期后不再结算。
- 差价佣金最多二级；同星级无差价；二级差价不重复叠加。
- 当月出现任何异常状态事件，则当月完全不结算佣金。
- 金额取小数点后 2 位，2 位后的直接去掉（截断）。
