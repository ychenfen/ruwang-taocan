"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";

import { apiDownload, apiFetch } from "../../../lib/api";
import { agentDisplayName, resolveAgentByKeyword, type LookupAgent } from "../../../lib/agent-lookup";
import { formatDateYmd } from "../../../lib/display";
import { humanizeApiError } from "../../../lib/errors";

type LedgerEntry = Readonly<{
  id: string;
  sourceType: "SETTLEMENT_POST" | "SETTLEMENT_ADJUST";
  sourceId: string;
  settlementRunId: string;
  commissionMonth: string;
  note?: string;
  createdBy?: string;
  createdAt: string;
  lineCount: number;
  totalAmount: number;
}>;

type LedgerLine = Readonly<{
  id: string;
  settlementItemId: string;
  beneficiaryAgentId: string;
  beneficiaryName: string;
  kind: string;
  targetKind: string;
  periodType: string;
  amount: number;
  createdAt: string;
  cardId: string;
  cardNo: string;
  commissionMonth: string;
}>;

type AgentSummary = Readonly<{
  beneficiaryAgentId: string;
  beneficiaryName: string;
  lineCount: number;
  entryCount: number;
  totalAmount: number;
}>;

type AgentLite = LookupAgent;

function sourceTypeLabel(sourceType: string): string {
  if (sourceType === "SETTLEMENT_POST") return "结算入账";
  if (sourceType === "SETTLEMENT_ADJUST") return "调整入账";
  return sourceType;
}

