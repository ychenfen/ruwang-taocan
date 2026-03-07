import type { Db } from "../db.js";

import type {
  Agent,
  AgentLevel,
  Card,
  CardStatus,
  CardStatusEvent,
  SettlementLine,
  YearMonth,
} from "../../../shared/commission-engine/src/index.js";
import { computeSettlementLinesForCard } from "../../../shared/commission-engine/src/index.js";

type DbAgentRow = Readonly<{
  id: string;
  name: string;
  level_id: string;
  level_name: string;
  support_rate: string | number;
  stable_rate: string | number;
  stable_months: number;
}>;

type DbCardRow = Readonly<{
  card_id: string;
  card_no: string;
  activated_at: string | Date; // date column (pg: string, pglite: Date)
  plan_id: string;
  plan_name: string;
  monthly_rent: string | number;
  policy_id: string | null;
  policy_name: string | null;
  owner_agent_id: string;
  owner_agent_name: string;
}>;

type DbStatusEventRow = Readonly<{
  card_id: string;
  status: CardStatus;
  happened_at: string;
}>;

function parseLocalDateYYYYMMDD(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  // Use noon local time to avoid DST boundary surprises.
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function normalizeActivatedAt(v: DbCardRow["activated_at"]): Date {
  if (typeof v === "string") return parseLocalDateYYYYMMDD(v);
  if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate(), 12, 0, 0, 0);
  return new Date(String(v));
}

function latestStatusAtOrBefore(events: readonly CardStatusEvent[], at: Date): CardStatus | null {
  let best: CardStatusEvent | null = null;
  for (const ev of events) {
    if (ev.happenedAt.getTime() <= at.getTime()) {
      if (!best || ev.happenedAt.getTime() >= best.happenedAt.getTime()) best = ev;
    }
  }
  return best?.status ?? null;
}

function monthWindowCst(commissionMonth: YearMonth): Readonly<{ monthStart: Date; monthEnd: Date }> {
  const monthStart = new Date(`${commissionMonth}-01T00:00:00+08:00`);
  const [y, m] = commissionMonth.split("-").map(Number);
  const nextMonthStart = m === 12 ? new Date(`${y + 1}-01-01T00:00:00+08:00`) : new Date(`${y}-${String(m + 1).padStart(2, "0")}-01T00:00:00+08:00`);
  const monthEnd = new Date(nextMonthStart.getTime() - 1);
  return { monthStart, monthEnd };
}

function monthStatusMeta(events: readonly CardStatusEvent[], commissionMonth: YearMonth): Readonly<{
  statusAtMonthStart: CardStatus;
  statusAtMonthEnd: CardStatus;
  hadAbnormalInMonth: boolean;
  eligibleForMonth: boolean;
}> {
  const normal: CardStatus = "NORMAL";
  const { monthStart, monthEnd } = monthWindowCst(commissionMonth);

  const statusAtMonthStart = latestStatusAtOrBefore(events, monthStart) ?? normal;
  const statusAtMonthEnd = latestStatusAtOrBefore(events, monthEnd) ?? statusAtMonthStart;

  const hadAbnormalInMonth = events.some((ev) => {
    const ts = ev.happenedAt.getTime();
    return ts > monthStart.getTime() && ts <= monthEnd.getTime() && ev.status !== normal;
  });

  const eligibleForMonth = statusAtMonthStart === normal && !hadAbnormalInMonth;

  return { statusAtMonthStart, statusAtMonthEnd, hadAbnormalInMonth, eligibleForMonth };
}

export async function computeSettlementLinesFromDb(args: {
  db: Db;
  commissionMonth: YearMonth;
  // If set, only scan cards owned by {agentId + 2-level downlines}.
  agentId?: string;
  // SELF_ONLY: when scoped, keep only beneficiary=agentId lines (used by posted adjustment diffing).
  // RELATED_ALL: when scoped, keep all related lines from scoped cards (SELF + uplines; used by draft recalc).
  scopeMode?: "SELF_ONLY" | "RELATED_ALL";
}): Promise<
  Readonly<{
    scannedCardCount: number;
    producedLineCount: number;
    lines: SettlementLine[];
    cardInfoById: Record<
      string,
      Readonly<{
        cardNo: string;
        activatedAt: Date;
        planId: string;
        planName: string;
        monthlyRent: number;
        policyId: string | null;
        policyName: string | null;
        ownerId: string;
        ownerName: string;
        statusAtMonthStart: CardStatus;
        statusAtMonthEnd: CardStatus;
        hadAbnormalInMonth: boolean;
        eligibleForMonth: boolean;
      }>
    >;
  }>
