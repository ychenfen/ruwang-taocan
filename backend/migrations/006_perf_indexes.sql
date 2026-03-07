-- Performance indexes for settlement + reporting hotspots.
-- Safe to apply repeatedly via IF NOT EXISTS.

create index if not exists idx_card_assignments_card_period
  on card_assignments(card_id, start_at, end_at);

create index if not exists idx_card_assignments_owner_period
  on card_assignments(owner_agent_id, start_at, end_at);

create index if not exists idx_agent_relations_upline_period
  on agent_relations(upline_agent_id, start_at, end_at);

create index if not exists idx_agent_relations_agent_period
  on agent_relations(agent_id, start_at, end_at);

create index if not exists idx_team_memberships_agent_period
  on team_memberships(agent_id, start_at, end_at);

create index if not exists idx_team_memberships_team_period
  on team_memberships(team_id, start_at, end_at);

create index if not exists idx_settlement_runs_created_at
  on settlement_runs(created_at desc);

create index if not exists idx_settlement_items_run_created
  on settlement_items(settlement_run_id, created_at);

create index if not exists idx_settlement_items_run_kind_beneficiary
  on settlement_items(settlement_run_id, kind, beneficiary_agent_id);

create index if not exists idx_settlement_items_adjustment_of
  on settlement_items(adjustment_of_item_id)
  where adjustment_of_item_id is not null;

create index if not exists idx_settlement_items_run_beneficiary_non_adjust
  on settlement_items(settlement_run_id, beneficiary_agent_id)
  where kind <> 'ADJUSTMENT';
