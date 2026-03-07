"use client";

import { useState } from "react";
import useSWR from "swr";

import { apiFetch } from "../../../lib/api";
import { executionStatusLabel, runStatusLabel, triggerTypeLabel } from "../../../lib/display";

type AdminStats = Readonly<{
  agentsTotal: number;
  cardsTotal: number;
  teamsTotal: number;
  cardsOnNet: number;
  latestRun?: Readonly<{
    id: string;
    commissionMonth: string;
    status: "DRAFT" | "APPROVED" | "POSTED" | string;
    createdAt: string;
  }>;
  latestExecution?: Readonly<{
    commissionMonth: string;
    status: "SUCCEEDED" | "FAILED" | string;
    triggerType: "MANUAL" | "AUTO" | string;
    startedAt: string;
    durationMs: number;
  }>;
}>;

type RunStatus = Readonly<{
  id: string;
  commissionMonth: string;
  status: "DRAFT" | "APPROVED" | "POSTED" | string;
}>;

type AdminTrend = Readonly<{
  commissionMonth: string;
  runStatus: "DRAFT" | "APPROVED" | "POSTED" | string;
  lineCount: number;
  adjustmentLineCount: number;
  totalAmount: number;
  latestExecution?: Readonly<{
    status: "SUCCEEDED" | "FAILED" | string;
    triggerType: "MANUAL" | "AUTO" | string;
    durationMs: number;
    startedAt: string;
  }>;
}>;

type AdminAlert = Readonly<{
  code: "FAILED_EXECUTION_RECENT" | "DRAFT_RUN_STALE" | "HIGH_ADJUSTMENT_RATIO" | "EXPORT_VOLUME_SPIKE" | string;
  severity: "HIGH" | "MEDIUM" | string;
  title: string;
  description: string;
  meta?: Record<string, unknown>;
}>;

