export function trunc2(x: number): number {
  // "2位后的直接去掉" (truncate, no rounding). Keep sign behavior consistent.
  const s = Math.sign(x) || 1;
  const v = Math.abs(x);
  return (Math.floor(v * 100) / 100) * s;
}

