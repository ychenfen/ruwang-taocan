"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { useParams } from "next/navigation";

import { apiDownload, apiFetch } from "../../../../lib/api";
import { agentDisplayName, resolveAgentByKeyword, type LookupAgent } from "../../../../lib/agent-lookup";
import { formatDateYmd } from "../../../../lib/display";
import { humanizeApiError } from "../../../../lib/errors";

type Run = Readonly<{
  id: string;
  runMonth: string;
  commissionMonth: string;
  timezone: string;
  status: "DRAFT" | "APPROVED" | "POSTED" | string;
  createdAt: string;
  approvedAt?: string;
  postedAt?: string;
}>;

type Item = Readonly<{
  id: string;
  commissionMonth: string;
  cardId: string;
  beneficiaryAgentId: string;
  kind: "SELF" | "UPLINE_DIFF_1" | "UPLINE_DIFF_2" | "ADJUSTMENT";
  periodType: "SUPPORT" | "STABLE";
  baseMonthlyRent: number;
  ratio: number;
  amount: number;
  snapshot: any;
  adjustmentOfItemId?: string;
  adjustmentReason?: string;
  createdAt: string;
}>;

type AgentLite = LookupAgent;

type DiffRow = Readonly<{
  cardId: string;
  cardNo: string;
  beneficiaryAgentId: string;
  beneficiaryName: string;
  targetKind: string;
  baseAmount: number;
  adjustmentAmount: number;
  netAmount: number;
  changed: boolean;
}>;

type ItemViewRow = Readonly<
  Item & {
    cardNo: string;
    beneficiaryName: string;
    ownerAgentName: string;
    targetKind: string;
    cardStatusAtMonthEnd: string;
  }
>;

type ItemFilterState = Readonly<{
  query: string;
  beneficiaryAgentId: string;
  kind: "" | Item["kind"];
  periodType: "" | Item["periodType"];
  amountSign: "ALL" | "POSITIVE" | "NEGATIVE" | "ZERO";
  onlyAdjustment: boolean;
  sortBy: "CREATED_ASC" | "AMOUNT_DESC" | "AMOUNT_ASC";
}>;

type ItemColumnKey =
  | "cardNo"
  | "beneficiaryName"
  | "ownerAgentName"
  | "kind"
  | "targetKind"
  | "periodType"
  | "cardStatusAtMonthEnd"
  | "baseMonthlyRent"
  | "ratio"
  | "amount"
  | "adjustmentReason"
  | "createdAt";

const FILTERS_STORAGE_KEY = "ruwang.admin.settlement.items.filters.v1";
const COLUMNS_STORAGE_KEY = "ruwang.admin.settlement.items.columns.v1";

const DEFAULT_FILTERS: ItemFilterState = {
  query: "",
  beneficiaryAgentId: "",
  kind: "",
  periodType: "",
  amountSign: "ALL",
  onlyAdjustment: false,
  sortBy: "CREATED_ASC",
};

const COLUMN_OPTIONS: ReadonlyArray<Readonly<{ key: ItemColumnKey; label: string }>> = [
  { key: "cardNo", label: "卡号" },
  { key: "beneficiaryName", label: "收益人" },
  { key: "ownerAgentName", label: "归属代理" },
  { key: "kind", label: "佣金类型" },
  { key: "targetKind", label: "目标类型" },
  { key: "periodType", label: "期别" },
  { key: "cardStatusAtMonthEnd", label: "月末状态" },
  { key: "baseMonthlyRent", label: "月租基数" },
  { key: "ratio", label: "比例" },
  { key: "amount", label: "金额" },
  { key: "adjustmentReason", label: "调整原因" },
  { key: "createdAt", label: "创建时间" },
];

const DEFAULT_COLUMNS: Record<ItemColumnKey, boolean> = {
  cardNo: true,
  beneficiaryName: true,
  ownerAgentName: false,
  kind: true,
  targetKind: true,
  periodType: true,
  cardStatusAtMonthEnd: false,
  baseMonthlyRent: true,
  ratio: true,
  amount: true,
  adjustmentReason: true,
  createdAt: false,
};

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

function runStatusLabel(status: string): string {
  if (status === "DRAFT") return "草稿";
  if (status === "APPROVED") return "已审核";
  if (status === "POSTED") return "已入账";
  return status;
}