function ymPrev(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}`;
}

function explainEngineError(code: string): string {
  if (code === "NOT_DRAFT") return "NOT_DRAFT（该月份不是草稿，不能重算）";
  if (code === "LOCKED") return "LOCKED（当前有任务在执行）";
  if (code === "EXCEPTION") return "EXCEPTION（系统异常）";
  return code;
}

function formatMetaValue(key: string, v: unknown): string {
  if (v === null || v === undefined) return "-";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "-";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") {
    if (key.toLowerCase().includes("errorcode")) return explainEngineError(v);
    return v;
  }
  try {
    return JSON.stringify(v);
  } catch {
    return "[object]";
  }
}

function severityLabel(severity: string): string {
  if (severity === "HIGH") return "高风险";
  if (severity === "MEDIUM") return "中风险";
  return severity;
}

function runStatusColor(status: string): string {
  if (status === "POSTED") return "#166534";
  if (status === "APPROVED") return "#1d4ed8";
  if (status === "DRAFT") return "#9a3412";
  return "var(--muted)";
}

export default function DashboardPage() {
  const [trendMonths, setTrendMonths] = useState<3 | 6 | 12>(6);
  const stats = useSWR("/admin/stats", (p) => apiFetch<AdminStats>(p));
  const runs = useSWR("/admin/settlements/runs?limit=1&offset=0", (p) => apiFetch<RunStatus[]>(p));
  const trends = useSWR(`/admin/stats/trends?months=${trendMonths}`, (p: string) => apiFetch<AdminTrend[]>(p));
  const alerts = useSWR("/admin/stats/alerts", (p) => apiFetch<AdminAlert[]>(p));
  const latestRun = stats.data?.latestRun ?? runs.data?.[0] ?? null;
  const trendRows = trends.data ?? [];
  const trendTotalAmount = trendRows.reduce((s, x) => s + x.totalAmount, 0);
  const trendTotalLines = trendRows.reduce((s, x) => s + x.lineCount, 0);
  const trendTotalAdjustments = trendRows.reduce((s, x) => s + x.adjustmentLineCount, 0);
  const maxAbsAmount = Math.max(...trendRows.map((x) => Math.abs(x.totalAmount)), 0);

  return (
    <>
      <div className="mainHeader">
        <div>
          <div className="mainTitle">总览</div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
            这是一套可复算、可审计的佣金结算账本。
          </div>
        </div>
        <div className="btnRow">
          <a className="btn btnPrimary" href={`/settlements?commissionMonth=${encodeURIComponent(ymPrev())}`}>
            去结算
          </a>
          <a className="btn" href="/reports">
            去导出
          </a>
        </div>
      </div>

      <div className="mainBody">
        <div className="cardGrid">
          <div className="card">
            <div className="cardTitle">职工</div>
            <div className="cardMeta">总数</div>
            <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", marginTop: 10 }}>
              {stats.data ? stats.data.agentsTotal : "…"}
            </div>
          </div>
          <div className="card">
            <div className="cardTitle">网卡</div>
            <div className="cardMeta">总数 / 在网</div>
            <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", marginTop: 10 }}>
              {stats.data ? `${stats.data.cardsTotal} / ${stats.data.cardsOnNet}` : "…"}
            </div>
          </div>
          <div className="card">
            <div className="cardTitle">团队</div>
            <div className="cardMeta">总数</div>
            <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", marginTop: 10 }}>
              {stats.data ? stats.data.teamsTotal : "…"}
            </div>
          </div>
          <div className="card">
            <div className="cardTitle">结算单</div>
            <div className="cardMeta">最新一条</div>
              <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "baseline" }}>
                <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em" }}>
                  {latestRun ? latestRun.commissionMonth : "—"}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{latestRun ? runStatusLabel(latestRun.status) : ""}</div>
              </div>
            {latestRun ? (
              <div style={{ marginTop: 12 }}>
                <a className="btn" href={`/settlements/${latestRun.id}`}>
                  打开明细
                </a>
              </div>
            ) : null}
          </div>
        </div>

        {stats.data?.latestExecution ? (
          <div style={{ marginTop: 14, color: "var(--muted)", fontSize: 12, lineHeight: 1.6 }}>
            最近跑批：{stats.data.latestExecution.commissionMonth} / {executionStatusLabel(stats.data.latestExecution.status)} /{" "}
            {triggerTypeLabel(stats.data.latestExecution.triggerType)} / {stats.data.latestExecution.durationMs} ms
          </div>
        ) : null}

        <div style={{ marginTop: 14, color: "var(--muted)", fontSize: 12, lineHeight: 1.6 }}>
          提示：结算每月 5 号 00:10（本地时区）自动生成上月草稿，也可在结算页手动重算。
        </div>

        <div className="card" style={{ marginTop: 14 }}>
          <div className="cardTitle">运营预警</div>
          <div className="cardMeta">基于最近跑批、草稿积压、调整占比、导出频次生成。</div>
          {(alerts.data ?? []).length > 0 ? (
            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              {(alerts.data ?? []).map((x, idx) => (
                <div
                  key={`${x.code}-${idx}`}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    padding: 10,
                    background: "#fff",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      className="mono"
                      style={{
                        fontSize: 11,
                        padding: "3px 8px",
                        borderRadius: 999,
                        color: x.severity === "HIGH" ? "#991b1b" : "#9a3412",
                        background: x.severity === "HIGH" ? "rgba(220, 38, 38, 0.12)" : "rgba(249, 115, 22, 0.14)",
                      }}
                    >
                      {severityLabel(x.severity)}
                    </span>
                    <span style={{ fontWeight: 700 }}>{x.title}</span>
                  </div>
                  <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 12 }}>{x.description}</div>
                  {x.meta && Object.keys(x.meta).length > 0 ? (
                    <div
                      style={{
                        marginTop: 8,
                        border: "1px dashed var(--border)",
                        borderRadius: 10,
                        padding: 8,
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                        gap: 6,
                        background: "rgba(17, 24, 39, 0.02)",
                      }}
                    >
                      {Object.entries(x.meta).map(([k, v]) => (
                        <div key={k}>
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>{k}</div>
                          <div className="mono" style={{ fontSize: 12 }}>
                            {formatMetaValue(k, v)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ marginTop: 10, color: "var(--muted)", fontSize: 12 }}>当前无预警</div>
          )}
        </div>

        <div className="card" style={{ marginTop: 14 }}>
          <div className="cardTitle">结算趋势</div>
          <div className="cardMeta">金额为净额（含调整单影响）；按佣金月份升序展示。</div>
          <div
            style={{
              marginTop: 10,
              border: "1px dashed var(--border)",
              borderRadius: 10,
              padding: 10,
              display: "grid",
              gap: 8,
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              background: "rgba(17, 24, 39, 0.02)",
            }}
          >
            <div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>净金额合计</div>
              <div className="mono" style={{ fontSize: 14, fontWeight: 700 }}>
                {trendTotalAmount.toFixed(2)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>行项目合计</div>
              <div className="mono" style={{ fontSize: 14, fontWeight: 700 }}>
                {trendTotalLines}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>调整行合计</div>
              <div className="mono" style={{ fontSize: 14, fontWeight: 700 }}>
                {trendTotalAdjustments}
              </div>
            </div>
          </div>
          <div className="btnRow" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => setTrendMonths(3)} disabled={trendMonths === 3}>
              近 3 月
            </button>
            <button className="btn" onClick={() => setTrendMonths(6)} disabled={trendMonths === 6}>
              近 6 月
            </button>
            <button className="btn" onClick={() => setTrendMonths(12)} disabled={trendMonths === 12}>
              近 12 月
            </button>
          </div>
          <div className="tableWrap" style={{ marginTop: 10 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>佣金月</th>
                  <th>结算单状态</th>
                  <th style={{ textAlign: "right" }}>行项目数</th>
                  <th style={{ textAlign: "right" }}>调整行</th>
                  <th style={{ textAlign: "right" }}>净金额</th>
                  <th style={{ textAlign: "right" }}>金额占比</th>
                  <th>最近跑批</th>
                </tr>
              </thead>
              <tbody>
                {trendRows.map((x) => (
                  <tr key={x.commissionMonth}>
                    <td className="mono">{x.commissionMonth}</td>
                    <td className="mono" style={{ color: runStatusColor(x.runStatus), fontWeight: 700 }}>
                      {runStatusLabel(x.runStatus)}
                    </td>
                    <td className="mono" style={{ textAlign: "right" }}>
                      {x.lineCount}
                    </td>
                    <td className="mono" style={{ textAlign: "right" }}>
                      {x.adjustmentLineCount}
                    </td>
                    <td className="mono" style={{ textAlign: "right" }}>
                      {x.totalAmount.toFixed(2)}
                    </td>
                    <td>
                      <div
                        style={{
                          height: 8,
                          borderRadius: 999,
                          background: "rgba(17, 24, 39, 0.08)",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${maxAbsAmount > 0 ? Math.round((Math.abs(x.totalAmount) / maxAbsAmount) * 100) : 0}%`,
                            background: x.totalAmount >= 0 ? "linear-gradient(90deg, #0b4dd6, #13b5a6)" : "#f97316",
                          }}
                        />
                      </div>
                    </td>
                    <td className="mono">
                      {x.latestExecution
                        ? `${executionStatusLabel(x.latestExecution.status)}/${triggerTypeLabel(x.latestExecution.triggerType)}/${x.latestExecution.durationMs}ms`
                        : "-"}
                    </td>
                  </tr>
                ))}
                {trendRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ color: "var(--muted)", padding: 14 }}>
                      暂无趋势数据
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
