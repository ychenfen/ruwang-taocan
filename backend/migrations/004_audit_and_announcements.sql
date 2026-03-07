-- Audit logs + announcements
-- Keep schema compatible with real Postgres and embedded Postgres (PGlite).

create table if not exists audit_logs (
  id text primary key,
  actor_user_id text references users(id),
  actor_role text not null check (actor_role in ('ADMIN', 'AGENT', 'SYSTEM')),
  action text not null,
  entity_type text not null,
  entity_id text,
  before_json jsonb,
  after_json jsonb,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_created_at
  on audit_logs(created_at desc);

create index if not exists idx_audit_logs_entity
  on audit_logs(entity_type, entity_id);

create index if not exists idx_audit_logs_actor
  on audit_logs(actor_user_id, created_at desc);

create index if not exists idx_audit_logs_action
  on audit_logs(action, created_at desc);

create table if not exists announcements (
  id text primary key,
  title text not null,
  body text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by text references users(id),
  created_at timestamptz not null default now(),
  updated_by text references users(id),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create index if not exists idx_announcements_status_time
  on announcements(status, starts_at desc);

