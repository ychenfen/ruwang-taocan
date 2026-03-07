"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import useSWR from "swr";

import { apiDownload, apiFetch } from "../../../lib/api";
import { agentDisplayName, resolveAgentByKeyword, type LookupAgent } from "../../../lib/agent-lookup";
import { formatDateYmd } from "../../../lib/display";
import { humanizeApiError } from "../../../lib/errors";

type AgentSummary = Readonly<{
  beneficiaryAgentId: string;
  beneficiaryName: string;
  teamId?: string;
  teamName?: string;
  lineCount: number;
  totalAmount: number;
}>;

type TeamSummary = Readonly<{
  teamId?: string;
  teamName?: string;
  agentCount: number;
  totalAmount: number;
}>;

type PreviewRow = Readonly<{
  itemId: string;
  runStatus: string;
  commissionMonth: string;
  cardId: string;
  cardNo: string;
  cardStatusAtMonthEnd: string;
  ownerAgentId?: string;
  ownerAgentName?: string;
  beneficiaryAgentId: string;
  beneficiaryName: string;
  teamName?: string;
  beneficiaryLevelId: string;
  beneficiaryLevelName: string;
  kindRaw: string;
  targetKind: string;
  periodType: string;
  baseMonthlyRent: number;
  ratio: number;
  amount: number;
  adjustmentOfItemId?: string;
  adjustmentReason?: string;
  createdAt: string;
}>;

type PreviewResp = Readonly<{
  runId: string;
  runStatus: string;
  commissionMonth: string;
  total: number;
  limit: number;
  offset: number;
  rows: PreviewRow[];
}>;

type ReportFilters = Readonly<{
  commissionMonth: string;
  beneficiaryAgentId: string;
  teamId: string;
  levelId: string;
  kind: string;
  targetKind: string;
  periodType: string;
  ownerAgentId: string;
  cardStatus: string;
}>;

type AgentLite = LookupAgent;

type PreviewColumnKey =
  | "cardNo"
  | "beneficiaryName"
  | "teamName"
  | "beneficiaryLevelName"
  | "kindRaw"
  | "targetKind"
  | "periodType"
  | "cardStatusAtMonthEnd"
  | "baseMonthlyRent"
  | "ratio"
  | "amount"
  | "adjustmentReason"
  | "createdAt"
  | "ownerAgentName";

const FILTER_STORAGE_KEY = "ruwang.admin.reports.filters.v1";
const PREVIEW_COLUMNS_STORAGE_KEY = "ruwang.admin.reports.preview.columns.v1";

const PREVIEW_COLUMN_OPTIONS: ReadonlyArray<Readonly<{ key: PreviewColumnKey; label: string }>> = [
  { key: "cardNo", label: "卡号" },
  { key: "beneficiaryName", label: "收益人" },
  { key: "teamName", label: "团队" },
  { key: "beneficiaryLevelName", label: "星级" },
  { key: "ownerAgentName", label: "归属职工" },
  { key: "kindRaw", label: "佣金类型" },
  { key: "targetKind", label: "目标类型" },
  { key: "periodType", label: "期别" },
  { key: "cardStatusAtMonthEnd", label: "月末卡状态" },
  { key: "baseMonthlyRent", label: "月租基数" },
  { key: "ratio", label: "比例" },
  { key: "amount", label: "金额" },
  { key: "adjustmentReason", label: "调整原因" },
  { key: "createdAt", label: "创建时间" },
];

const DEFAULT_PREVIEW_COLUMNS: Record<PreviewColumnKey, boolean> = {
  cardNo: true,
  beneficiaryName: true,
  teamName: true,
  beneficiaryLevelName: false,
  ownerAgentName: false,
  kindRaw: true,
  targetKind: true,
  periodType: true,
  cardStatusAtMonthEnd: true,
  baseMonthlyRent: true,
  ratio: true,
  amount: true,
  adjustmentReason: true,
  createdAt: false,
};

