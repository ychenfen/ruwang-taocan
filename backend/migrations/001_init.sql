-- Initial schema (MVP)
--
-- Note on IDs:
-- - IDs are application-generated UUID strings stored as TEXT.
-- - This avoids reliance on pgcrypto/gen_random_uuid and keeps the same schema
--   working on embedded Postgres (PGlite) and real Postgres.

-- Users (admins and agent logins)
create table if not exists users (
  id text primary key,
  username text not null unique,
  password_hash text not null,
  role text not null check (role in ('ADMIN', 'AGENT')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED')),
  created_at timestamptz not null default now()
);

-- Agent levels (星级)
create table if not exists agent_levels (
  id text primary key,
  name text not null unique,
  support_rate numeric(8, 6) not null check (support_rate >= 0),
  stable_rate numeric(8, 6) not null check (stable_rate >= 0),
  stable_months int not null default 0 check (stable_months >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Teams
create table if not exists teams (
  id text primary key,
  name text not null,
  tag text,
  leader_agent_id text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED')),
  created_at timestamptz not null default now()
);

-- Agents (profile + current settings)
create table if not exists agents (
  id text primary key,
  user_id text not null unique references users(id) on delete cascade,
  name text not null,
  phone text,
  employee_no text,
  province text,
  channel text,
  current_level_id text not null references agent_levels(id),
  current_team_id text references teams(id),
  created_at timestamptz not null default now()
);

alter table teams
  add constraint teams_leader_agent_fk
  foreign key (leader_agent_id) references agents(id);

-- Team membership history (agent can have only one active team)
create table if not exists team_memberships (
  id text primary key,
  team_id text not null references teams(id),
  agent_id text not null references agents(id),
  start_at timestamptz not null default now(),
  end_at timestamptz,
  created_by text references users(id),
  created_at timestamptz not null default now(),
  check (end_at is null or end_at > start_at)
);

create unique index if not exists uniq_team_memberships_active_agent
  on team_memberships(agent_id)
  where end_at is null;

create index if not exists idx_team_memberships_team_active
  on team_memberships(team_id)
  where end_at is null;

-- Agent upline relation history (only one active upline for a child)
create table if not exists agent_relations (
  id text primary key,
  agent_id text not null references agents(id),
  upline_agent_id text not null references agents(id),
  start_at timestamptz not null default now(),
  end_at timestamptz,
  created_by text references users(id),
  created_at timestamptz not null default now(),
  check (agent_id <> upline_agent_id),
  check (end_at is null or end_at > start_at)
);

create unique index if not exists uniq_agent_relations_active_child
  on agent_relations(agent_id)
  where end_at is null;

create index if not exists idx_agent_relations_parent_active
  on agent_relations(upline_agent_id)
  where end_at is null;

-- Plans (套餐)
create table if not exists plans (
  id text primary key,
  name text not null unique,
  monthly_rent numeric(10, 2) not null check (monthly_rent >= 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED')),
  created_at timestamptz not null default now()
);

-- Policies (政策) - currently informational, reserved for future rule differences
create table if not exists policies (
  id text primary key,
  name text not null unique,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED')),
  created_at timestamptz not null default now()
);

-- Cards (网卡)
create table if not exists cards (
  id text primary key,
  card_no text not null unique,
  activated_at date not null,
  plan_id text not null references plans(id),
  policy_id text references policies(id),
  created_by text references users(id),
  created_at timestamptz not null default now()
);

-- Card ownership history (only one active owner)
create table if not exists card_assignments (
  id text primary key,
  card_id text not null references cards(id) on delete cascade,
  owner_agent_id text not null references agents(id),
  start_at timestamptz not null default now(),
  end_at timestamptz,
  created_by text references users(id),
  created_at timestamptz not null default now(),
  check (end_at is null or end_at > start_at)
);

create unique index if not exists uniq_card_assignments_active_card
  on card_assignments(card_id)
  where end_at is null;

create index if not exists idx_card_assignments_owner_active
  on card_assignments(owner_agent_id)
  where end_at is null;

-- Card status events (for eligibility: if the card is abnormal at ANY time in the month => 0)
create table if not exists card_status_events (
  id text primary key,
  card_id text not null references cards(id) on delete cascade,
  status text not null check (status in ('NORMAL', 'PAUSED', 'LEFT', 'CONTROLLED', 'ABNORMAL')),
  reason text,
  happened_at timestamptz not null,
  created_by text references users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_card_status_events_card_time
  on card_status_events(card_id, happened_at);

-- Settlement runs (按月结算)
create table if not exists settlement_runs (
  id text primary key,
  run_month text not null,
  commission_month text not null,
  timezone text not null default 'Asia/Shanghai',
  status text not null default 'DRAFT' check (status in ('DRAFT', 'APPROVED', 'POSTED')),
  created_by text references users(id),
  created_at timestamptz not null default now(),
  approved_by text references users(id),
  approved_at timestamptz,
  posted_by text references users(id),
  posted_at timestamptz,
  check (run_month ~ '^\\d{4}-(0[1-9]|1[0-2])$'),
  check (commission_month ~ '^\\d{4}-(0[1-9]|1[0-2])$')
);

create unique index if not exists uniq_settlement_runs_commission_month
  on settlement_runs(commission_month);

-- Settlement line items (行项目)
create table if not exists settlement_items (
  id text primary key,
  settlement_run_id text not null references settlement_runs(id) on delete cascade,
  commission_month text not null,
  card_id text not null references cards(id),
  beneficiary_agent_id text not null references agents(id),
  kind text not null check (kind in ('SELF', 'UPLINE_DIFF_1', 'UPLINE_DIFF_2', 'ADJUSTMENT')),
  period_type text not null check (period_type in ('SUPPORT', 'STABLE')),
  base_monthly_rent numeric(10, 2) not null,
  ratio numeric(8, 6) not null,
  amount numeric(10, 2) not null,
  snapshot jsonb not null default '{}'::jsonb,
  adjustment_of_item_id text references settlement_items(id),
  adjustment_reason text,
  created_at timestamptz not null default now(),
  check (commission_month ~ '^\\d{4}-(0[1-9]|1[0-2])$')
);

create unique index if not exists uniq_settlement_items_non_adjustment
  on settlement_items(settlement_run_id, commission_month, card_id, beneficiary_agent_id, kind)
  where kind <> 'ADJUSTMENT';

create index if not exists idx_settlement_items_beneficiary_month
  on settlement_items(beneficiary_agent_id, commission_month);

create index if not exists idx_settlement_items_card_month
  on settlement_items(card_id, commission_month);
