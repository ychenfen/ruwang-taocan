"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { useRouter, useSearchParams } from "next/navigation";

import { apiFetch } from "../../../lib/api";
import { agentDisplayName, resolveAgentByKeyword, type LookupAgent } from "../../../lib/agent-lookup";
import { formatDateYmd } from "../../../lib/display";
import { humanizeApiError } from "../../../lib/errors";

type Run = Readonly<{
  id: string;
  runMonth: string;
  commissionMonth: string;
  timezone: string;
  status: "DRAFT" | "APPROVED" | "POSTED" | string;
  createdAt: string;
}>;

type ExecutionLog = Readonly<{
  id: string;
  triggerType: "MANUAL" | "AUTO";
  status: "SUCCEEDED" | "FAILED";
  commissionMonth: string;
  runId?: string;
  targetAgentId?: string;
  scannedCardCount: number;
  producedLineCount: number;
  insertedCount: number;
  deletedCount: number;
  errorCode?: string;
  errorMessage?: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
}>;

type AgentLite = LookupAgent;

type RecalcHistoryItem = Readonly<{
  commissionMonth: string;
  agentKeyword: string;
  agentId?: string;
  agentName?: string;
  at: string;
}>;

const RECALC_HISTORY_KEY = "ruwang.admin.settlement.recalc-history.v1";

function readRecalcHistory(): RecalcHistoryItem[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(RECALC_HISTORY_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x === "object")
      .map((x) => ({
        commissionMonth: String((x as any).commissionMonth ?? ""),
        agentKeyword: String((x as any).agentKeyword ?? ""),
        agentId: (x as any).agentId ? String((x as any).agentId) : undefined,
        agentName: (x as any).agentName ? String((x as any).agentName) : undefined,
        at: String((x as any).at ?? ""),
      }))
      .filter((x) => x.commissionMonth.length > 0)
      .slice(0, 10);
  } catch {
    return [];
  }
}

function runStatusLabel(status: string): string {
  if (status === "DRAFT") return "草稿";
  if (status === "APPROVED") return "已审核";
  if (status === "POSTED") return "已入账";
  return status;
}

function triggerTypeLabel(t: ExecutionLog["triggerType"] | ""): string {
  if (t === "MANUAL") return "手动";
  if (t === "AUTO") return "自动";
  return "(全部)";
}

function executionStatusLabel(s: ExecutionLog["status"] | ""): string {
  if (s === "SUCCEEDED") return "成功";
  if (s === "FAILED") return "失败";
  return "(全部)";
}

function executionErrorLabel(code?: string, message?: string): string {
  if (!code && !message) return "";
  const codeLabel =
    code === "LOCKED"
      ? "并发锁定（正在重算）"
      : code === "NOT_DRAFT"
        ? "非草稿不可重算"
        : code === "EXCEPTION"
          ? "系统异常"
          : code ?? "";
  if (!message) return codeLabel;
  return `${codeLabel}${codeLabel ? "：" : ""}${message}`;
}

