-- Settlement execution logs (manual + scheduled) for run observability.
-- Goal: keep a durable history of duration, line counts, and failure reasons.

create table if not exists settlement_execution_logs (
  id text primary key,
  trigger_type text not null check (trigger_type in ('MANUAL', 'AUTO')),
  status text not null check (status in ('SUCCEEDED', 'FAILED')),
  commission_month text not null check (commission_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  timezone text not null default 'Asia/Shanghai',
  settlement_run_id text references settlement_runs(id),
  actor_user_id text references users(id),
  target_agent_id text references agents(id),
  scanned_card_count int not null default 0 check (scanned_card_count >= 0),
  produced_line_count int not null default 0 check (produced_line_count >= 0),
  inserted_count int not null default 0 check (inserted_count >= 0),
  deleted_count int not null default 0 check (deleted_count >= 0),
  error_code text,
  error_message text,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_ms int not null check (duration_ms >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_settlement_execution_logs_started
  on settlement_execution_logs(started_at desc);

create index if not exists idx_settlement_execution_logs_month
  on settlement_execution_logs(commission_month, started_at desc);

create index if not exists idx_settlement_execution_logs_status
  on settlement_execution_logs(status, started_at desc);

create index if not exists idx_settlement_execution_logs_trigger
  on settlement_execution_logs(trigger_type, started_at desc);