function kindLabel(kind: string): string {
  if (kind === "SELF") return "本人佣金";
  if (kind === "UPLINE_DIFF_1") return "一级差价";
  if (kind === "UPLINE_DIFF_2") return "二级差价";
  if (kind === "ADJUSTMENT") return "调整";
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

export default function SettlementRunPage() {
  const params = useParams();
  const runId = String((params as any)?.runId ?? "");

  const run = useSWR(runId ? `/admin/settlements/runs/${runId}` : null, (p: string) => apiFetch<Run>(p));
  const items = useSWR(runId ? `/admin/settlements/runs/${runId}/items` : null, (p: string) => apiFetch<Item[]>(p));
  const agents = useSWR("/admin/agents", (p: string) => apiFetch<AgentLite[]>(p));

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [draftRecalcAgentKeyword, setDraftRecalcAgentKeyword] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustAgentKeyword, setAdjustAgentKeyword] = useState("");
  const [showDiff, setShowDiff] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<"" | "csv" | "xlsx">("");
  const [diffBeneficiaryAgentId, setDiffBeneficiaryAgentId] = useState("");
  const [summaryAgentKeyword, setSummaryAgentKeyword] = useState("");

  const [itemFilters, setItemFilters] = useState<ItemFilterState>(DEFAULT_FILTERS);
  const [itemColumns, setItemColumns] = useState<Record<ItemColumnKey, boolean>>(DEFAULT_COLUMNS);
  const [itemOffset, setItemOffset] = useState(0);
  const [itemLimit, setItemLimit] = useState(50);
  const [hydrated, setHydrated] = useState(false);

  const diffKey = useMemo(() => {
    if (!showDiff || !runId) return null;
    const sp = new URLSearchParams();
    if (diffBeneficiaryAgentId.trim()) sp.set("beneficiaryAgentId", diffBeneficiaryAgentId.trim());
    const q = sp.toString();
    return `/admin/settlements/runs/${runId}/diff${q ? `?${q}` : ""}`;
  }, [showDiff, runId, diffBeneficiaryAgentId]);

  const diff = useSWR(diffKey, (p: string) =>
    apiFetch<{ rows: DiffRow[] }>(p),
  );

  const resolvedAdjustTarget = useMemo(() => {
    const keyword = adjustAgentKeyword.trim();
    if (!keyword) return null;
    return resolveAgentByKeyword(keyword, agents.data ?? []);
  }, [adjustAgentKeyword, agents.data]);
  const resolvedDraftRecalcTarget = useMemo(() => {
    const keyword = draftRecalcAgentKeyword.trim();
    if (!keyword) return null;
    return resolveAgentByKeyword(keyword, agents.data ?? []);
  }, [draftRecalcAgentKeyword, agents.data]);
  const resolvedSummaryTarget = useMemo(() => {
    const keyword = summaryAgentKeyword.trim();
    if (!keyword) return null;
    return resolveAgentByKeyword(keyword, agents.data ?? []);
  }, [summaryAgentKeyword, agents.data]);
  const resolvedKeywordTarget = useMemo(() => {
    const keyword = itemFilters.query.trim();
    if (!keyword) return null;
    return resolveAgentByKeyword(keyword, agents.data ?? []);
  }, [itemFilters.query, agents.data]);

  useEffect(() => {
    const f = safeParseJson<Partial<ItemFilterState>>(
      typeof window !== "undefined" ? window.localStorage.getItem(FILTERS_STORAGE_KEY) : null,
      {},
    );
    const c = safeParseJson<Partial<Record<ItemColumnKey, boolean>>>(
      typeof window !== "undefined" ? window.localStorage.getItem(COLUMNS_STORAGE_KEY) : null,
      {},
    );
    setItemFilters((prev) => ({ ...prev, ...f }));
    setItemColumns((prev) => ({ ...prev, ...c }));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(itemFilters));
  }, [itemFilters, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(itemColumns));
  }, [itemColumns, hydrated]);

  const agentNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of agents.data ?? []) {
      if (a?.id && a?.name) map[String(a.id)] = String(a.name);
    }
    return map;
  }, [agents.data]);

  const rows = items.data ?? [];
  const totals = useMemo(() => {
    const byBeneficiary: Record<string, number> = {};
    for (const it of rows) byBeneficiary[it.beneficiaryAgentId] = (byBeneficiary[it.beneficiaryAgentId] ?? 0) + it.amount;
    const list = Object.entries(byBeneficiary).map(([id, amount]) => ({
      beneficiaryAgentId: id,
      beneficiaryName: agentNameById[id] ?? id,
      amount,
    }));
    list.sort((a, b) => b.amount - a.amount);
    return list;
  }, [rows, agentNameById]);

  const viewRows = useMemo<ItemViewRow[]>(
    () =>
      rows.map((x) => {
        const snap = x.snapshot ?? {};
        const cardNo = String(snap.cardNo ?? "");
        const ownerAgentName = String(snap.ownerAgentName ?? "");
        const beneficiaryName = agentNameById[x.beneficiaryAgentId] ?? x.beneficiaryAgentId;
        const targetKind = x.kind === "ADJUSTMENT" ? String(snap.targetKind ?? "") : x.kind;
        const cardStatusAtMonthEnd = String(snap.statusAtMonthEnd ?? snap.cardStatusAtMonthEnd ?? "");
        return {
          ...x,
          cardNo,
          beneficiaryName,
          ownerAgentName,
          targetKind,
          cardStatusAtMonthEnd,
        };
      }),
    [rows, agentNameById],
  );

  const filteredRows = useMemo(() => {
    const q = itemFilters.query.trim().toLowerCase();
    const out = viewRows.filter((x) => {
      if (itemFilters.beneficiaryAgentId && x.beneficiaryAgentId !== itemFilters.beneficiaryAgentId) return false;
      if (q) {
        const hit =
          x.cardNo.toLowerCase().includes(q) ||
          x.beneficiaryName.toLowerCase().includes(q) ||
          x.ownerAgentName.toLowerCase().includes(q) ||
          String(x.adjustmentReason ?? "").toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (itemFilters.kind && x.kind !== itemFilters.kind) return false;
      if (itemFilters.periodType && x.periodType !== itemFilters.periodType) return false;
      if (itemFilters.onlyAdjustment && x.kind !== "ADJUSTMENT") return false;
      if (itemFilters.amountSign === "POSITIVE" && x.amount <= 0) return false;
      if (itemFilters.amountSign === "NEGATIVE" && x.amount >= 0) return false;
      if (itemFilters.amountSign === "ZERO" && x.amount !== 0) return false;
      return true;
    });
    out.sort((a, b) => {
      if (itemFilters.sortBy === "AMOUNT_DESC") return b.amount - a.amount;
      if (itemFilters.sortBy === "AMOUNT_ASC") return a.amount - b.amount;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    return out;
  }, [viewRows, itemFilters]);

  const visibleColumns = COLUMN_OPTIONS.filter((c) => itemColumns[c.key]);
  const canPrev = itemOffset > 0;
  const canNext = itemOffset + itemLimit < filteredRows.length;
  const pagedRows = filteredRows.slice(itemOffset, itemOffset + itemLimit);

  const filteredTotal = useMemo(() => filteredRows.reduce((s, x) => s + x.amount, 0), [filteredRows]);
  const filteredAdjustmentCount = useMemo(
    () => filteredRows.filter((x) => x.kind === "ADJUSTMENT").length,
    [filteredRows],
  );
  const filteredKinds = useMemo(() => {
    const bucket: Record<string, number> = {};
    for (const x of filteredRows) bucket[x.kind] = (bucket[x.kind] ?? 0) + 1;
    return bucket;
  }, [filteredRows]);

  const diffTotals = useMemo(() => {
    const rows = diff.data?.rows ?? [];
    const base = rows.reduce((s, x) => s + Number(x.baseAmount), 0);
    const adjust = rows.reduce((s, x) => s + Number(x.adjustmentAmount), 0);
    const net = rows.reduce((s, x) => s + Number(x.netAmount), 0);
    return { rowCount: rows.length, base, adjust, net };
  }, [diff.data]);

  const summaryRows = useMemo(() => {
    const q = summaryAgentKeyword.trim().toLowerCase();
    if (!q) return totals;
    return totals.filter((x) => x.beneficiaryName.toLowerCase().includes(q) || x.beneficiaryAgentId.toLowerCase().includes(q));
  }, [totals, summaryAgentKeyword]);

  const setFilter = (patch: Partial<ItemFilterState>) => {
    setItemOffset(0);
    setItemFilters((prev) => ({ ...prev, ...patch }));
  };

  const doAction = async (fn: () => Promise<any>) => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fn();
      setMsg(typeof res === "string" ? res : "操作完成");
      await run.mutate();
      await items.mutate();
      if (showDiff) await diff.mutate();
    } catch (e) {
      const msg = e instanceof Error ? e.message : humanizeApiError(e);
      setErr(msg);
    } finally {
      setBusy(false);
    }
  };

  const downloadBill = async (format: "csv" | "xlsx") => {
    if (!cm) return;
    setExportingFormat(format);
    setErr(null);
    try {
      const { blob, filename } = await apiDownload(
        `/admin/reports/bill.${format}?commissionMonth=${encodeURIComponent(cm)}`,
        { method: "GET" },
      );
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename ?? `bill-${cm}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (e) {
      setErr(humanizeApiError(e));
    } finally {
      setExportingFormat("");
    }
  };

  const status = run.data?.status ?? "";
  const cm = run.data?.commissionMonth ?? "";

  return (
    <>
      <div className="mainHeader">
        <div>
          <div className="mainTitle">结算单</div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
            {cm ? <span className="mono">{cm}</span> : "—"}{" "}
            {status ? (
              <span style={{ color: statusColor(status), fontWeight: 700 }}>
                ({runStatusLabel(status)} / {status})
              </span>
            ) : null}
          </div>
        </div>
        <div className="btnRow">
          {cm ? (
            <>
              <button className="btn" disabled={exportingFormat.length > 0} onClick={() => downloadBill("csv")}>
                {exportingFormat === "csv" ? "导出中…" : "账单 CSV"}
              </button>
              <button className="btn" disabled={exportingFormat.length > 0} onClick={() => downloadBill("xlsx")}>
                {exportingFormat === "xlsx" ? "导出中…" : "账单 XLSX"}
              </button>
            </>
          ) : null}

          {status === "DRAFT" ? (
            <>
              <button
                className="btn btnPrimary"
                disabled={busy || !cm}
                onClick={() =>
                  doAction(async () => {
                    const r = await apiFetch<any>("/admin/settlements/recalculate", {
                      method: "POST",
                      body: JSON.stringify({ commissionMonth: cm }),
                    });
                    return `已重算：inserted=${r.inserted} deleted=${r.deleted}`;
                  })
                }
              >
                {busy ? "执行中…" : "全量重算本月"}
              </button>
              <button
                className="btn btnDanger"
                disabled={busy}
                onClick={() => {
                  if (!confirm("确定删除该草稿账单吗？删除后本月行项目会一并删除，且不可恢复。")) return;
                  void doAction(async () => {
                    await apiFetch(`/admin/settlements/runs/${runId}`, { method: "DELETE" });
                    window.location.href = "/settlements";
                    return "已删除草稿账单";
                  });
                }}
              >
                删除草稿账单
              </button>
            </>
          ) : null}
          {status && status !== "DRAFT" ? (
            <>
              <button
                className="btn btnDanger"
                disabled={busy}
                onClick={() => {
                  if (!confirm("确定彻底删除该结算月全部数据吗？会删除结算单、分录和日志，删除后可重新计算。")) return;
                  void doAction(async () => {
                    await apiFetch(`/admin/settlements/runs/${runId}/hard-delete`, { method: "DELETE" });
                    window.location.href = "/settlements";
                    return "已彻底删除，现可重新计算";
                  });
                }}
              >
                彻底删除并重算
              </button>
              <a className="btn" href="/ledger">
                去入账分录查看
              </a>
            </>
          ) : null}
        </div>
      </div>

      <div className="mainBody">
        {msg ? <div style={{ marginBottom: 10, fontSize: 12, color: "var(--muted)" }}>{msg}</div> : null}
        {err ? <div className="error">{err}</div> : null}

        {status === "DRAFT" ? (
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="cardTitle">草稿重算助手（常用）</div>
            <div className="cardMeta">
              改星级/关系后，优先按职工重算。需要反复点时可直接在这里输入姓名/工号。并发重算会提示 LOCKED。
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, marginTop: 10 }}>
              <div>
                <input
                  className="input"
                  list="draft-recalc-agent-options"
                  value={draftRecalcAgentKeyword}
                  onChange={(e) => setDraftRecalcAgentKeyword(e.target.value)}
                  placeholder="输入职工姓名/工号/账号（可空，空则全量）"
                />
                <datalist id="draft-recalc-agent-options">
                  {(agents.data ?? []).map((x) => (
                    <option key={x.id} value={x.employeeNo || x.name}>
                      {agentDisplayName(x)}
                    </option>
                  ))}
                </datalist>
                {draftRecalcAgentKeyword.trim() ? (
                  <div className="cardMeta" style={{ marginTop: 6 }}>
                    {resolvedDraftRecalcTarget?.ok
                      ? `已匹配：${agentDisplayName(resolvedDraftRecalcTarget.agent)}`
                      : resolvedDraftRecalcTarget?.message ?? ""}
                  </div>
                ) : null}
              </div>
              <button
                className="btn btnPrimary"
                disabled={busy || !cm}
                onClick={() =>
                  doAction(async () => {
                    const resolved =
                      draftRecalcAgentKeyword.trim().length > 0
                        ? resolveAgentByKeyword(draftRecalcAgentKeyword.trim(), agents.data ?? [])
                        : null;
                    if (resolved && !resolved.ok) throw new Error(resolved.message);
                    const r = await apiFetch<any>("/admin/settlements/recalculate", {
                      method: "POST",
                      body: JSON.stringify({
                        commissionMonth: cm,
                        agentId: resolved?.ok ? resolved.agentId : undefined,
                      }),
                    });
                    return `重算完成：inserted=${r.inserted} deleted=${r.deleted}${resolved?.ok ? `，代理=${resolved.agent.name}` : "（全量）"}`;
                  })
                }
              >
                {busy ? "执行中…" : "执行重算"}
              </button>
            </div>
          </div>
        ) : null}

        <div className="cardGrid" style={{ marginBottom: 12 }}>
          <div className="card" style={{ gridColumn: "span 7" }}>
            <div className="cardTitle">元信息</div>
            <div className="cardMeta" style={{ marginTop: 6 }}>
              <div className="mono">结算单ID: {runId}</div>
              {run.data ? (
                <>
                  <div className="mono">结算月份: {run.data.commissionMonth}</div>
                  <div className="mono">运行月份(创建月): {run.data.runMonth}</div>
                  <div className="mono">时区: {run.data.timezone}</div>
                  <div className="mono">创建时间: {formatDateYmd(run.data.createdAt)}</div>
                  {run.data.approvedAt ? (
                    <div className="mono">审核时间: {formatDateYmd(run.data.approvedAt)}</div>
                  ) : null}
                  {run.data.postedAt ? (
                    <div className="mono">入账时间: {formatDateYmd(run.data.postedAt)}</div>
                  ) : null}
                </>
              ) : (
                <div style={{ color: "var(--muted)" }}>加载中…</div>
              )}
            </div>

            <div className="btnRow" style={{ marginTop: 12 }}>
              {status === "DRAFT" ? (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    doAction(async () => {
                      await apiFetch(`/admin/settlements/runs/${runId}/approve`, { method: "POST" });
                      return "已审核";
                    })
                  }
                >
                  审核
                </button>
              ) : null}

              {status === "APPROVED" ? (
                <>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() =>
                      doAction(async () => {
                        await apiFetch(`/admin/settlements/runs/${runId}/unapprove`, { method: "POST" });
                        return "已撤销审核";
                      })
                    }
                  >
                    撤销审核
                  </button>
                  <button
                    className="btn btnPrimary"
                    disabled={busy}
                    onClick={() =>
                      doAction(async () => {
                        await apiFetch(`/admin/settlements/runs/${runId}/post`, { method: "POST" });
                        return "已入账(POSTED)";
                      })
                    }
                  >
                    入账
                  </button>
                </>
              ) : null}

              {status === "POSTED" ? (
                <button className="btn" onClick={() => setShowDiff((v) => !v)}>
                  {showDiff ? "隐藏差异" : "查看差异"}
                </button>
              ) : null}
            </div>
          </div>

          <div className="card" style={{ gridColumn: "span 5" }}>
            <div className="cardTitle">汇总</div>
            <div className="cardMeta">按收益人汇总（含调整）</div>
            <div className="field" style={{ marginTop: 10 }}>
              <div className="label">搜索（按姓名/工号/账号）</div>
              <input
                className="input"
                list="summary-beneficiary-options"
                value={summaryAgentKeyword}
                onChange={(e) => setSummaryAgentKeyword(e.target.value)}
                placeholder="输入职工姓名或ID"
              />
              <datalist id="summary-beneficiary-options">
                {(agents.data ?? []).map((x) => (
                  <option key={x.id} value={x.employeeNo || x.name}>
                    {agentDisplayName(x)}
                  </option>
                ))}
              </datalist>
              {summaryAgentKeyword.trim() ? (
                <div className="cardMeta" style={{ marginTop: 6 }}>
                  {resolvedSummaryTarget?.ok
                    ? `已匹配：${agentDisplayName(resolvedSummaryTarget.agent)}`
                    : resolvedSummaryTarget?.message ?? ""}
                </div>
              ) : null}
            </div>
            <div className="btnRow">
              <button
                className="btn"
                disabled={!resolvedSummaryTarget?.ok}
                onClick={() => {
                  if (!resolvedSummaryTarget?.ok) return;
                  setFilter({ beneficiaryAgentId: resolvedSummaryTarget.agentId });
                }}
              >
                仅看该收益人
              </button>
              <button className="btn" onClick={() => setSummaryAgentKeyword("")}>
                清空搜索
              </button>
            </div>
            <div style={{ marginTop: 10, maxHeight: 220, overflow: "auto" }}>
              {summaryRows.length === 0 ? (
                <div style={{ color: "var(--muted)", fontSize: 12 }}>暂无</div>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>收益人</th>
                      <th style={{ textAlign: "right" }}>金额</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaryRows.slice(0, 10).map((x) => (
                      <tr key={x.beneficiaryAgentId}>
                        <td>{x.beneficiaryName}</td>
                        <td className="mono" style={{ textAlign: "right" }}>
                          {x.amount.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {status === "POSTED" ? (
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="cardTitle">出调整单</div>
            <div className="cardMeta">已入账后禁止覆盖，系统按差额（delta）自动写入“调整”行。</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
              <div className="field" style={{ margin: 0 }}>
                <div className="label">原因 (必填)</div>
                <input
                  className="input"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="例如：卡状态异常修正"
                />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <div className="label">按职工调整（姓名/工号，可选）</div>
                <input
                  className="input"
                  list="adjust-agent-options"
                  value={adjustAgentKeyword}
                  onChange={(e) => setAdjustAgentKeyword(e.target.value)}
                  placeholder="例如：张三 / 10086 / zhangsan"
                />
                <datalist id="adjust-agent-options">
                  {(agents.data ?? []).map((x) => (
                    <option key={x.id} value={x.employeeNo || x.name}>
                      {agentDisplayName(x)}
                    </option>
                  ))}
                </datalist>
                {adjustAgentKeyword.trim() ? (
                  <div className="cardMeta" style={{ marginTop: 6 }}>
                    {resolvedAdjustTarget?.ok
                      ? `已匹配：${agentDisplayName(resolvedAdjustTarget.agent)}`
                      : resolvedAdjustTarget?.message ?? ""}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="btnRow" style={{ marginTop: 10 }}>
              <button
                className="btn btnPrimary"
                disabled={busy || adjustReason.trim().length === 0}
                onClick={() =>
                  doAction(async () => {
                    const resolved =
                      adjustAgentKeyword.trim().length > 0
                        ? resolveAgentByKeyword(adjustAgentKeyword.trim(), agents.data ?? [])
                        : null;
                    if (resolved && !resolved.ok) throw new Error(resolved.message);
                    const r = await apiFetch<any>(`/admin/settlements/runs/${runId}/adjust`, {
                      method: "POST",
                      body: JSON.stringify({
                        reason: adjustReason.trim(),
                        agentId: resolved?.ok ? resolved.agentId : undefined,
                      }),
                    });
                    return `已生成调整行：inserted=${r.inserted}${resolved?.ok ? `，代理=${resolved.agent.name}` : ""}`;
                  })
                }
              >
                {busy ? "执行中…" : "生成调整单"}
              </button>
              <button className="btn" onClick={() => setShowDiff(true)}>
                刷新差异
              </button>
            </div>
          </div>
        ) : null}

        {showDiff ? (
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="cardTitle">差异视图</div>
            <div className="cardMeta">原始金额 vs 调整金额 vs 净额（按卡号与收益人合并）</div>
            <div className="btnRow" style={{ marginTop: 10 }}>
              <select
                className="input"
                style={{ maxWidth: 300 }}
                value={diffBeneficiaryAgentId}
                onChange={(e) => setDiffBeneficiaryAgentId(e.target.value)}
              >
                <option value="">(全部收益人)</option>
                {totals.map((x) => (
                  <option key={x.beneficiaryAgentId} value={x.beneficiaryAgentId}>
                    {x.beneficiaryName}
                  </option>
                ))}
              </select>
              <button className="btn" onClick={() => diff.mutate()}>
                刷新差异
              </button>
              <div className="cardMeta" style={{ alignSelf: "center" }}>
                行数 <span className="mono">{diffTotals.rowCount}</span> / 原始{" "}
                <span className="mono">{diffTotals.base.toFixed(2)}</span> / 调整{" "}
                <span className="mono">{diffTotals.adjust.toFixed(2)}</span> / 净额{" "}
                <span className="mono">{diffTotals.net.toFixed(2)}</span>
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              {diff.error ? <div className="error">{humanizeApiError(diff.error)}</div> : null}
              {!diff.data ? (
                <div style={{ color: "var(--muted)", fontSize: 12 }}>加载中…</div>
              ) : (
                <div className="tableWrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>卡号</th>
                        <th>收益人</th>
                        <th>目标类型</th>
                        <th style={{ textAlign: "right" }}>原始</th>
                        <th style={{ textAlign: "right" }}>调整</th>
                        <th style={{ textAlign: "right" }}>净额</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(diff.data.rows ?? []).map((x, idx) => (
                        <tr key={`${x.cardId}-${x.beneficiaryAgentId}-${x.targetKind}-${idx}`}>
                          <td className="mono">{x.cardNo}</td>
                          <td>{x.beneficiaryName}</td>
                          <td className="mono">{kindLabel(x.targetKind)}</td>
                          <td className="mono" style={{ textAlign: "right" }}>
                            {Number(x.baseAmount).toFixed(2)}
                          </td>
                          <td
                            className="mono"
                            style={{ textAlign: "right", color: x.adjustmentAmount === 0 ? "var(--muted)" : "var(--danger)" }}
                          >
                            {Number(x.adjustmentAmount).toFixed(2)}
                          </td>
                          <td className="mono" style={{ textAlign: "right" }}>
                            {Number(x.netAmount).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                      {diff.data.rows?.length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ color: "var(--muted)", padding: 14 }}>
                            暂无差异
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : null}

        <div className="card" style={{ marginBottom: 12 }}>
          <div className="cardTitle">行项目筛选与列配置</div>
          <div className="cardMeta">
            当前显示 <span className="mono">{pagedRows.length}</span> / 过滤后{" "}
            <span className="mono">{filteredRows.length}</span> / 原始总数 <span className="mono">{rows.length}</span>。
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr repeat(5, 1fr)", gap: 10, marginTop: 10 }}>
            <div className="field" style={{ margin: 0 }}>
              <div className="label">关键词（卡号/收益人/归属/调整原因）</div>
              <input
                className="input"
                value={itemFilters.query}
                onChange={(e) => setFilter({ query: e.target.value })}
                placeholder="输入关键词"
              />
              <div className="btnRow" style={{ marginTop: 6 }}>
                <button
                  className="btn"
                  disabled={!resolvedKeywordTarget?.ok}
                  onClick={() => {
                    if (!resolvedKeywordTarget?.ok) return;
                    setFilter({ beneficiaryAgentId: resolvedKeywordTarget.agentId });
                  }}
                >
                  仅查看收益人为当前输入
                </button>
                <button className="btn" onClick={() => setFilter({ beneficiaryAgentId: "" })}>
                  清除收益人条件
                </button>
              </div>
              {itemFilters.beneficiaryAgentId ? (
                <div className="cardMeta" style={{ marginTop: 6 }}>
                  当前收益人过滤：{agentNameById[itemFilters.beneficiaryAgentId] ?? itemFilters.beneficiaryAgentId}
                </div>
              ) : null}
            </div>
            <div className="field" style={{ margin: 0 }}>
              <div className="label">佣金类型</div>
              <select className="input" value={itemFilters.kind} onChange={(e) => setFilter({ kind: e.target.value as ItemFilterState["kind"] })}>
                <option value="">(全部)</option>
                <option value="SELF">{kindLabel("SELF")}</option>
                <option value="UPLINE_DIFF_1">{kindLabel("UPLINE_DIFF_1")}</option>
                <option value="UPLINE_DIFF_2">{kindLabel("UPLINE_DIFF_2")}</option>
                <option value="ADJUSTMENT">{kindLabel("ADJUSTMENT")}</option>
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <div className="label">期别</div>
              <select
                className="input"
                value={itemFilters.periodType}
                onChange={(e) => setFilter({ periodType: e.target.value as ItemFilterState["periodType"] })}
              >
                <option value="">(全部)</option>
                <option value="SUPPORT">{periodTypeLabel("SUPPORT")}</option>
                <option value="STABLE">{periodTypeLabel("STABLE")}</option>
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <div className="label">金额方向</div>
              <select
                className="input"
                value={itemFilters.amountSign}
                onChange={(e) => setFilter({ amountSign: e.target.value as ItemFilterState["amountSign"] })}
              >
                <option value="ALL">全部</option>
                <option value="POSITIVE">正数</option>
                <option value="NEGATIVE">负数</option>
                <option value="ZERO">零值</option>
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <div className="label">排序</div>
              <select
                className="input"
                value={itemFilters.sortBy}
                onChange={(e) => setFilter({ sortBy: e.target.value as ItemFilterState["sortBy"] })}
              >
                <option value="CREATED_ASC">创建时间升序</option>
                <option value="AMOUNT_DESC">金额降序</option>
                <option value="AMOUNT_ASC">金额升序</option>
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <div className="label">页大小</div>
              <select
                className="input"
                value={String(itemLimit)}
                onChange={(e) => {
                  setItemOffset(0);
                  setItemLimit(Number(e.target.value));
                }}
              >
                <option value="20">20 / 页</option>
                <option value="50">50 / 页</option>
                <option value="100">100 / 页</option>
              </select>
            </div>
          </div>

          <div className="btnRow" style={{ marginTop: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={itemFilters.onlyAdjustment}
                onChange={(e) => setFilter({ onlyAdjustment: e.target.checked })}
              />
              只看调整行
            </label>
            <button className="btn" onClick={() => setFilter(DEFAULT_FILTERS)}>
              重置筛选
            </button>
            <button className="btn" onClick={() => setItemColumns(DEFAULT_COLUMNS)}>
              重置列
            </button>
            <button className="btn" disabled={!canPrev} onClick={() => setItemOffset((v) => Math.max(0, v - itemLimit))}>
              上一页
            </button>
            <button className="btn" disabled={!canNext} onClick={() => setItemOffset((v) => v + itemLimit)}>
              下一页
            </button>
            <div style={{ color: "var(--muted)", fontSize: 12, alignSelf: "center" }}>偏移 {itemOffset}</div>
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
            {COLUMN_OPTIONS.map((c) => (
              <label key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={itemColumns[c.key]}
                  onChange={(e) => setItemColumns((prev) => ({ ...prev, [c.key]: e.target.checked }))}
                />
                <span>{c.label}</span>
              </label>
            ))}
          </div>

          <div style={{ marginTop: 10, color: "var(--muted)", fontSize: 12 }}>
            过滤汇总：金额 <span className="mono">{filteredTotal.toFixed(2)}</span>，调整行{" "}
            <span className="mono">{filteredAdjustmentCount}</span>，种类分布{" "}
            <span className="mono">{Object.entries(filteredKinds).map(([k, v]) => `${kindLabel(k)}:${v}`).join(" / ") || "-"}</span>
          </div>
        </div>

        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                {visibleColumns.map((c) => (
                  <th
                    key={c.key}
                    style={{
                      textAlign:
                        c.key === "baseMonthlyRent" || c.key === "ratio" || c.key === "amount" ? "right" : "left",
                    }}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((x) => (
                <tr key={x.id}>
                  {visibleColumns.map((c) => {
                    if (c.key === "cardNo") return <td key={`${x.id}-${c.key}`} className="mono">{x.cardNo}</td>;
                    if (c.key === "beneficiaryName") return <td key={`${x.id}-${c.key}`}>{x.beneficiaryName}</td>;
                    if (c.key === "ownerAgentName") return <td key={`${x.id}-${c.key}`}>{x.ownerAgentName}</td>;
                    if (c.key === "kind") return <td key={`${x.id}-${c.key}`} className="mono">{kindLabel(x.kind)}</td>;
                    if (c.key === "targetKind") return <td key={`${x.id}-${c.key}`} className="mono">{kindLabel(x.targetKind)}</td>;
                    if (c.key === "periodType") return <td key={`${x.id}-${c.key}`} className="mono">{periodTypeLabel(x.periodType)}</td>;
                    if (c.key === "cardStatusAtMonthEnd") {
                      return <td key={`${x.id}-${c.key}`} className="mono">{cardStatusLabel(x.cardStatusAtMonthEnd)}</td>;
                    }
                    if (c.key === "baseMonthlyRent") {
                      return (
                        <td key={`${x.id}-${c.key}`} className="mono" style={{ textAlign: "right" }}>
                          {Number(x.baseMonthlyRent).toFixed(2)}
                        </td>
                      );
                    }
                    if (c.key === "ratio") {
                      return (
                        <td key={`${x.id}-${c.key}`} className="mono" style={{ textAlign: "right" }}>
                          {Number(x.ratio).toFixed(6)}
                        </td>
                      );
                    }
                    if (c.key === "amount") {
                      return (
                        <td
                          key={`${x.id}-${c.key}`}
                          className="mono"
                          style={{ textAlign: "right", color: x.amount < 0 ? "var(--danger)" : undefined }}
                        >
                          {Number(x.amount).toFixed(2)}
                        </td>
                      );
                    }
                    if (c.key === "adjustmentReason") {
                      return (
                        <td key={`${x.id}-${c.key}`} style={{ color: x.adjustmentReason ? "var(--danger)" : "var(--muted)" }}>
                          {x.adjustmentReason ?? ""}
                        </td>
                      );
                    }
                    return (
                      <td key={`${x.id}-${c.key}`} className="mono">
                        {formatDateYmd(x.createdAt)}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {pagedRows.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(visibleColumns.length, 1)} style={{ color: "var(--muted)", padding: 14 }}>
                    暂无行项目
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
