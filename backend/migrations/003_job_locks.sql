-- Simple DB-based locks for jobs and long-running operations.
-- Works on both real Postgres and embedded Postgres (PGlite).

create table if not exists job_locks (
  name text primary key,
  locked_until timestamptz not null,
  locked_by text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_job_locks_until
  on job_locks(locked_until);

