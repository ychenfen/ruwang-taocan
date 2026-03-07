-- Fix YYYY-MM CHECK constraints to avoid use of \d (not portable across regex engines).

alter table settlement_runs
  drop constraint if exists settlement_runs_run_month_check;

alter table settlement_runs
  drop constraint if exists settlement_runs_commission_month_check;

alter table settlement_items
  drop constraint if exists settlement_items_commission_month_check;

alter table settlement_runs
  add constraint settlement_runs_run_month_check
  check (run_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

alter table settlement_runs
  add constraint settlement_runs_commission_month_check
  check (commission_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

alter table settlement_items
  add constraint settlement_items_commission_month_check
  check (commission_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