function ymPrev(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}`;
}

function buildQuery(obj: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (!v) continue;
    sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

function safeParseJson<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try {
    const v = JSON.parse(s);
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function statusColor(status: string): string {
  if (status === "POSTED") return "#166534";
  if (status === "APPROVED") return "#1d4ed8";
  if (status === "DRAFT") return "#9a3412";
  return "var(--muted)";
}

function kindLabel(kind: string): string {
  if (kind === "SELF") return "本人佣金";
  if (kind === "UPLINE_DIFF_1") return "一级差价";
  if (kind === "UPLINE_DIFF_2") return "二级差价";
  if (kind === "ADJUSTMENT") return "调整";
  return kind;
}

function targetKindLabel(kind: string): string {
  if (kind === "SELF") return "本人";
  if (kind === "UPLINE_DIFF_1") return "一级差价";
  if (kind === "UPLINE_DIFF_2") return "二级差价";
  return kind;
}

function periodTypeLabel(periodType: string): string {
  if (periodType === "SUPPORT") return "扶持期";
  if (periodType === "STABLE") return "稳定期";
  return periodType;
}

function cardStatusLabel(status: string): string {
  if (status === "NORMAL") return "正常";
  if (status === "PAUSED") return "停机";
  if (status === "LEFT") return "离网";
  if (status === "CONTROLLED") return "管控";
  if (status === "ABNORMAL") return "异常";
  return status;
}

function renderPreviewCell(row: PreviewRow, key: PreviewColumnKey): ReactNode {
  if (key === "cardNo") return <span className="mono">{row.cardNo}</span>;
  if (key === "beneficiaryName") return row.beneficiaryName;
  if (key === "teamName") return row.teamName ?? "(无团队)";
  if (key === "beneficiaryLevelName") return row.beneficiaryLevelName;
  if (key === "ownerAgentName") return row.ownerAgentName ?? "";
  if (key === "kindRaw") return <span className="mono">{kindLabel(row.kindRaw)}</span>;
  if (key === "targetKind") return <span className="mono">{targetKindLabel(row.targetKind)}</span>;
  if (key === "periodType") return <span className="mono">{periodTypeLabel(row.periodType)}</span>;
  if (key === "cardStatusAtMonthEnd") return <span className="mono">{cardStatusLabel(row.cardStatusAtMonthEnd)}</span>;
  if (key === "baseMonthlyRent") return <span className="mono">{row.baseMonthlyRent.toFixed(2)}</span>;
  if (key === "ratio") return <span className="mono">{row.ratio.toFixed(6)}</span>;
  if (key === "amount") return <span className="mono">{row.amount.toFixed(2)}</span>;
  if (key === "adjustmentReason") return row.adjustmentReason ?? "";
  return <span className="mono">{formatDateYmd(row.createdAt)}</span>;
}

export default function ReportsPage() {
  const [filters, setFilters] = useState<ReportFilters>({
    commissionMonth: ymPrev(),
    beneficiaryAgentId: "",
    teamId: "",
    levelId: "",
    kind: "",
    targetKind: "",
    periodType: "",
    ownerAgentId: "",
    cardStatus: "",
  });
  const [limit, setLimit] = useState(20);
  const [offset, setOffset] = useState(0);
  const [previewColumns, setPreviewColumns] = useState<Record<PreviewColumnKey, boolean>>(DEFAULT_PREVIEW_COLUMNS);
  const [hydrated, setHydrated] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<"" | "csv" | "xlsx">("");
  const [billExportingFormat, setBillExportingFormat] = useState<"" | "csv" | "xlsx">("");
  const [error, setError] = useState<string | null>(null);
  const allAgents = useSWR("/admin/agents", (p: string) => apiFetch<AgentLite[]>(p));

  useEffect(() => {
    const f = safeParseJson<Partial<ReportFilters>>(
      typeof window !== "undefined" ? window.localStorage.getItem(FILTER_STORAGE_KEY) : null,
      {},
    );
    const c = safeParseJson<Partial<Record<PreviewColumnKey, boolean>>>(
      typeof window !== "undefined" ? window.localStorage.getItem(PREVIEW_COLUMNS_STORAGE_KEY) : null,
      {},
    );
    setFilters((prev) => ({
      ...prev,
      ...f,
      commissionMonth: typeof f.commissionMonth === "string" && f.commissionMonth.length > 0 ? f.commissionMonth : prev.commissionMonth,
    }));
    setPreviewColumns((prev) => ({ ...prev, ...c }));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
  }, [filters, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(PREVIEW_COLUMNS_STORAGE_KEY, JSON.stringify(previewColumns));
  }, [previewColumns, hydrated]);

  const setFilter = (patch: Partial<ReportFilters>) => {
    setOffset(0);
    setFilters((prev) => ({ ...prev, ...patch }));
  };

  const resolvedBeneficiary = useMemo(() => {
    const keyword = filters.beneficiaryAgentId.trim();
    if (!keyword) return null;
    return resolveAgentByKeyword(keyword, allAgents.data ?? []);
  }, [filters.beneficiaryAgentId, allAgents.data]);
  const resolvedOwner = useMemo(() => {
    const keyword = filters.ownerAgentId.trim();
    if (!keyword) return null;
    return resolveAgentByKeyword(keyword, allAgents.data ?? []);
  }, [filters.ownerAgentId, allAgents.data]);

  const beneficiaryAgentIdFilter =
    filters.beneficiaryAgentId.trim().length === 0
      ? undefined
      : resolvedBeneficiary?.ok
        ? resolvedBeneficiary.agentId
        : "__NO_MATCH__";
  const ownerAgentIdFilter =
    filters.ownerAgentId.trim().length === 0
      ? undefined
      : resolvedOwner?.ok
        ? resolvedOwner.agentId
        : "__NO_MATCH__";

  const qs = useMemo(
    () =>
      buildQuery({
        commissionMonth: filters.commissionMonth.trim(),
        beneficiaryAgentId: beneficiaryAgentIdFilter,
        teamId: filters.teamId.trim() || undefined,
        levelId: filters.levelId.trim() || undefined,
        kind: filters.kind || undefined,
        targetKind: filters.targetKind || undefined,
        periodType: filters.periodType || undefined,
        ownerAgentId: ownerAgentIdFilter,
        cardStatus: filters.cardStatus || undefined,
      }),
    [filters, beneficiaryAgentIdFilter, ownerAgentIdFilter],
  );

  const previewQs = useMemo(
    () =>
      buildQuery({
        commissionMonth: filters.commissionMonth.trim(),
        beneficiaryAgentId: beneficiaryAgentIdFilter,
        teamId: filters.teamId.trim() || undefined,
        levelId: filters.levelId.trim() || undefined,
        kind: filters.kind || undefined,
        targetKind: filters.targetKind || undefined,
        periodType: filters.periodType || undefined,
        ownerAgentId: ownerAgentIdFilter,
        cardStatus: filters.cardStatus || undefined,
        limit: String(limit),
        offset: String(offset),
      }),
    [filters, beneficiaryAgentIdFilter, ownerAgentIdFilter, limit, offset],
  );

  const agents = useSWR(
    filters.commissionMonth.trim() ? `/admin/reports/settlement-summary/agents${qs}` : null,
    (p: string) => apiFetch<AgentSummary[]>(p),
  );
  const teams = useSWR(
    filters.commissionMonth.trim() ? `/admin/reports/settlement-summary/teams${qs}` : null,
    (p: string) => apiFetch<TeamSummary[]>(p),
  );
  const preview = useSWR(
    filters.commissionMonth.trim() ? `/admin/reports/settlement-items-preview${previewQs}` : null,
    (p: string) => apiFetch<PreviewResp>(p),
  );

  const agentTotal = (agents.data ?? []).reduce((s, x) => s + x.totalAmount, 0);
  const agentLines = (agents.data ?? []).reduce((s, x) => s + x.lineCount, 0);
  const previewRows = preview.data?.rows ?? [];
  const previewTotal = preview.data?.total ?? 0;
  const agentSummaryError = agents.error ? humanizeApiError(agents.error) : null;
  const teamSummaryError = teams.error ? humanizeApiError(teams.error) : null;
  const previewLoadError = preview.error ? humanizeApiError(preview.error) : null;
  const canPrev = offset > 0;
  const canNext = offset + limit < previewTotal;
  const exportingAny = exportingFormat.length > 0 || billExportingFormat.length > 0;

  const downloadSettlementItems = async (format: "csv" | "xlsx") => {
    setError(null);
    setExportingFormat(format);
    try {
      const { blob, filename } = await apiDownload(`/admin/reports/settlement-items.${format}${qs}`, { method: "GET" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename ?? `settlement-items-${filters.commissionMonth || "export"}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (e) {
      setError(humanizeApiError(e));
    } finally {
      setExportingFormat("");
    }
  };

  const downloadBillItems = async (format: "csv" | "xlsx") => {
    setError(null);
    setBillExportingFormat(format);
    try {
      const { blob, filename } = await apiDownload(`/admin/reports/bill.${format}${qs}`, { method: "GET" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename ?? `bill-${filters.commissionMonth || "export"}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (e) {
      setError(humanizeApiError(e));
    } finally {
      setBillExportingFormat("");
    }
  };

  return (
    <>
      <div className="mainHeader">
        <div>
          <div className="mainTitle">导出与汇总</div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
            筛选参数自动记忆；先预览再导出，避免空跑。
          </div>
        </div>
        <div className="btnRow">
          <button
            className="btn btnPrimary"
            disabled={exportingAny}
            onClick={() => downloadSettlementItems("csv")}
          >
            {exportingFormat === "csv" ? "导出中…" : "导出 CSV"}
          </button>
          <button className="btn" disabled={exportingAny} onClick={() => downloadSettlementItems("xlsx")}>
            {exportingFormat === "xlsx" ? "导出中…" : "导出 XLSX"}
          </button>
          <button className="btn btnPrimary" disabled={exportingAny} onClick={() => downloadBillItems("csv")}>
            {billExportingFormat === "csv" ? "导出中…" : "账单 CSV"}
          </button>
          <button className="btn" disabled={exportingAny} onClick={() => downloadBillItems("xlsx")}>
            {billExportingFormat === "xlsx" ? "导出中…" : "账单 XLSX"}
          </button>
        </div>
      </div>

      <div className="mainBody">
        {error ? <div className="error">{error}</div> : null}
        <div className="card">
          <div className="cardTitle">筛选</div>
          <div className="cardMeta">结算月份必填；其余项可选。</div>

          <div className="btnRow" style={{ marginTop: 10 }}>
            <button
              className="btn"
              onClick={() =>
                setFilter({
                  commissionMonth: ymPrev(),
                  beneficiaryAgentId: "",
                  teamId: "",
                  levelId: "",
                  kind: "",
                  targetKind: "",
                  periodType: "",
                  ownerAgentId: "",
                  cardStatus: "",
                })
              }
            >
              重置筛选
            </button>
            <button className="btn" onClick={() => setFilter({ kind: "ADJUSTMENT" })}>
              仅看调整单
            </button>
            <button className="btn" onClick={() => setFilter({ cardStatus: "ABNORMAL" })}>
              仅看异常卡
            </button>
            <div style={{ color: "var(--muted)", fontSize: 12, alignSelf: "center" }}>
              当前条件：<span className="mono">{qs || "(none)"}</span>
            </div>
          </div>

          <div className="cardGrid" style={{ marginTop: 10 }}>
            <div className="card" style={{ gridColumn: "span 4" }}>
              <div className="label">结算月份</div>
              <input
                className="input mono"
                value={filters.commissionMonth}
                onChange={(e) => setFilter({ commissionMonth: e.target.value })}
                placeholder="2026-02"
              />
            </div>
            <div className="card" style={{ gridColumn: "span 4" }}>
              <div className="label">收益职工（姓名/工号）</div>
              <input
                className="input"
                list="report-agent-options"
                value={filters.beneficiaryAgentId}
                onChange={(e) => setFilter({ beneficiaryAgentId: e.target.value })}
                placeholder="姓名/工号/账号（可选）"
              />
              {filters.beneficiaryAgentId.trim() ? (
                <div className="cardMeta" style={{ marginTop: 6 }}>
                  {resolvedBeneficiary?.ok
                    ? `已匹配收益职工：${agentDisplayName(resolvedBeneficiary.agent)}`
                    : resolvedBeneficiary?.message ?? ""}
                </div>
              ) : null}
              <div className="label" style={{ marginTop: 10 }}>
                归属职工（姓名/工号）
              </div>
              <input
                className="input"
                list="report-agent-options"
                value={filters.ownerAgentId}
                onChange={(e) => setFilter({ ownerAgentId: e.target.value })}
                placeholder="姓名/工号/账号（可选）"
              />
              {filters.ownerAgentId.trim() ? (
                <div className="cardMeta" style={{ marginTop: 6 }}>
                  {resolvedOwner?.ok ? `已匹配归属职工：${agentDisplayName(resolvedOwner.agent)}` : resolvedOwner?.message ?? ""}
                </div>
              ) : null}
            </div>
            <div className="card" style={{ gridColumn: "span 4" }}>
              <div className="label">团队ID（可选）</div>
              <input
                className="input mono"
                value={filters.teamId}
                onChange={(e) => setFilter({ teamId: e.target.value })}
                placeholder="(optional)"
              />
              <div className="label" style={{ marginTop: 10 }}>
                星级ID（可选）
              </div>
              <input
                className="input mono"
                value={filters.levelId}
                onChange={(e) => setFilter({ levelId: e.target.value })}
                placeholder="(optional)"
              />
            </div>
            <div className="card" style={{ gridColumn: "span 6" }}>
              <div className="label">佣金类型</div>
              <select className="input" value={filters.kind} onChange={(e) => setFilter({ kind: e.target.value })}>
                <option value="">(全部)</option>
                <option value="SELF">{kindLabel("SELF")}</option>
                <option value="UPLINE_DIFF_1">{kindLabel("UPLINE_DIFF_1")}</option>
                <option value="UPLINE_DIFF_2">{kindLabel("UPLINE_DIFF_2")}</option>
                <option value="ADJUSTMENT">{kindLabel("ADJUSTMENT")}</option>
              </select>
              <div className="label" style={{ marginTop: 10 }}>
                目标类型
              </div>
              <select
                className="input"
                value={filters.targetKind}
                onChange={(e) => setFilter({ targetKind: e.target.value })}
              >
                <option value="">(全部)</option>
                <option value="SELF">{targetKindLabel("SELF")}</option>
                <option value="UPLINE_DIFF_1">{targetKindLabel("UPLINE_DIFF_1")}</option>
                <option value="UPLINE_DIFF_2">{targetKindLabel("UPLINE_DIFF_2")}</option>
              </select>
            </div>
            <div className="card" style={{ gridColumn: "span 6" }}>
              <div className="label">期别</div>
              <select
                className="input"
                value={filters.periodType}
                onChange={(e) => setFilter({ periodType: e.target.value })}
              >
                <option value="">(全部)</option>
                <option value="SUPPORT">{periodTypeLabel("SUPPORT")}</option>
                <option value="STABLE">{periodTypeLabel("STABLE")}</option>
              </select>
              <div className="label" style={{ marginTop: 10 }}>
                月末卡状态
              </div>
              <select
                className="input"
                value={filters.cardStatus}
                onChange={(e) => setFilter({ cardStatus: e.target.value })}
              >
                <option value="">(全部)</option>
                <option value="NORMAL">{cardStatusLabel("NORMAL")}</option>
                <option value="PAUSED">{cardStatusLabel("PAUSED")}</option>
                <option value="LEFT">{cardStatusLabel("LEFT")}</option>
                <option value="CONTROLLED">{cardStatusLabel("CONTROLLED")}</option>
                <option value="ABNORMAL">{cardStatusLabel("ABNORMAL")}</option>
              </select>
            </div>
          </div>
          <datalist id="report-agent-options">
            {(allAgents.data ?? []).map((x) => (
              <option key={x.id} value={x.employeeNo || x.name}>
                {agentDisplayName(x)}
              </option>
            ))}
          </datalist>
        </div>

        <div style={{ marginTop: 12 }} className="cardGrid">
          <div className="card" style={{ gridColumn: "span 7" }}>
            <div className="cardTitle">按职工汇总</div>
            <div className="cardMeta">
              收益人维度。当前汇总：行项目 <span className="mono">{agentLines}</span>，净金额{" "}
              <span className="mono">{agentTotal.toFixed(2)}</span>
            </div>
            <div style={{ marginTop: 10 }}>
              <div className="tableWrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>收益人</th>
                      <th>团队</th>
                      <th style={{ textAlign: "right" }}>行数</th>
                      <th style={{ textAlign: "right" }}>总金额</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(agents.data ?? []).map((x) => (
                      <tr key={x.beneficiaryAgentId}>
                        <td>{x.beneficiaryName}</td>
                        <td>{x.teamName ?? ""}</td>
                        <td className="mono" style={{ textAlign: "right" }}>
                          {x.lineCount}
                        </td>
                        <td className="mono" style={{ textAlign: "right" }}>
                          {Number(x.totalAmount).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                    {!agents.data && !agentSummaryError ? (
                      <tr>
                        <td colSpan={4} style={{ color: "var(--muted)", padding: 14 }}>
                          加载中…
                        </td>
                      </tr>
                    ) : null}
                    {agentSummaryError ? (
                      <tr>
                        <td colSpan={4} style={{ color: "var(--danger)", padding: 14 }}>
                          {agentSummaryError}
                        </td>
                      </tr>
                    ) : null}
                    {agents.data && agents.data.length === 0 ? (
                      <tr>
                        <td colSpan={4} style={{ color: "var(--muted)", padding: 14 }}>
                          暂无数据
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="card" style={{ gridColumn: "span 5" }}>
            <div className="cardTitle">按团队汇总</div>
            <div className="cardMeta">月末团队归属</div>
            <div style={{ marginTop: 10 }}>
              <div className="tableWrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>团队</th>
                      <th style={{ textAlign: "right" }}>成员数</th>
                      <th style={{ textAlign: "right" }}>总金额</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(teams.data ?? []).map((x, idx) => (
                      <tr key={`${x.teamId ?? "none"}-${idx}`}>
                        <td>{x.teamName ?? "(无团队)"}</td>
                        <td className="mono" style={{ textAlign: "right" }}>
                          {x.agentCount}
                        </td>
                        <td className="mono" style={{ textAlign: "right" }}>
                          {Number(x.totalAmount).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                    {!teams.data && !teamSummaryError ? (
                      <tr>
                        <td colSpan={3} style={{ color: "var(--muted)", padding: 14 }}>
                          加载中…
                        </td>
                      </tr>
                    ) : null}
                    {teamSummaryError ? (
                      <tr>
                        <td colSpan={3} style={{ color: "var(--danger)", padding: 14 }}>
                          {teamSummaryError}
                        </td>
                      </tr>
                    ) : null}
                    {teams.data && teams.data.length === 0 ? (
                      <tr>
                        <td colSpan={3} style={{ color: "var(--muted)", padding: 14 }}>
                          暂无数据
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <div className="cardTitle">导出前预览</div>
          <div className="cardMeta">
            当前结算单状态：
            <span className="mono" style={{ color: statusColor(preview.data?.runStatus ?? "") }}>
              {" "}
              {preview.data?.runStatus === "DRAFT"
                ? "草稿"
                : preview.data?.runStatus === "APPROVED"
                  ? "已审核"
                  : preview.data?.runStatus === "POSTED"
                    ? "已入账"
                    : preview.data?.runStatus ?? "-"}
            </span>
            ，预览 <span className="mono">{previewRows.length}</span> / 总计 <span className="mono">{previewTotal}</span> 条。
          </div>

          <div className="btnRow" style={{ marginTop: 10 }}>
            <button className="btn" disabled={!canPrev} onClick={() => setOffset((v) => Math.max(0, v - limit))}>
              上一页
            </button>
            <button className="btn" disabled={!canNext} onClick={() => setOffset((v) => v + limit)}>
              下一页
            </button>
            <select
              className="input"
              style={{ width: 150 }}
              value={String(limit)}
              onChange={(e) => {
                setOffset(0);
                setLimit(Number(e.target.value));
              }}
            >
              <option value="20">20 / 页</option>
              <option value="50">50 / 页</option>
              <option value="100">100 / 页</option>
            </select>
            <div style={{ color: "var(--muted)", fontSize: 12, alignSelf: "center" }}>
              偏移 {offset}
            </div>
          </div>

          <div
            style={{
              marginTop: 10,
              border: "1px dashed var(--border)",
              borderRadius: 10,
              padding: 10,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: 8,
            }}
          >
            {PREVIEW_COLUMN_OPTIONS.map((c) => (
              <label key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={previewColumns[c.key]}
                  onChange={(e) => setPreviewColumns((prev) => ({ ...prev, [c.key]: e.target.checked }))}
                />
                <span>{c.label}</span>
              </label>
            ))}
          </div>

          <div className="tableWrap" style={{ marginTop: 10 }}>
            <table className="table">
              <thead>
                <tr>
                  {PREVIEW_COLUMN_OPTIONS.filter((x) => previewColumns[x.key]).map((x) => (
                    <th key={x.key} style={{ textAlign: x.key === "amount" || x.key === "ratio" || x.key === "baseMonthlyRent" ? "right" : "left" }}>
                      {x.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((x) => (
                  <tr key={x.itemId}>
                    {PREVIEW_COLUMN_OPTIONS.filter((o) => previewColumns[o.key]).map((o) => (
                      <td
                        key={`${x.itemId}-${o.key}`}
                        style={{
                          textAlign: o.key === "amount" || o.key === "ratio" || o.key === "baseMonthlyRent" ? "right" : "left",
                          color: o.key === "amount" && x.amount < 0 ? "var(--danger)" : undefined,
                        }}
                      >
                        {renderPreviewCell(x, o.key)}
                      </td>
                    ))}
                  </tr>
                ))}
                {!preview.data && !previewLoadError ? (
                  <tr>
                    <td colSpan={Math.max(PREVIEW_COLUMN_OPTIONS.filter((o) => previewColumns[o.key]).length, 1)} style={{ color: "var(--muted)", padding: 14 }}>
                      加载中…
                    </td>
                  </tr>
                ) : null}
                {previewLoadError ? (
                  <tr>
                    <td colSpan={Math.max(PREVIEW_COLUMN_OPTIONS.filter((o) => previewColumns[o.key]).length, 1)} style={{ color: "var(--danger)", padding: 14 }}>
                      {previewLoadError}
                    </td>
                  </tr>
                ) : null}
                {preview.data && previewRows.length === 0 ? (
                  <tr>
                    <td colSpan={Math.max(PREVIEW_COLUMN_OPTIONS.filter((o) => previewColumns[o.key]).length, 1)} style={{ color: "var(--muted)", padding: 14 }}>
                      暂无数据
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