function sourceTypeShortLabel(sourceType: string): string {
  if (sourceType === "SETTLEMENT_POST") return "结算";
  if (sourceType === "SETTLEMENT_ADJUST") return "调整";
  return sourceType;
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

export default function LedgerPage() {
  const [commissionMonth, setCommissionMonth] = useState(ymPrev());
  const [sourceType, setSourceType] = useState("");
  const [settlementRunId, setSettlementRunId] = useState("");
  const [beneficiaryKeyword, setBeneficiaryKeyword] = useState("");
  const [limit, setLimit] = useState(30);
  const [offset, setOffset] = useState(0);
  const [selectedEntryId, setSelectedEntryId] = useState<string>("");
  const [lineLimit, setLineLimit] = useState(100);
  const [lineOffset, setLineOffset] = useState(0);
  const [exportingFormat, setExportingFormat] = useState<"" | "csv" | "xlsx">("");
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const allAgents = useSWR("/admin/agents", (p: string) => apiFetch<AgentLite[]>(p));

  const resolvedBeneficiary = useMemo(() => {
    const keyword = beneficiaryKeyword.trim();
    if (!keyword) return null;
    return resolveAgentByKeyword(keyword, allAgents.data ?? []);
  }, [beneficiaryKeyword, allAgents.data]);

  const beneficiaryAgentId =
    beneficiaryKeyword.trim().length === 0
      ? undefined
      : resolvedBeneficiary?.ok
        ? resolvedBeneficiary.agentId
        : "__NO_MATCH__";

  const qs = useMemo(
    () =>
      buildQuery({
        commissionMonth: commissionMonth.trim() || undefined,
        sourceType: sourceType || undefined,
        settlementRunId: settlementRunId.trim() || undefined,
        beneficiaryAgentId,
        limit: String(limit),
        offset: String(offset),
      }),
    [commissionMonth, sourceType, settlementRunId, beneficiaryAgentId, limit, offset],
  );
  const filterQs = useMemo(
    () =>
      buildQuery({
        commissionMonth: commissionMonth.trim() || undefined,
        sourceType: sourceType || undefined,
        settlementRunId: settlementRunId.trim() || undefined,
        beneficiaryAgentId,
      }),
    [commissionMonth, sourceType, settlementRunId, beneficiaryAgentId],
  );

  const entries = useSWR(`/admin/ledger/entries${qs}`, (p: string) => apiFetch<LedgerEntry[]>(p));
  const summary = useSWR(`/admin/ledger/summary/agents${filterQs}`, (p: string) => apiFetch<AgentSummary[]>(p));
  const lines = useSWR(
    selectedEntryId ? `/admin/ledger/entries/${selectedEntryId}/lines?limit=${lineLimit}&offset=${lineOffset}` : null,
    (p: string) => apiFetch<LedgerLine[]>(p),
  );

  const exportLedger = async (format: "csv" | "xlsx") => {
    try {
      setExportingFormat(format);
      setErr(null);
      const { blob, filename } = await apiDownload(`/admin/ledger/entries.${format}${filterQs}`, { method: "GET" });
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      const month = commissionMonth.trim() || "all";
      a.download = filename ?? `ledger-entries-${month}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch (e) {
      setErr(humanizeApiError(e));
    } finally {
      setExportingFormat("");
    }
  };

  return (
    <>
      <div className="mainHeader">
        <div>
          <div className="mainTitle">入账分录</div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
            所有结算过的记录会备份到这里；支持删除后重新计算。
          </div>
        </div>
        <div className="btnRow">
          <button className="btn" onClick={() => entries.mutate()}>
            刷新
          </button>
          <button className="btn btnPrimary" onClick={() => exportLedger("csv")} disabled={exportingFormat.length > 0}>
            {exportingFormat === "csv" ? "导出中…" : "导出 CSV"}
          </button>
          <button className="btn" onClick={() => exportLedger("xlsx")} disabled={exportingFormat.length > 0}>
            {exportingFormat === "xlsx" ? "导出中…" : "导出 XLSX"}
          </button>
        </div>
      </div>

      <div className="mainBody">
        {msg ? <div style={{ marginBottom: 10, fontSize: 12, color: "var(--muted)" }}>{msg}</div> : null}
        {err ? <div className="error" style={{ marginBottom: 10 }}>{err}</div> : null}
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="cardTitle">筛选</div>
          <div className="cardGrid" style={{ marginTop: 10 }}>
            <div className="card" style={{ gridColumn: "span 3" }}>
              <div className="label">佣金月份</div>
              <input
                className="input mono"
                value={commissionMonth}
                onChange={(e) => {
                  setOffset(0);
                  setCommissionMonth(e.target.value);
                }}
                placeholder="2026-02"
              />
            </div>
            <div className="card" style={{ gridColumn: "span 3" }}>
              <div className="label">分录来源</div>
              <select
                className="input mono"
                value={sourceType}
                onChange={(e) => {
                  setOffset(0);
                  setSourceType(e.target.value);
                }}
              >
                <option value="">(全部)</option>
                <option value="SETTLEMENT_POST">{sourceTypeLabel("SETTLEMENT_POST")}</option>
                <option value="SETTLEMENT_ADJUST">{sourceTypeLabel("SETTLEMENT_ADJUST")}</option>
              </select>
            </div>
            <div className="card" style={{ gridColumn: "span 3" }}>
              <div className="label">结算单ID</div>
              <input
                className="input mono"
                value={settlementRunId}
                onChange={(e) => {
                  setOffset(0);
                  setSettlementRunId(e.target.value);
                }}
                placeholder="(可选)"
              />
            </div>
            <div className="card" style={{ gridColumn: "span 3" }}>
              <div className="label">收益职工（姓名/工号）</div>
              <input
                className="input"
                list="ledger-agent-options"
                value={beneficiaryKeyword}
                onChange={(e) => {
                  setOffset(0);
                  setBeneficiaryKeyword(e.target.value);
                }}
                placeholder="例如：张三 / 10086 / zhangsan"
              />
              <datalist id="ledger-agent-options">
                {(allAgents.data ?? []).map((x) => (
                  <option key={x.id} value={x.employeeNo || x.name}>
                    {agentDisplayName(x)}
                  </option>
                ))}
              </datalist>
              {beneficiaryKeyword.trim() ? (
                <div className="cardMeta" style={{ marginTop: 6 }}>
                  {resolvedBeneficiary?.ok
                    ? `已匹配：${agentDisplayName(resolvedBeneficiary.agent)}`
                    : resolvedBeneficiary?.message ?? ""}
                </div>
              ) : null}
            </div>
          </div>

          <div className="btnRow" style={{ marginTop: 10 }}>
            <button
              className="btn"
              onClick={() => {
                setOffset(0);
                entries.mutate();
              }}
            >
              应用筛选
            </button>
            <button
              className="btn"
              onClick={() => {
                setCommissionMonth(ymPrev());
                setSourceType("");
                setSettlementRunId("");
                setBeneficiaryKeyword("");
                setOffset(0);
              }}
            >
              重置
            </button>
            <div className="cardMeta">
              当前查询: <span className="mono">{qs}</span>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <input
                className="input mono"
                style={{ width: 92 }}
                type="number"
                value={limit}
                onChange={(e) => {
                  setOffset(0);
                  setLimit(Math.max(Number(e.target.value) || 1, 1));
                }}
              />
              <div className="cardMeta" style={{ alignSelf: "center" }}>
                每页条数
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 12 }}>
          <div className="cardTitle">按代理汇总</div>
          <div className="cardMeta">用于快速对账：分录行数、涉及分录单数、总金额。</div>
          {summary.error ? <div className="error" style={{ marginTop: 10 }}>{humanizeApiError(summary.error)}</div> : null}
          <div className="tableWrap" style={{ marginTop: 10 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>收益人</th>
                  <th style={{ textAlign: "right" }}>分录单数</th>
                  <th style={{ textAlign: "right" }}>行数</th>
                  <th style={{ textAlign: "right" }}>总金额</th>
                </tr>
              </thead>
              <tbody>
                {(summary.data ?? []).map((x) => (
                  <tr key={x.beneficiaryAgentId}>
                    <td>{x.beneficiaryName}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{x.entryCount}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{x.lineCount}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{x.totalAmount.toFixed(2)}</td>
                  </tr>
                ))}
                {!summary.data ? (
                  <tr>
                    <td colSpan={4} style={{ color: "var(--muted)", padding: 14 }}>加载中…</td>
                  </tr>
                ) : null}
                {summary.data && summary.data.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ color: "var(--muted)", padding: 14 }}>暂无汇总数据</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        {entries.error ? <div className="error">{humanizeApiError(entries.error)}</div> : null}

        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>创建时间</th>
                <th>来源</th>
                <th>佣金月份</th>
                <th className="mono">结算单ID</th>
                <th style={{ textAlign: "right" }}>行数</th>
                <th style={{ textAlign: "right" }}>总金额</th>
                <th style={{ textAlign: "right" }}>操作</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(entries.data ?? []).map((x) => (
                <tr key={x.id}>
                  <td className="mono">{formatDateYmd(x.createdAt)}</td>
                  <td>{sourceTypeShortLabel(x.sourceType)}</td>
                  <td className="mono">{x.commissionMonth}</td>
                  <td className="mono">{x.settlementRunId}</td>
                  <td className="mono" style={{ textAlign: "right" }}>
                    {x.lineCount}
                  </td>
                  <td className="mono" style={{ textAlign: "right" }}>
                    {x.totalAmount.toFixed(2)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="btn btnDanger"
                      onClick={async () => {
                        if (
                          !confirm(
                            `确定彻底删除该分录吗？会清空 ${x.commissionMonth} 结算月的结算单、分录和执行日志，删除后需重新计算。`,
                          )
                        )
                          return;
                        try {
                          setErr(null);
                          setMsg(null);
                          const res = await apiFetch<{ orphan?: boolean }>(`/admin/ledger/entries/${x.id}`, { method: "DELETE" });
                          if (selectedEntryId === x.id) {
                            setSelectedEntryId("");
                            setLineOffset(0);
                          }
                          await Promise.all([entries.mutate(), summary.mutate()]);
                          if (res.orphan) {
                            setMsg(`已清理缓存分录：${x.commissionMonth}（原关联结算单已不存在）`);
                          } else {
                            setMsg(`已彻底删除：${x.commissionMonth}，现在可回到结算页重新计算`);
                          }
                        } catch (e) {
                          setErr(humanizeApiError(e));
                        }
                      }}
                    >
                      彻底删除
                    </button>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="btn"
                      onClick={() => {
                        setSelectedEntryId(x.id);
                        setLineOffset(0);
                      }}
                    >
                      明细
                    </button>
                  </td>
                </tr>
              ))}
              {!entries.data ? (
                <tr>
                  <td colSpan={8} style={{ color: "var(--muted)", padding: 14 }}>
                    加载中…
                  </td>
                </tr>
              ) : null}
              {entries.data && entries.data.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ color: "var(--muted)", padding: 14 }}>
                    暂无分录
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="btnRow" style={{ marginTop: 10 }}>
          <button className="btn" disabled={offset === 0} onClick={() => setOffset((v) => Math.max(v - limit, 0))}>
            上一页
          </button>
          <button className="btn" disabled={(entries.data?.length ?? 0) < limit} onClick={() => setOffset((v) => v + limit)}>
            下一页
          </button>
          <div className="cardMeta">offset={offset} limit={limit}</div>
        </div>

        <div className="card" style={{ marginTop: 14 }}>
          <div className="cardTitle">分录明细</div>
          <div className="cardMeta">
            当前 entry: <span className="mono">{selectedEntryId || "(未选择)"}</span>
          </div>

          <div className="btnRow" style={{ marginTop: 10 }}>
            <input
              className="input mono"
              style={{ width: 110 }}
              type="number"
              value={lineLimit}
              onChange={(e) => {
                setLineOffset(0);
                setLineLimit(Math.max(Number(e.target.value) || 1, 1));
              }}
            />
            <div className="cardMeta" style={{ alignSelf: "center" }}>
              每页条数
            </div>
            <button className="btn" disabled={!selectedEntryId} onClick={() => lines.mutate()}>
              刷新明细
            </button>
          </div>

          {lines.error ? <div className="error" style={{ marginTop: 10 }}>{humanizeApiError(lines.error)}</div> : null}

          <div className="tableWrap" style={{ marginTop: 10 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>卡号</th>
                  <th>收益人</th>
                  <th>佣金类型</th>
                  <th>目标类型</th>
                  <th>期别</th>
                  <th style={{ textAlign: "right" }}>金额</th>
                  <th className="mono">行项目ID</th>
                </tr>
              </thead>
              <tbody>
                {(lines.data ?? []).map((x) => (
                  <tr key={x.id}>
                    <td className="mono">{x.cardNo}</td>
                    <td>{x.beneficiaryName}</td>
                    <td className="mono">{kindLabel(x.kind)}</td>
                    <td className="mono">{kindLabel(x.targetKind)}</td>
                    <td className="mono">{periodTypeLabel(x.periodType)}</td>
                    <td className="mono" style={{ textAlign: "right" }}>
                      {x.amount.toFixed(2)}
                    </td>
                    <td className="mono">{x.settlementItemId}</td>
                  </tr>
                ))}
                {!selectedEntryId ? (
                  <tr>
                    <td colSpan={7} style={{ color: "var(--muted)", padding: 14 }}>
                      请先选择一条分录
                    </td>
                  </tr>
                ) : null}
                {selectedEntryId && lines.data && lines.data.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ color: "var(--muted)", padding: 14 }}>
                      该分录暂无明细
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="btnRow" style={{ marginTop: 10 }}>
            <button className="btn" disabled={lineOffset === 0} onClick={() => setLineOffset((v) => Math.max(v - lineLimit, 0))}>
              上一页
            </button>
            <button className="btn" disabled={(lines.data?.length ?? 0) < lineLimit} onClick={() => setLineOffset((v) => v + lineLimit)}>
              下一页
            </button>
            <div className="cardMeta">offset={lineOffset} limit={lineLimit}</div>
          </div>
        </div>
      </div>
    </>
  );
}
