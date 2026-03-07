import { addMonths, endOfMonth, monthDiff, startOfMonth, toYearMonth } from "./month.js";
import { trunc2 } from "./money.js";
import type {
  Agent,
  Card,
  CardStatus,
  CardStatusEvent,
  PeriodType,
  SettlementKind,
  SettlementLine,
  YearMonth,
} from "./types.js";

const SUPPORT_TOTAL_MONTHS = 11;

function rate(agent: Agent, periodType: PeriodType): number {
  return periodType === "SUPPORT" ? agent.level.supportRate : agent.level.stableRate;
}

function periodTypeForCard(card: Card, commissionMonth: YearMonth): PeriodType | null {
  const activationMonth = toYearMonth(card.activatedAt);
  if (commissionMonth < addMonths(activationMonth, 1)) return null; // activation month and earlier

  // m=1 activation month; m=2 first commission month (activation+1)
  const m = monthDiff(activationMonth, commissionMonth) + 1;
  if (m < 2) return null;
  if (m <= SUPPORT_TOTAL_MONTHS) return "SUPPORT";

  const stableIndex = m - SUPPORT_TOTAL_MONTHS; // 1-based
  if (stableIndex <= card.owner.level.stableMonths) return "STABLE";
  return null;
}

function latestStatusAtOrBefore(events: readonly CardStatusEvent[], t: Date): CardStatus | null {
  // Events are assumed unsorted.
  // Tie-break: if multiple events share the same happenedAt, the later one wins.
  let best: CardStatusEvent | null = null;
  for (const e of events) {
    if (e.happenedAt.getTime() <= t.getTime()) {
      if (!best || e.happenedAt.getTime() >= best.happenedAt.getTime()) best = e;
    }
  }
  return best?.status ?? null;
}

export function isCardEligibleForMonth(
  card: Card,
  commissionMonth: YearMonth,
  opts?: { tz?: "UTC" | "LOCAL"; normalStatus?: CardStatus },
): boolean {
  const tz = opts?.tz ?? "LOCAL";
  const normalStatus = opts?.normalStatus ?? "NORMAL";
  const monthStart = startOfMonth(commissionMonth, tz);
  const monthEnd = endOfMonth(commissionMonth, tz);

  // Status at month start: if not NORMAL, month is ineligible (even if it becomes normal later).
  const statusAtStart = latestStatusAtOrBefore(card.statusEvents, monthStart) ?? normalStatus;
  if (statusAtStart !== normalStatus) return false;

  for (const e of card.statusEvents) {
    const ts = e.happenedAt.getTime();
    if (ts > monthStart.getTime() && ts <= monthEnd.getTime() && e.status !== normalStatus) {
      return false;
    }
  }
  return true;
}

function buildLine(args: {
  card: Card;
  commissionMonth: YearMonth;
  beneficiary: Agent;
  kind: SettlementKind;
  periodType: PeriodType;
  base: number;
  ratio: number;
}): SettlementLine {
  return {
    cardId: args.card.id,
    cardNo: args.card.cardNo,
    commissionMonth: args.commissionMonth,
    beneficiaryAgentId: args.beneficiary.id,
    beneficiaryAgentName: args.beneficiary.name,
    kind: args.kind,
    periodType: args.periodType,
    baseMonthlyRent: args.base,
    ratio: args.ratio,
    amount: trunc2(args.base * args.ratio),
  };
}

export function computeSettlementLinesForCard(
  card: Card,
  commissionMonth: YearMonth,
  opts?: { tz?: "UTC" | "LOCAL"; normalStatus?: CardStatus },
): SettlementLine[] {
  const periodType = periodTypeForCard(card, commissionMonth);
  if (!periodType) return [];

  if (!isCardEligibleForMonth(card, commissionMonth, opts)) return [];

  const base = card.planMonthlyRent;
  const C = card.owner;
  const B = C.upline1 ?? null;
  const A = C.upline2 ?? null;

  const rC = rate(C, periodType);
  const lines: SettlementLine[] = [];
  if (rC > 0) {
    lines.push(
      buildLine({
        card,
        commissionMonth,
        beneficiary: C,
        kind: "SELF",
        periodType,
        base,
        ratio: rC,
      }),
    );
  }

  const rB = B ? rate(B, periodType) : 0;
  const diff1 = Math.max(rB - rC, 0);
  if (B && diff1 > 0) {
    lines.push(
      buildLine({
        card,
        commissionMonth,
        beneficiary: B,
        kind: "UPLINE_DIFF_1",
        periodType,
        base,
        ratio: diff1,
      }),
    );
  }

  const rA = A ? rate(A, periodType) : 0;
  const diff2 = Math.max(rA - Math.max(rB, rC), 0);
  if (A && diff2 > 0) {
    lines.push(
      buildLine({
        card,
        commissionMonth,
        beneficiary: A,
        kind: "UPLINE_DIFF_2",
        periodType,
        base,
        ratio: diff2,
      }),
    );
  }

  return lines;
}

export function computeSettlementLinesForMonth(cards: readonly Card[], commissionMonth: YearMonth): SettlementLine[] {
  const out: SettlementLine[] = [];
  for (const c of cards) out.push(...computeSettlementLinesForCard(c, commissionMonth));
  return out;
}
