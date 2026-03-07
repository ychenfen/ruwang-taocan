import type { ApiError } from "./api";

export function humanizeApiError(e: unknown): string {
  const err = e as ApiError;
  if (!err || typeof err !== "object") return "未知错误";
  if (err.code === "UNAUTHORIZED") return "未登录或登录已过期";
  if (err.code === "FORBIDDEN") return "没有权限";
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
  if (err.code === "RATE_LIMITED") {
    const retry = err.details?.retryAfterSec;
    if (typeof retry === "number" && Number.isFinite(retry) && retry > 0) return `请求过于频繁，请 ${retry}s 后再试`;
    return "请求过于频繁，请稍后再试";
  }
  if (err.status >= 500) return "服务端错误，请稍后再试";
  return `请求失败：${err.code ?? "HTTP_ERROR"}`;
}
