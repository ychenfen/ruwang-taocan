import { type YearMonth } from "./types.js";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function toYearMonth(d: Date): YearMonth {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return `${y}-${pad2(m)}` as YearMonth;
}

export function parseYearMonth(ym: YearMonth): { year: number; month: number } {
  const [y, m] = ym.split("-");
  return { year: Number(y), month: Number(m) };
}

export function addMonths(ym: YearMonth, months: number): YearMonth {
  const { year, month } = parseYearMonth(ym);
  const idx0 = year * 12 + (month - 1) + months;
  const y2 = Math.floor(idx0 / 12);
  const m2 = (idx0 % 12) + 1;
  return `${y2}-${pad2(m2)}` as YearMonth;
}

export function monthDiff(from: YearMonth, to: YearMonth): number {
  const a = parseYearMonth(from);
  const b = parseYearMonth(to);
  return (b.year - a.year) * 12 + (b.month - a.month);
}

export function startOfMonth(ym: YearMonth, tz: "UTC" | "LOCAL" = "LOCAL"): Date {
  const { year, month } = parseYearMonth(ym);
  if (tz === "UTC") return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  return new Date(year, month - 1, 1, 0, 0, 0, 0);
}

export function endOfMonth(ym: YearMonth, tz: "UTC" | "LOCAL" = "LOCAL"): Date {
  const { year, month } = parseYearMonth(ym);
  if (tz === "UTC") return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return new Date(year, month, 0, 23, 59, 59, 999);
}