> {
  const { db, commissionMonth, agentId } = args;
  const scopeMode = args.scopeMode ?? "SELF_ONLY";

  let ownerScopeAgentIds: string[] | null = null;
  if (agentId) {
    // Downlines within 2 levels, strictly by commission month-end snapshot.
    // This preserves reproducibility for historical reruns.
    const lvl1 = await db.query<{ agent_id: string }>(
      `
        with m as (
          select (($1 || '-01T00:00:00+08:00')::timestamptz + interval '1 month' - interval '1 millisecond') as month_end
        )
        select r.agent_id
        from agent_relations r, m
        where r.upline_agent_id = $2
          and r.start_at <= m.month_end
          and (r.end_at is null or r.end_at > m.month_end)
      `,
      [commissionMonth, agentId],
    );
    const lvl1Ids = lvl1.rows.map((x) => x.agent_id);

    let lvl2Ids: string[] = [];
    if (lvl1Ids.length > 0) {
      const placeholders = lvl1Ids.map((_, i) => `$${i + 2}`).join(", ");
      const lvl2 = await db.query<{ agent_id: string }>(
        `
          with m as (
            select (($1 || '-01T00:00:00+08:00')::timestamptz + interval '1 month' - interval '1 millisecond') as month_end
          )
          select r.agent_id
          from agent_relations r, m
          where r.upline_agent_id in (${placeholders})
            and r.start_at <= m.month_end
            and (r.end_at is null or r.end_at > m.month_end)
        `,
        [commissionMonth, ...lvl1Ids],
      );
      lvl2Ids = lvl2.rows.map((x) => x.agent_id);
    }

    ownerScopeAgentIds = Array.from(new Set([agentId, ...lvl1Ids, ...lvl2Ids]));
  }

  // Load cards owned by scope at month end (or all cards if not scoped).
  const cards: DbCardRow[] = await (async () => {
    if (ownerScopeAgentIds && ownerScopeAgentIds.length === 0) return [];
    const params: any[] = [commissionMonth];
    let scopeClause = "";
    if (ownerScopeAgentIds) {
      const placeholders = ownerScopeAgentIds.map((_, i) => `$${i + 2}`).join(", ");
      params.push(...ownerScopeAgentIds);
      scopeClause = `and ca.owner_agent_id in (${placeholders})`;
    }

    const r = await db.query<DbCardRow>(
      `
        with m as (
          select (($1 || '-01T00:00:00+08:00')::timestamptz + interval '1 month' - interval '1 millisecond') as month_end
        )
        select
          c.id as card_id,
          c.card_no,
          c.activated_at,
          c.plan_id,
          p.name as plan_name,
          p.monthly_rent,
          c.policy_id,
          pol.name as policy_name,
          ca.owner_agent_id,
          a.name as owner_agent_name
        from cards c
        join plans p on p.id = c.plan_id
        left join policies pol on pol.id = c.policy_id
        join card_assignments ca on ca.card_id = c.id
        join agents a on a.id = ca.owner_agent_id
        join m on true
        where ca.start_at <= m.month_end
          and (ca.end_at is null or ca.end_at > m.month_end)
          ${scopeClause}
        order by c.created_at asc
      `,
      params,
    );
    return r.rows;
  })();

  const scannedCardCount = cards.length;
  if (cards.length === 0) return { scannedCardCount, producedLineCount: 0, lines: [], cardInfoById: {} };

  // Load relations at commission month end (historical snapshot).
  const relAtMonthEnd = await db.query<{ agent_id: string; upline_agent_id: string }>(
    `
      with m as (
        select (($1 || '-01T00:00:00+08:00')::timestamptz + interval '1 month' - interval '1 millisecond') as month_end
      )
      select r.agent_id, r.upline_agent_id
      from agent_relations r, m
      where r.start_at <= m.month_end
        and (r.end_at is null or r.end_at > m.month_end)
    `,
    [commissionMonth],
  );
  const uplineOfMonthEnd: Record<string, string> = {};
  for (const row of relAtMonthEnd.rows) uplineOfMonthEnd[row.agent_id] = row.upline_agent_id;

  const resolveUpline = (childAgentId: string): string | undefined => {
    return uplineOfMonthEnd[childAgentId];
  };

  // Determine agents needed: owners + their upline1/upline2.
  const agentIds = new Set<string>();
  for (const c of cards) {
    agentIds.add(c.owner_agent_id);
    const u1 = resolveUpline(c.owner_agent_id);
    if (u1) agentIds.add(u1);
    const u2 = u1 ? resolveUpline(u1) : undefined;
    if (u2) agentIds.add(u2);
  }

  const agentIdList = Array.from(agentIds);
  const agentPlaceholders = agentIdList.map((_, i) => `$${i + 1}`).join(", ");
  const agentRows = await db.query<DbAgentRow>(
    `
      select
        a.id,
        a.name,
        a.current_level_id as level_id,
        al.name as level_name,
        al.support_rate,
        al.stable_rate,
        al.stable_months
      from agents a
      join agent_levels al on al.id = a.current_level_id
      where a.id in (${agentPlaceholders})
    `,
    agentIdList,
  );

  const baseAgents: Record<string, { id: string; name: string; level: AgentLevel }> = {};
  for (const r of agentRows.rows) {
    baseAgents[r.id] = {
      id: r.id,
      name: r.name,
      level: {
        id: r.level_id,
        name: r.level_name,
        supportRate: Number(r.support_rate),
        stableRate: Number(r.stable_rate),
        stableMonths: r.stable_months,
      },
    };
  }

  // Load status events up to month end for scanned cards.
  const cardIds = cards.map((c) => c.card_id);
  const cardPlaceholders = cardIds.map((_, i) => `$${i + 2}`).join(", ");
  const evRows = await db.query<DbStatusEventRow>(
    `
      with m as (
        select (($1 || '-01T00:00:00+08:00')::timestamptz + interval '1 month' - interval '1 millisecond') as month_end
      )
      select e.card_id, e.status, e.happened_at
      from card_status_events e
      join m on true
      where e.card_id in (${cardPlaceholders})
        and e.happened_at <= m.month_end
      order by e.happened_at asc, e.created_at asc, e.id asc
    `,
    [commissionMonth, ...cardIds],
  );
  const evByCard: Record<string, CardStatusEvent[]> = {};
  for (const e of evRows.rows) {
    (evByCard[e.card_id] ??= []).push({ status: e.status, happenedAt: new Date(e.happened_at) });
  }

  const cardInfoById: Record<
    string,
    Readonly<{
      cardNo: string;
      activatedAt: Date;
      planId: string;
      planName: string;
      monthlyRent: number;
      policyId: string | null;
      policyName: string | null;
      ownerId: string;
      ownerName: string;
      statusAtMonthStart: CardStatus;
      statusAtMonthEnd: CardStatus;
      hadAbnormalInMonth: boolean;
      eligibleForMonth: boolean;
    }>
  > = {};
  for (const c of cards) {
    const events = evByCard[c.card_id] ?? [];
    const monthMeta = monthStatusMeta(events, commissionMonth);
    cardInfoById[c.card_id] = {
      cardNo: c.card_no,
      activatedAt: normalizeActivatedAt(c.activated_at),
      planId: c.plan_id,
      planName: c.plan_name,
      monthlyRent: Number(c.monthly_rent),
      policyId: c.policy_id,
      policyName: c.policy_name,
      ownerId: c.owner_agent_id,
      ownerName: c.owner_agent_name,
      statusAtMonthStart: monthMeta.statusAtMonthStart,
      statusAtMonthEnd: monthMeta.statusAtMonthEnd,
      hadAbnormalInMonth: monthMeta.hadAbnormalInMonth,
      eligibleForMonth: monthMeta.eligibleForMonth,
    };
  }

  const lines: SettlementLine[] = [];
  for (const c of cards) {
    const baseOwner = baseAgents[c.owner_agent_id];
    if (!baseOwner) continue;
    const u1Id = resolveUpline(c.owner_agent_id);
    const u2Id = u1Id ? resolveUpline(u1Id) : undefined;

    const owner: Agent = {
      ...baseOwner,
      upline1: u1Id ? ({ ...baseAgents[u1Id] } as Agent) : null,
      upline2: u2Id ? ({ ...baseAgents[u2Id] } as Agent) : null,
    };

    const info = cardInfoById[c.card_id]!;
    const card: Card = {
      id: c.card_id,
      cardNo: info.cardNo,
      activatedAt: info.activatedAt,
      planMonthlyRent: info.monthlyRent,
      owner,
      statusEvents: evByCard[c.card_id] ?? [],
    };

    const produced = computeSettlementLinesForCard(card, commissionMonth);
    if (!agentId || scopeMode === "RELATED_ALL") {
      lines.push(...produced);
    } else {
      lines.push(...produced.filter((l) => l.beneficiaryAgentId === agentId));
    }
  }

  return { scannedCardCount, producedLineCount: lines.length, lines, cardInfoById };
}
