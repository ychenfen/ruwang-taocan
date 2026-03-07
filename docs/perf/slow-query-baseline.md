# 慢查询基线（EXPLAIN ANALYZE）

- 生成时间：2026-02-15T04:35:15.369Z
- 数据库类型：pglite
- 结算月：2026-02
- 代理范围样本：(无代理样本，使用空值)

## 概览（按执行耗时降序）

| Query | Execution Time (ms) | 描述 |
|---|---:|---|
| report_agent_summary | 1.377 | 报表聚合：按代理汇总结算金额并关联当月团队。 |
| settlement_cards_scan | 0.784 | 结算计算：按月末生效归属扫描卡池（owner scope 可选）。 |
| adjust_base_items_scope | 0.097 | 调整单生成：读取指定结算单非调整类行项目（可按代理过滤）。 |
| settlement_relations_l1 | 0.052 | 结算计算：查某代理一级下级（按月末有效关系）。 |

## report_agent_summary

报表聚合：按代理汇总结算金额并关联当月团队。

```sql
with m as (
  select (($1 || '-01T00:00:00+08:00')::timestamptz + interval '1 month' - interval '1 millisecond') as month_end
)
select si.beneficiary_agent_id, count(*) as line_count, sum(si.amount) as total_amount
from settlement_runs sr
join settlement_items si on si.settlement_run_id = sr.id
join agents a on a.id = si.beneficiary_agent_id
join m on true
left join team_memberships tm on tm.agent_id = a.id and tm.start_at <= m.month_end and (tm.end_at is null or tm.end_at > m.month_end)
where sr.commission_month = $1
group by si.beneficiary_agent_id
order by sum(si.amount) desc
```

参数：["2026-02"]

```text
Sort  (cost=17.14..17.15 rows=1 width=72) (actual time=0.809..0.813 rows=0 loops=1)
  Sort Key: (sum(si.amount)) DESC
  Sort Method: quicksort  Memory: 17kB
  ->  GroupAggregate  (cost=17.11..17.13 rows=1 width=72) (actual time=0.682..0.686 rows=0 loops=1)
        Group Key: si.beneficiary_agent_id
        ->  Sort  (cost=17.11..17.11 rows=1 width=48) (actual time=0.364..0.368 rows=0 loops=1)
              Sort Key: si.beneficiary_agent_id
              Sort Method: quicksort  Memory: 17kB
              ->  Nested Loop Left Join  (cost=0.59..17.10 rows=1 width=48) (actual time=0.008..0.012 rows=0 loops=1)
                    ->  Nested Loop  (cost=0.44..16.72 rows=1 width=80) (actual time=0.007..0.010 rows=0 loops=1)
                          ->  Nested Loop  (cost=0.29..16.34 rows=1 width=48) (actual time=0.006..0.009 rows=0 loops=1)
                                ->  Index Scan using uniq_settlement_runs_commission_month on settlement_runs sr  (cost=0.15..8.17 rows=1 width=32) (actual time=0.006..0.006 rows=0 loops=1)
                                      Index Cond: (commission_month = '2026-02'::text)
                                ->  Index Scan using idx_settlement_items_run_kind_beneficiary on settlement_items si  (cost=0.14..8.16 rows=1 width=80) (never executed)
                                      Index Cond: (settlement_run_id = sr.id)
                          ->  Index Only Scan using agents_pkey on agents a  (cost=0.14..0.38 rows=1 width=32) (never executed)
                                Index Cond: (id = si.beneficiary_agent_id)
                                Heap Fetches: 0
                    ->  Index Only Scan using idx_team_memberships_agent_period on team_memberships tm  (cost=0.16..0.37 rows=1 width=32) (never executed)
                          Index Cond: ((agent_id = a.id) AND (start_at <= ((('2026-02-01T00:00:00+08:00'::cstring)::timestamp with time zone + '1 mon'::interval) - '00:00:00.001'::interval)))
                          Filter: ((end_at IS NULL) OR (end_at > ((('2026-02-01T00:00:00+08:00'::cstring)::timestamp with time zone + '1 mon'::interval) - '00:00:00.001'::interval)))
                          Heap Fetches: 0
Planning Time: 4275.795 ms
Execution Time: 1.377 ms
```

## settlement_cards_scan

结算计算：按月末生效归属扫描卡池（owner scope 可选）。

