import type { ApiError } from "./api";

export function humanizeApiError(e: unknown): string {
  const err = e as ApiError;
  if (!err || typeof err !== "object") return "未知错误";
  if (err.code === "UNAUTHORIZED") return "未登录或登录已过期";
  if (err.code === "FORBIDDEN") return "没有权限";
  if (err.code === "NO_CHANGES") return "未检测到变更，无需保存。";
  if (err.code === "BAD_REQUEST") {
    const detailMsg =
      typeof err.details?.message === "string"
        ? err.details.message
        : typeof err.details?.msg === "string"
          ? err.details.msg
          : typeof err.details?.detail === "string"
            ? err.details.detail
            : "";
    return detailMsg ? `请求参数错误：${detailMsg}` : "请求参数错误";
  }
  if (err.code === "NOT_FOUND") return "记录不存在";
  if (err.code === "NOT_DRAFT") return "当前结算单不是草稿状态，不能重算。";
  if (err.code === "LOCKED") return "已有重算任务在执行，请稍后重试。";
  if (err.code === "RUN_NOT_DRAFT") return "仅草稿账单允许删除。";
  if (err.code === "RUN_NOT_FOUND") return "未找到关联结算单。";
  if (err.code === "NOT_APPROVED") return "当前结算单未审核，无法入账。";
  if (err.code === "CURRENT_PASSWORD_INVALID") return "当前密码不正确。";
  if (err.code === "NEW_PASSWORD_SAME_AS_OLD") return "新密码不能与当前密码相同。";
  if (err.code === "TEAM_NOT_FOUND") return "团队不存在。";
  if (err.code === "AGENT_NOT_FOUND") return "代理不存在。";
  if (err.code === "LEADER_NOT_FOUND") return "队长代理不存在。";
  if (err.code === "LEVEL_NOT_FOUND") return "星级不存在。";
  if (err.code === "AGENT_LEVEL_IN_USE") return "该星级仍有职工在使用，无法删除。";
  if (err.code === "PLAN_IN_USE") return "该套餐已被网卡使用，无法删除。";
  if (err.code === "TEAM_HAS_ACTIVE_MEMBERS") return "该团队仍有成员，无法删除。";
  if (err.code === "TEAM_HAS_MEMBERSHIP_HISTORY") return "该团队存在成员历史记录，暂不支持删除。";
  if (err.code === "TEAM_IN_USE_BY_AGENT") return "仍有职工归属该团队，无法删除。";
  if (err.code === "USERNAME_TAKEN") return "用户名已存在。";
  if (err.code === "CARD_NO_TAKEN") return "卡号已存在。";
  if (err.code === "ASSIGN_EFFECTIVE_AT_BEFORE_CURRENT_START") return "转移生效日期早于当前归属开始时间，请调整日期后重试。";
  if (err.code === "CARD_HAS_SETTLEMENT_ITEMS") return "该网卡已产生结算记录，不能删除。";
  if (err.code === "AGENT_IS_TEAM_LEADER") return "该职工是团队队长，无法删除。请先更换队长。";
  if (err.code === "AGENT_HAS_ACTIVE_DOWNLINES") return "该职工仍有下级关系，无法删除。请先调整上下级关系。";
  if (err.code === "AGENT_HAS_CARDS") return "该职工名下有网卡，无法删除。";
  if (err.code === "AGENT_HAS_SETTLEMENT_ITEMS") return "该职工已参与结算，无法删除。";
  if (err.code === "AGENT_HAS_LEDGER_LINES") return "该职工已存在入账分录，无法删除。";
  if (err.code === "UPLINE_NOT_FOUND") return "上级不存在。";
  if (err.code === "SELF_UPLINE") return "上级不能设置为本人。";
  if (err.code === "CYCLE") return "上下级关系会形成闭环，请重新选择。";
  if (err.code === "RATE_LIMITED") {
    const retry = err.details?.retryAfterSec;
    if (typeof retry === "number" && Number.isFinite(retry) && retry > 0) return `请求过于频繁，请 ${retry}s 后再试`;
    return "请求过于频繁，请稍后再试";
  }
  if (err.status >= 500) return "服务端错误，请稍后再试";
  return `请求失败：${err.code ?? "HTTP_ERROR"}`;
}
