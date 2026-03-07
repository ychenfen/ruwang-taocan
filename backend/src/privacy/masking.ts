export function maskCardNo(cardNo: string): string {
  // Example required: 192******16
  const s = String(cardNo ?? "");
  if (s.length <= 5) return "*".repeat(Math.max(s.length, 0));
  const prefix = s.slice(0, 3);
  const suffix = s.slice(-2);
  return `${prefix}******${suffix}`;
}