function ymPrev(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}`;
}

export default function SettlementsPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const commissionMonthFilter = (sp.get("commissionMonth") ?? "").trim();
  const [runLimit] = useState(20);
  const [runOffset, setRunOffset] = useState(0);

  const runs = useSWR(
    `/admin/settlements/runs?limit=${runLimit}&offset=${runOffset}${
      commissionMonthFilter ? `&commissionMonth=${encodeURIComponent(commissionMonthFilter)}` : ""
    }`,
    (p: string) => apiFetch<Run[]>(p),
  );
  const [execStatus, setExecStatus] = useState<"" | "SUCCEEDED" | "FAILED">("");
  const [execTriggerType, setExecTriggerType] = useState<"" | "MANUAL" | "AUTO">("");
  const [execLimit] = useState(20);
  const [execOffset, setExecOffset] = useState(0);
  const executionKey = useMemo(() => {
    const q = new URLSearchParams();
    if (commissionMonthFilter) q.set("commissionMonth", commissionMonthFilter);
    if (execStatus) q.set("status", execStatus);
    if (execTriggerType) q.set("triggerType", execTriggerType);
    q.set("limit", String(execLimit));
    q.set("offset", String(execOffset));
    return `/admin/settlements/executions?${q.toString()}`;
  }, [commissionMonthFilter, execStatus, execTriggerType, execLimit, execOffset]);
  const executions = useSWR(executionKey, (p: string) => apiFetch<ExecutionLog[]>(p));
  const allAgents = useSWR("/admin/agents", (p: string) => apiFetch<AgentLite[]>(p));

  const [commissionMonth, setCommissionMonth] = useState(commissionMonthFilter || ymPrev());
  const [agentKeyword, setAgentKeyword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [blockedRunId, setBlockedRunId] = useState<string>("");
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [draftRetentionDays, setDraftRetentionDays] = useState(90);
  const [executionLogRetentionDays, setExecutionLogRetentionDays] = useState(180);
  const [cleanupResult, setCleanupResult] = useState<{
    dryRun: boolean;
    oldDraftRunCount?: number;
    oldExecutionLogCount?: number;
    deletedRunCount?: number;
    deletedDraftLogCount?: number;
    deletedOldLogCount?: number;
  } | null>(null);
  const [recalcHistory, setRecalcHistory] = useState<RecalcHistoryItem[]>([]);

  const list = runs.data ?? [];
  const latest = useMemo(() => list[0] ?? null, [list]);
  const recalcTarget = useMemo(() => {
    const keyword = agentKeyword.trim();
    if (!keyword) return null;
    return resolveAgentByKeyword(keyword, allAgents.data ?? []);
  }, [agentKeyword, allAgents.data]);

  useEffect(() => {
    setRecalcHistory(readRecalcHistory());
  }, []);

  const saveRecalcHistory = (item: RecalcHistoryItem) => {
    setRecalcHistory((prev) => {
      const key = `${item.commissionMonth}::${item.agentId ?? ""}::${item.agentKeyword}`;
      const next = [item, ...prev.filter((x) => `${x.commissionMonth}::${x.agentId ?? ""}::${x.agentKeyword}` !== key)].slice(0, 10);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(RECALC_HISTORY_KEY, JSON.stringify(next));
      }
      return next;
    });
  };

  return (
    <>
      <div className="mainHeader">
        <div>
          <div className="mainTitle">结算</div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
            草稿可重算；已审核可入账；已入账记录支持删除后重算。改星级后可按职工重算。
          </div>
        </div>
        <div className="btnRow">
          {latest ? (
            <a className="btn" href={`/settlements/${latest.id}`}>
              打开最新
            </a>
          ) : null}
        </div>
      </div>

      <div className="mainBody">
        {msg ? (
          <div style={{ marginBottom: 10, fontSize: 12, color: "var(--muted)" }}>
            {msg}
          </div>
        ) : null}
        {err ? <div className="error">{err}</div> : null}

        <div className="card" style={{ marginBottom: 12 }}>
          <div className="cardTitle">结算怎么用（常用流程）</div>
          <div className="cardMeta" style={{ lineHeight: 1.7 }}>
            1) 先选“佣金月份”(例如结算 2026-02)。<br />
            2) 如果改过星级/关系，先按“职工姓名/工号”重算该职工，再反复重算直到核对通过。<br />
            3) 核对无误后到结算单详情点“审核”，最后“入账”。<br />
            4) 已入账月份可在“结算”或“入账分录”执行删除，删除后可重新计算。<br />
            5) 新开卡当月不结算，从次月开始算佣金（例：1月开卡，2月有佣金，3月结算2月佣金）。
          </div>
        </div>

        <div className="card" style={{ marginBottom: 12 }}>
          <div className="cardTitle">生成/重算草稿</div>
          <div className="cardMeta">
            每月 5 号 00:10 自动生成上月草稿；这里用于手动触发或按职工重算。频繁重算建议按职工执行，避免全量重算。
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
            <div className="field" style={{ margin: 0 }}>
              <div className="label">结算月份（YYYY-MM）</div>
              <input className="input mono" value={commissionMonth} onChange={(e) => setCommissionMonth(e.target.value)} placeholder="2026-02" />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <div className="label">按职工重算（姓名/工号，可选）</div>
              <input
                className="input"
                list="settlement-agent-options"
                value={agentKeyword}
                onChange={(e) => setAgentKeyword(e.target.value)}
                placeholder="例如：张三 / 10086 / zhangsan"
              />
              <datalist id="settlement-agent-options">
                {(allAgents.data ?? []).map((x) => (
                  <option key={x.id} value={x.employeeNo || x.name}>
                    {agentDisplayName(x)}
                  </option>
                ))}
              </datalist>
              {agentKeyword.trim() ? (
                <div className="cardMeta" style={{ marginTop: 6 }}>
                  {recalcTarget?.ok ? `已匹配：${agentDisplayName(recalcTarget.agent)}` : recalcTarget?.message ?? ""}
                </div>
              ) : null}
            </div>
          </div>
          {blockedRunId ? (
            <div className="btnRow" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => router.push(`/settlements/${blockedRunId}`)}>
                打开该月份结算单
              </button>
            </div>
          ) : null}
          <div className="btnRow" style={{ marginTop: 10 }}>
            <button
              className="btn btnPrimary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                setMsg(null);
                setBlockedRunId("");
                try {
                  const month = commissionMonth.trim();
                  const resolved =
                    agentKeyword.trim().length > 0 ? resolveAgentByKeyword(agentKeyword.trim(), allAgents.data ?? []) : null;
                  if (resolved && !resolved.ok) {
                    setErr(resolved.message);
                    return;
                  }
                  const sameMonth = (runs.data ?? []).find((x) => x.commissionMonth === month);
                  if (sameMonth && sameMonth.status !== "DRAFT") {
                    setBlockedRunId(sameMonth.id);
                    if (sameMonth.status === "POSTED") {
                      setErr("该月份已入账，不能直接重算。请先在本页或入账分录执行“删除”，再重新计算。");
                    } else {
                      setErr("该月份当前为“已审核”，不能直接重算。请先在结算详情执行“撤销审核”。");
                    }
                    return;
                  }
                  const res = await apiFetch<{
                    runId: string;
                    commissionMonth: string;
                    scannedCardCount: number;
                    producedLineCount: number;
                    deleted: number;
                    inserted: number;
                  }>("/admin/settlements/recalculate", {
                    method: "POST",
                    body: JSON.stringify({
                      commissionMonth: month,
                      agentId: resolved?.ok ? resolved.agentId : undefined,
                    }),
                  });
                  setMsg(
                    `完成：runId=${res.runId} scanned=${res.scannedCardCount} inserted=${res.inserted} deleted=${res.deleted}${
                      resolved?.ok ? `，代理=${resolved.agent.name}` : ""
                    }`,
                  );
                  saveRecalcHistory({
                    commissionMonth: month,
                    agentKeyword: agentKeyword.trim(),
                    agentId: resolved?.ok ? resolved.agentId : undefined,
                    agentName: resolved?.ok ? resolved.agent.name : undefined,
                    at: new Date().toISOString(),
                  });
                  runs.mutate();
                  executions.mutate();
                  router.push(`/settlements/${res.runId}`);
                } catch (e) {
                  const msg = humanizeApiError(e);
                  if (msg.includes("NOT_DRAFT")) {
                    try {
                      const found = await apiFetch<Run[]>(
                        `/admin/settlements/runs?commissionMonth=${encodeURIComponent(commissionMonth.trim())}&limit=1&offset=0`,
                      );
                      if (found[0]) {
                        setBlockedRunId(found[0].id);
                        if (found[0].status === "POSTED") {
                          setErr("该月份已入账，不能直接重算。请先在本页或入账分录执行“删除”，再重新计算。");
                        } else if (found[0].status === "APPROVED") {
                          setErr("该月份当前为“已审核”，不能直接重算。请先在结算详情执行“撤销审核”。");
                        } else {
                          setErr(`该月份当前状态为 ${runStatusLabel(found[0].status)}，暂不允许重算。`);
                        }
                      } else {
                        setErr("该月份结算单状态不允许重算（NOT_DRAFT）。");
                      }
                    } catch {
                      setErr("该月份结算单状态不允许重算（NOT_DRAFT）。");
                    }
                  } else {
                    setErr(msg);
                  }
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "执行中…" : "执行重算"}
            </button>
            <button
              className="btn"
              onClick={() => {
                const m = commissionMonth.trim();
                if (!m) return;
                setRunOffset(0);
                setExecOffset(0);
                router.push(`/settlements?commissionMonth=${encodeURIComponent(m)}`);
              }}
            >
              按月筛选
            </button>
            <div className="cardMeta" style={{ alignSelf: "center" }}>
              多次点击说明：同一时间只会执行一个重算任务；并发时会提示 LOCKED。
            </div>
          </div>
          {recalcHistory.length > 0 ? (
            <div style={{ marginTop: 10 }}>
              <div className="label">最近重算参数（点一下即可回填）</div>
              <div className="btnRow" style={{ marginTop: 6, flexWrap: "wrap" }}>
                {recalcHistory.map((x, idx) => (
                  <button
                    key={`${x.commissionMonth}-${x.agentId ?? "all"}-${idx}`}
                    className="btn"
                    onClick={() => {
                      setCommissionMonth(x.commissionMonth);
                      setAgentKeyword(x.agentKeyword);
                    }}
                  >
                    {x.commissionMonth} / {x.agentName || x.agentKeyword || "全量"}
                  </button>
                ))}
                <button
                  className="btn"
                  onClick={() => {
                    setRecalcHistory([]);
                    if (typeof window !== "undefined") window.localStorage.removeItem(RECALC_HISTORY_KEY);
                  }}
                >
                  清空记录
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="card" style={{ marginBottom: 12 }}>
          <div className="cardTitle">缓存清理（安全）</div>
          <div className="cardMeta">
            只清理“历史草稿账单 + 执行日志”。已审核/已入账账单不会删除，保证账务留痕。
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
            <div className="field" style={{ margin: 0 }}>
              <div className="label">草稿账单保留天数</div>
              <input
                className="input mono"
                type="number"
                min={7}
                value={draftRetentionDays}
                onChange={(e) => setDraftRetentionDays(Math.max(7, Number(e.target.value) || 7))}
              />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <div className="label">执行日志保留天数</div>
              <input
                className="input mono"
                type="number"
                min={7}
                value={executionLogRetentionDays}
                onChange={(e) => setExecutionLogRetentionDays(Math.max(7, Number(e.target.value) || 7))}
              />
            </div>
          </div>
          <div className="btnRow" style={{ marginTop: 10 }}>
            <button
              className="btn"
              disabled={cleanupBusy}
              onClick={async () => {
                setCleanupBusy(true);
                setErr(null);
                setMsg(null);
                try {
                  const res = await apiFetch<any>("/admin/settlements/cleanup", {
                    method: "POST",
                    body: JSON.stringify({
                      dryRun: true,
                      draftRetentionDays,
                      executionLogRetentionDays,
                    }),
                  });
                  setCleanupResult(res);
                  setMsg(`预估：草稿 ${res.oldDraftRunCount ?? 0}，执行日志 ${res.oldExecutionLogCount ?? 0}`);
                } catch (e) {
                  setErr(humanizeApiError(e));
                } finally {
                  setCleanupBusy(false);
                }
              }}
            >
              预估清理量
            </button>
            <button
              className="btn btnDanger"
              disabled={cleanupBusy}
              onClick={async () => {
                if (!confirm("确定执行清理吗？只会清理历史草稿和执行日志。")) return;
                setCleanupBusy(true);
                setErr(null);
                setMsg(null);
                try {
                  const res = await apiFetch<any>("/admin/settlements/cleanup", {
                    method: "POST",
                    body: JSON.stringify({
                      dryRun: false,
                      draftRetentionDays,
                      executionLogRetentionDays,
                    }),
                  });
                  setCleanupResult(res);
                  setMsg(
                    `清理完成：删除草稿 ${res.deletedRunCount ?? 0}，删除日志 ${
                      (res.deletedDraftLogCount ?? 0) + (res.deletedOldLogCount ?? 0)
                    }`,
                  );
                  await runs.mutate();
                  await executions.mutate();
                } catch (e) {
                  setErr(humanizeApiError(e));
                } finally {
                  setCleanupBusy(false);
                }
              }}
            >
              执行清理
            </button>
            {cleanupBusy ? <div className="cardMeta">处理中…</div> : null}
          </div>
          {cleanupResult ? (
            <div className="cardMeta" style={{ marginTop: 10, lineHeight: 1.6 }}>
              {cleanupResult.dryRun
                ? `预估结果：草稿 ${cleanupResult.oldDraftRunCount ?? 0}，日志 ${cleanupResult.oldExecutionLogCount ?? 0}`
                : `执行结果：草稿 ${cleanupResult.deletedRunCount ?? 0}，草稿日志 ${cleanupResult.deletedDraftLogCount ?? 0}，历史日志 ${
                    cleanupResult.deletedOldLogCount ?? 0
                  }`}
            </div>
          ) : null}
        </div>

        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>佣金月份</th>
                <th>状态</th>
                <th>运行月份</th>
                <th>创建时间</th>
                <th className="mono">runId</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.id}>
                  <td className="mono">{x.commissionMonth}</td>
                  <td>{runStatusLabel(x.status)}</td>
                  <td className="mono">{x.runMonth}</td>
                  <td className="mono">{formatDateYmd(x.createdAt)}</td>
                  <td className="mono">{x.id}</td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <a className="btn" href={`/settlements/${x.id}`}>
                        打开
                      </a>
                      {x.status === "DRAFT" ? (
                        <button
                          className="btn btnDanger"
                          disabled={busy}
                          onClick={async () => {
                            if (!confirm("确定删除该草稿账单吗？删除后该月行项目会一并删除，且不可恢复。")) return;
                            setBusy(true);
                            setErr(null);
                            setMsg(null);
                            try {
                              await apiFetch(`/admin/settlements/runs/${x.id}`, { method: "DELETE" });
                              setMsg(`已删除：${x.commissionMonth}`);
                              await runs.mutate();
                              await executions.mutate();
                            } catch (e) {
                              setErr(humanizeApiError(e));
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          删除
                        </button>
                      ) : null}
                      {x.status !== "DRAFT" ? (
                        <>
                          <button
                            className="btn btnDanger"
                            disabled={busy}
                            onClick={async () => {
                              if (
                                !confirm(
                                  `确定彻底删除 ${x.commissionMonth} 的结算数据吗？会删除结算单、行项目、入账分录和执行日志，删除后可重新计算。`,
                                )
                              )
                                return;
                              setBusy(true);
                              setErr(null);
                              setMsg(null);
                              try {
                                await apiFetch(`/admin/settlements/runs/${x.id}/hard-delete`, { method: "DELETE" });
                                setMsg(`已彻底删除：${x.commissionMonth}，现在可以重新计算`);
                                await runs.mutate();
                                await executions.mutate();
                              } catch (e) {
                                setErr(humanizeApiError(e));
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            彻底删除
                          </button>
                          <a className="btn" href="/ledger">
                            去入账分录查看
                          </a>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {list.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ color: "var(--muted)", padding: 14 }}>
                    暂无结算单
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="btnRow" style={{ marginTop: 10 }}>
          <button className="btn" disabled={runOffset === 0} onClick={() => setRunOffset((v) => Math.max(v - runLimit, 0))}>
            上一页
          </button>
          <button className="btn" disabled={(list.length ?? 0) < runLimit} onClick={() => setRunOffset((v) => v + runLimit)}>
            下一页
          </button>
          <div className="cardMeta">offset={runOffset} limit={runLimit}</div>
        </div>

        <div className="card" style={{ marginTop: 14 }}>
          <div className="cardTitle">跑批执行记录</div>
          <div className="cardMeta">包含耗时、扫描行数、插入/删除行数与失败原因（LOCKED/NOT_DRAFT/EXCEPTION）。</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10, marginBottom: 10 }}>
            <div className="field" style={{ margin: 0 }}>
              <div className="label">执行来源</div>
              <select
                className="input"
                value={execTriggerType}
                onChange={(e) => {
                  setExecOffset(0);
                  setExecTriggerType(e.target.value as any);
                }}
              >
                <option value="">{triggerTypeLabel("")}</option>
                <option value="MANUAL">{triggerTypeLabel("MANUAL")}</option>
                <option value="AUTO">{triggerTypeLabel("AUTO")}</option>
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <div className="label">执行结果</div>
              <select
                className="input"
                value={execStatus}
                onChange={(e) => {
                  setExecOffset(0);
                  setExecStatus(e.target.value as any);
                }}
              >
                <option value="">{executionStatusLabel("")}</option>
                <option value="SUCCEEDED">{executionStatusLabel("SUCCEEDED")}</option>
                <option value="FAILED">{executionStatusLabel("FAILED")}</option>
              </select>
            </div>
          </div>

          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>开始时间</th>
                  <th>来源</th>
                  <th>结果</th>
                  <th>月份</th>
                  <th style={{ textAlign: "right" }}>耗时(ms)</th>
                  <th style={{ textAlign: "right" }}>扫描卡数</th>
                  <th style={{ textAlign: "right" }}>新增行数</th>
                  <th style={{ textAlign: "right" }}>删除行数</th>
                  <th>失败原因</th>
                  <th className="mono">runId</th>
                </tr>
              </thead>
              <tbody>
                {(executions.data ?? []).map((x) => (
                  <tr key={x.id}>
                    <td className="mono">{formatDateYmd(x.startedAt)}</td>
                    <td className="mono">{triggerTypeLabel(x.triggerType)}</td>
                    <td className="mono">{executionStatusLabel(x.status)}</td>
                    <td className="mono">{x.commissionMonth}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{x.durationMs}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{x.scannedCardCount}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{x.insertedCount}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{x.deletedCount}</td>
                    <td className="mono">{executionErrorLabel(x.errorCode, x.errorMessage)}</td>
                    <td className="mono">{x.runId ?? ""}</td>
                  </tr>
                ))}
                {(executions.data ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ color: "var(--muted)", padding: 14 }}>
                      暂无执行记录（可先手动执行一次重算）
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="btnRow" style={{ marginTop: 10 }}>
            <button className="btn" disabled={execOffset === 0} onClick={() => setExecOffset((v) => Math.max(v - execLimit, 0))}>
              上一页
            </button>
            <button
              className="btn"
              disabled={(executions.data?.length ?? 0) < execLimit}
              onClick={() => setExecOffset((v) => v + execLimit)}
            >
              下一页
            </button>
            <div className="cardMeta">offset={execOffset} limit={execLimit}</div>
          </div>
        </div>
      </div>
    </>
  );
}
