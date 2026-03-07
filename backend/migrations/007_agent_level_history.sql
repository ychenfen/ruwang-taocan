-- Agent level history (as-of settlement month reproducibility)
create table if not exists agent_level_histories (
  id text primary key,
  agent_id text not null references agents(id) on delete cascade,
  level_id text not null references agent_levels(id),
  start_at timestamptz not null default now(),
  end_at timestamptz,
  changed_by text references users(id),
  created_at timestamptz not null default now(),
  check (end_at is null or end_at > start_at)
);

create unique index if not exists uniq_agent_level_histories_active_agent
  on agent_level_histories(agent_id)
  where end_at is null;

create index if not exists idx_agent_level_histories_agent_start
  on agent_level_histories(agent_id, start_at desc);

-- Backfill active history from current agents snapshot.
insert into agent_level_histories (id, agent_id, level_id, start_at, changed_by, created_at)
select
  ('alh-' || a.id) as id,
  a.id as agent_id,
  a.current_level_id as level_id,
  a.created_at as start_at,
  null as changed_by,
  now() as created_at
from agents a
where not exists (
  select 1
  from agent_level_histories h
  where h.agent_id = a.id and h.end_at is null
);