```sql
with m as (
  select (($1 || '-01T00:00:00+08:00')::timestamptz + interval '1 month' - interval '1 millisecond') as month_end
)
select c.id, ca.owner_agent_id
from cards c
join card_assignments ca on ca.card_id = c.id
join m on true
where ca.start_at <= m.month_end
  and (ca.end_at is null or ca.end_at > m.month_end)
order by c.created_at asc
```

参数：["2026-02"]

```text
Sort  (cost=76.46..76.59 rows=50 width=72) (actual time=0.662..0.664 rows=0 loops=1)
  Sort Key: c.created_at
  Sort Method: quicksort  Memory: 17kB
  ->  Nested Loop  (cost=7.69..75.05 rows=50 width=72) (actual time=0.649..0.651 rows=0 loops=1)
        ->  Bitmap Heap Scan on card_assignments ca  (cost=7.54..22.80 rows=50 width=64) (actual time=0.572..0.573 rows=0 loops=1)
              Recheck Cond: (start_at <= ((('2026-02-01T00:00:00+08:00'::cstring)::timestamp with time zone + '1 mon'::interval) - '00:00:00.001'::interval))
              Filter: ((end_at IS NULL) OR (end_at > ((('2026-02-01T00:00:00+08:00'::cstring)::timestamp with time zone + '1 mon'::interval) - '00:00:00.001'::interval)))
              ->  Bitmap Index Scan on idx_card_assignments_owner_period  (cost=0.00..7.53 rows=150 width=0) (actual time=0.419..0.420 rows=0 loops=1)
                    Index Cond: (start_at <= ((('2026-02-01T00:00:00+08:00'::cstring)::timestamp with time zone + '1 mon'::interval) - '00:00:00.001'::interval))
        ->  Index Scan using cards_pkey on cards c  (cost=0.15..1.05 rows=1 width=40) (never executed)
              Index Cond: (id = ca.card_id)
Planning Time: 7.870 ms
Execution Time: 0.784 ms
```

## adjust_base_items_scope

调整单生成：读取指定结算单非调整类行项目（可按代理过滤）。

```sql
select id, card_id, beneficiary_agent_id, kind, amount
from settlement_items
where settlement_run_id = (select id from settlement_runs where commission_month = $1 limit 1)
  and kind <> 'ADJUSTMENT'
  and ($2 = '' or beneficiary_agent_id = $2)
```

参数：["2026-02",""]

```text
Index Scan using idx_settlement_items_run_beneficiary_non_adjust on settlement_items  (cost=8.29..16.31 rows=1 width=144) (actual time=0.042..0.043 rows=0 loops=1)
  Index Cond: (settlement_run_id = (InitPlan 1).col1)
  InitPlan 1
    ->  Limit  (cost=0.15..8.17 rows=1 width=32) (actual time=0.005..0.006 rows=0 loops=1)
          ->  Index Scan using uniq_settlement_runs_commission_month on settlement_runs  (cost=0.15..8.17 rows=1 width=32) (actual time=0.002..0.002 rows=0 loops=1)
                Index Cond: (commission_month = '2026-02'::text)
Planning Time: 0.745 ms
Execution Time: 0.097 ms
```

## settlement_relations_l1

结算计算：查某代理一级下级（按月末有效关系）。

```sql
with m as (
  select (($1 || '-01T00:00:00+08:00')::timestamptz + interval '1 month' - interval '1 millisecond') as month_end
)
select r.agent_id
from agent_relations r, m
where r.upline_agent_id = $2
  and r.start_at <= m.month_end
  and (r.end_at is null or r.end_at > m.month_end)
```

参数：["2026-02",""]

```text
Index Scan using idx_agent_relations_upline_period on agent_relations r  (cost=0.16..8.19 rows=1 width=32) (actual time=0.036..0.036 rows=0 loops=1)
  Index Cond: ((upline_agent_id = ''::text) AND (start_at <= ((('2026-02-01T00:00:00+08:00'::cstring)::timestamp with time zone + '1 mon'::interval) - '00:00:00.001'::interval)))
  Filter: ((end_at IS NULL) OR (end_at > ((('2026-02-01T00:00:00+08:00'::cstring)::timestamp with time zone + '1 mon'::interval) - '00:00:00.001'::interval)))
Planning Time: 1.303 ms
Execution Time: 0.052 ms
```
