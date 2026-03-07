import { describe, expect, it } from "vitest";

import { addMonths, endOfMonth, startOfMonth } from "./month.js";
import { computeSettlementLinesForCard, isCardEligibleForMonth, trunc2 } from "./index.js";
import type { Agent, AgentLevel, Card, CardStatusEvent, YearMonth } from "./types.js";

function lvl(id: string, supportRate: number, stableRate: number, stableMonths: number): AgentLevel {
  return { id, name: id, supportRate, stableRate, stableMonths };
}

function agent(id: string, level: AgentLevel, upline1?: Agent | null, upline2?: Agent | null): Agent {
  return { id, name: id, level, upline1: upline1 ?? null, upline2: upline2 ?? null };
}

function ev(ym: YearMonth, day: number, status: CardStatusEvent["status"]): CardStatusEvent {
  // LOCAL timezone used in engine tests; set to noon to avoid DST boundary surprises.
  const [y, m] = ym.split("-").map(Number);
  return { happenedAt: new Date(y, m - 1, day, 12, 0, 0, 0), status };
}

describe("trunc2", () => {
  it("truncates without rounding", () => {
    expect(trunc2(0.966657)).toBe(0.96);
    expect(trunc2(1.999)).toBe(1.99);
    expect(trunc2(-0.969)).toBe(-0.96);
  });
});

describe("periods + eligibility + diff (2 levels)", () => {
  const L3 = lvl("L3", 0.06, 0.03, 12);
  const L2 = lvl("L2", 0.03, 0.02, 12);
  const L1 = lvl("L1", 0.03, 0.02, 12);

  const A = agent("A", L3);
  const B = agent("B", L2, A, null);
  const C = agent("C", L1, B, A);

  const activatedAt = new Date(2026, 0, 15, 12, 0, 0, 0); // 2026-01

  function mkCard(statusEvents: readonly CardStatusEvent[]): Card {
    return {
      id: "card1",
      cardNo: "192123130001",
      activatedAt,
      planMonthlyRent: 29,
      owner: C,
      statusEvents,
    };
  }

  it("support period months: activation month not commissioned; 2026-02..2026-11 are SUPPORT", () => {
    const card = mkCard([ev("2026-01", 15, "NORMAL")]);

    expect(computeSettlementLinesForCard(card, "2026-01")).toEqual([]);
    expect(computeSettlementLinesForCard(card, "2026-02")[0]?.periodType).toBe("SUPPORT");
    expect(computeSettlementLinesForCard(card, "2026-11")[0]?.periodType).toBe("SUPPORT");
    expect(computeSettlementLinesForCard(card, "2026-12")[0]?.periodType).toBe("STABLE");
  });

  it("abnormal any time in month => whole month not eligible (even on last day)", () => {
    const card = mkCard([
      ev("2026-01", 15, "NORMAL"),
      ev("2026-03", 31, "ABNORMAL"),
    ]);
    expect(isCardEligibleForMonth(card, "2026-03")).toBe(false);
    expect(computeSettlementLinesForCard(card, "2026-03")).toEqual([]);
  });

  it("abnormal status that started before the month and continues => ineligible even without events in the month", () => {
    const card = mkCard([
      ev("2026-01", 15, "NORMAL"),
      ev("2026-02", 20, "ABNORMAL"),
    ]);
    // No events in 2026-03, but status at start of 2026-03 is ABNORMAL => ineligible
    expect(isCardEligibleForMonth(card, "2026-03")).toBe(false);
    expect(computeSettlementLinesForCard(card, "2026-03")).toEqual([]);
  });

  it("support timeline keeps moving even if one month has zero commission", () => {
    const card = mkCard([
      ev("2026-01", 15, "NORMAL"),
      ev("2026-02", 10, "ABNORMAL"),
      { happenedAt: new Date(2026, 1, 28, 12, 0, 0, 0), status: "NORMAL" },
    ]);

    expect(computeSettlementLinesForCard(card, "2026-02")).toEqual([]);
    const marchLines = computeSettlementLinesForCard(card, "2026-03");
    expect(marchLines.length).toBeGreaterThan(0);
    expect(marchLines[0]?.periodType).toBe("SUPPORT");
  });

  it("status tie-break: same happenedAt should use the later event (PAUSED -> NORMAL on the same timestamp)", () => {
    const t = new Date(2026, 1, 17, 0, 0, 0, 0); // 2026-02-17 local midnight (same as date-only inputs)
    const card = mkCard([
      ev("2026-01", 15, "NORMAL"),
      { happenedAt: t, status: "PAUSED" },
      { happenedAt: t, status: "NORMAL" },
    ]);

    // 2026-02 had PAUSED at some point => whole month ineligible.
    expect(computeSettlementLinesForCard(card, "2026-02")).toEqual([]);

    // 2026-03 should recover (status at 2026-03-01 is NORMAL).
    const marchLines = computeSettlementLinesForCard(card, "2026-03");
    expect(marchLines.length).toBeGreaterThan(0);
  });

  it("diff lines: B gets (rB-rC), A gets (rA-max(rB,rC))", () => {
    const card = mkCard([ev("2026-01", 15, "NORMAL")]);
    const lines = computeSettlementLinesForCard(card, "2026-02");

    // Rates: A=6%, B=3%, C=3% in SUPPORT
    // SELF(C)=0.87, DIFF1(B)=0, DIFF2(A)=0.87
    expect(lines.map((l) => l.kind).sort()).toEqual(["SELF", "UPLINE_DIFF_2"].sort());
    const self = lines.find((l) => l.kind === "SELF")!;
    const a2 = lines.find((l) => l.kind === "UPLINE_DIFF_2")!;
    expect(self.amount).toBe(0.87);
    expect(a2.amount).toBe(0.87);
  });
});

describe("month boundaries helpers", () => {
  it("start/end of month produce an inclusive range", () => {
    const s = startOfMonth("2026-02");
    const e = endOfMonth("2026-02");
    expect(s.getTime()).toBeLessThan(e.getTime());
    expect(addMonths("2026-01", 1)).toBe("2026-02");
  });
});
