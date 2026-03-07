export type YearMonth = `${number}-${"01" | "02" | "03" | "04" | "05" | "06" | "07" | "08" | "09" | "10" | "11" | "12"}`;

export type CardStatus = "NORMAL" | "PAUSED" | "LEFT" | "CONTROLLED" | "ABNORMAL";

export type SettlementKind = "SELF" | "UPLINE_DIFF_1" | "UPLINE_DIFF_2";

export type PeriodType = "SUPPORT" | "STABLE";

export type CardStatusEvent = Readonly<{
  happenedAt: Date;
  status: CardStatus;
}>;

export type AgentLevel = Readonly<{
  id: string;
  name: string;
  supportRate: number; // 0.03 == 3%
  stableRate: number; // 0.03 == 3%
  stableMonths: number; // >= 0
}>;

export type Agent = Readonly<{
  id: string;
  name: string;
  level: AgentLevel;
  upline1?: Agent | null;
  upline2?: Agent | null;
}>;

export type Card = Readonly<{
  id: string;
  cardNo: string;
  activatedAt: Date;
  planMonthlyRent: number; // money in RMB, e.g. 29
  owner: Agent;
  statusEvents: readonly CardStatusEvent[];
}>;

export type SettlementLine = Readonly<{
  cardId: string;
  cardNo: string;
  commissionMonth: YearMonth;
  beneficiaryAgentId: string;
  beneficiaryAgentName: string;
  kind: SettlementKind;
  periodType: PeriodType;
  baseMonthlyRent: number;
  ratio: number; // e.g. 0.03 (or diff ratio)
  amount: number; // already trunc2 applied
}>;

