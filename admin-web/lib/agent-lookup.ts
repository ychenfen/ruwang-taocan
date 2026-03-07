export type LookupAgent = Readonly<{
  id: string;
  name: string;
  employeeNo?: string;
  username?: string;
}>;

type ResolveResult =
  | Readonly<{ ok: true; agentId: string; agent: LookupAgent }>
  | Readonly<{ ok: false; reason: "NOT_FOUND" | "AMBIGUOUS"; message: string }>;

function lower(s: string | undefined): string {
  return String(s ?? "").trim().toLowerCase();
}

function exactFieldMatch(agents: LookupAgent[], keyword: string, pick: (a: LookupAgent) => string | undefined): LookupAgent[] {
  const k = lower(keyword);
  if (!k) return [];
  return agents.filter((a) => lower(pick(a)) === k);
}

function fuzzyMatch(agents: LookupAgent[], keyword: string): LookupAgent[] {
  const k = lower(keyword);
  if (!k) return [];
  return agents.filter((a) => {
    const name = lower(a.name);
    const employeeNo = lower(a.employeeNo);
    const username = lower(a.username);
    return name.includes(k) || employeeNo.includes(k) || username.includes(k);
  });
}

function describeAgent(a: LookupAgent): string {
  const parts = [a.name];
  if (a.employeeNo) parts.push(`工号:${a.employeeNo}`);
  if (a.username) parts.push(`账号:${a.username}`);
  return parts.join(" / ");
}

function toUniqueResult(rows: LookupAgent[]): ResolveResult {
  if (rows.length === 1) return { ok: true, agentId: rows[0].id, agent: rows[0] };
  if (rows.length === 0) {
    return { ok: false, reason: "NOT_FOUND", message: "未找到匹配代理，请输入正确的姓名/工号/账号。" };
  }
  const sample = rows
    .slice(0, 3)
    .map((x) => describeAgent(x))
    .join("；");
  return {
    ok: false,
    reason: "AMBIGUOUS",
    message: `匹配到多个代理，请输入更精确信息。候选：${sample}${rows.length > 3 ? " …" : ""}`,
  };
}

// 解析“姓名/工号/账号”到唯一代理 ID，优先级：工号精确 > 账号精确 > 姓名精确 > 模糊匹配。
export function resolveAgentByKeyword(keyword: string, agents: LookupAgent[]): ResolveResult {
  const k = keyword.trim();
  if (!k) {
    return { ok: false, reason: "NOT_FOUND", message: "请输入代理姓名/工号/账号。" };
  }
  const byEmployeeNo = toUniqueResult(exactFieldMatch(agents, k, (a) => a.employeeNo));
  if (byEmployeeNo.ok || byEmployeeNo.reason === "AMBIGUOUS") return byEmployeeNo;

  const byUsername = toUniqueResult(exactFieldMatch(agents, k, (a) => a.username));
  if (byUsername.ok || byUsername.reason === "AMBIGUOUS") return byUsername;

  const byName = toUniqueResult(exactFieldMatch(agents, k, (a) => a.name));
  if (byName.ok || byName.reason === "AMBIGUOUS") return byName;

  return toUniqueResult(fuzzyMatch(agents, k));
}

export function agentDisplayName(a: LookupAgent): string {
  return describeAgent(a);
}
