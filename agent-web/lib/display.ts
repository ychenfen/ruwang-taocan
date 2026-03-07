export function cardStatusLabel(status: string): string {
  if (status === "NORMAL") return "正常";
  if (status === "PAUSED") return "停机";
  if (status === "LEFT") return "离网";
  if (status === "CONTROLLED") return "管控";
  if (status === "ABNORMAL") return "异常";
  return status;
}

export function formatDateYmd(value: string | null | undefined): string {
  const s = String(value ?? "").trim();
  if (!s) return "";
  const direct = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (direct) return `${direct[1]}-${direct[2]}-${direct[3]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function runStatusLabel(status: string): string {
  if (status === "DRAFT") return "草稿";
  if (status === "APPROVED") return "已审核";
  if (status === "POSTED") return "已入账";
  return status;
}

export function executionStatusLabel(status: string): string {
  if (status === "SUCCEEDED") return "成功";
  if (status === "FAILED") return "失败";
  return status;
}
