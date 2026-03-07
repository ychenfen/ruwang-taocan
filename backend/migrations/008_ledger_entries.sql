-- Ledger entries/lines for posted settlements and adjustments.
-- Purpose: auditable accounting trail without mutating posted settlement data.

create table if not exists ledger_entries (
  id text primary key,
  source_type text not null check (source_type in ('SETTLEMENT_POST', 'SETTLEMENT_ADJUST')),
  source_id text not null,
  settlement_run_id text not null references settlement_runs(id) on delete cascade,
  commission_month text not null check (commission_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  note text,
  created_by text references users(id),
  created_at timestamptz not null default now()
);

create unique index if not exists uniq_ledger_entries_source
  on ledger_entries(source_type, source_id);

create index if not exists idx_ledger_entries_run_created
  on ledger_entries(settlement_run_id, created_at desc);

create index if not exists idx_ledger_entries_month_created
  on ledger_entries(commission_month, created_at desc);

create table if not exists ledger_entry_lines (
  id text primary key,
  ledger_entry_id text not null references ledger_entries(id) on delete cascade,
  settlement_item_id text not null references settlement_items(id) on delete restrict,
  beneficiary_agent_id text not null references agents(id),
  kind text not null check (kind in ('SELF', 'UPLINE_DIFF_1', 'UPLINE_DIFF_2', 'ADJUSTMENT')),
  target_kind text not null check (target_kind in ('SELF', 'UPLINE_DIFF_1', 'UPLINE_DIFF_2')),
  period_type text not null check (period_type in ('SUPPORT', 'STABLE')),
  amount numeric(10, 2) not null,
  created_at timestamptz not null default now()
);

create unique index if not exists uniq_ledger_entry_lines_entry_item
  on ledger_entry_lines(ledger_entry_id, settlement_item_id);

create index if not exists idx_ledger_entry_lines_entry
  on ledger_entry_lines(ledger_entry_id, created_at);

create index if not exists idx_ledger_entry_lines_beneficiary
  on ledger_entry_lines(beneficiary_agent_id, created_at desc);
