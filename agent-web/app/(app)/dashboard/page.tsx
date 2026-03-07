"use client";

import { useState } from "react";
import useSWR from "swr";

import { apiFetch } from "../../../lib/api";
import { runStatusLabel } from "../../../lib/display";

type AgentStats = Readonly<{
  me: Readonly<{
    id: string;
    name: string;
    levelName: string;
    teamName?: string;
  }>;
  myOnNetCardCount: number;
  downlineLevel1Count: number;
  downlineLevel2Count: number;
  teamMemberCount: number;
  teamOnNetCardCount: number;
}>;

type AgentTrend = Readonly<{
  commissionMonth: string;
  runStatus: "DRAFT" | "APPROVED" | "POSTED" | string;
  lineCount: number;
  adjustmentLineCount: number;
  totalAmount: number;
}>;

function runStatusColor(status: string): string {
  if (status === "POSTED") return "#166534";
  if (status === "APPROVED") return "#1d4ed8";
  if (status === "DRAFT") return "#9a3412";
  return "var(--muted)";
}

export default function DashboardPage() {
  const [trendMonths, setTrendMonths] = useState<3 | 6 | 12>(6);
  const stats = useSWR("/agent/stats", (p) => apiFetch<AgentStats>(p));
  const trends = useSWR(`/agent/stats/trends?months=${trendMonths}`, (p: string) => apiFetch<AgentTrend[]>(p));
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
            {stats.data?.me ? (
              <>
                {stats.data.me.name} · {stats.data.me.levelName}
                {stats.data.me.teamName ? ` · ${stats.data.me.teamName}` : ""}
              </>
            ) : (
              "加载中…"
            )}
          </div>
        </div>
      </div>

      <div className="mainBody">
        <div className="cardGrid">
          <div className="card" style={{ gridColumn: "span 4" }}>
            <div className="cardTitle">我的在网卡</div>
            <div style={{ fontSize: 28, fontWeight: 800, marginTop: 8 }}>{stats.data?.myOnNetCardCount ?? 0}</div>
            <div className="cardMeta">默认仅统计当前状态 正常（在网）</div>
          </div>
          <div className="card" style={{ gridColumn: "span 4" }}>
            <div className="cardTitle">一级同事</div>
            <div style={{ fontSize: 28, fontWeight: 800, marginTop: 8 }}>{stats.data?.downlineLevel1Count ?? 0}</div>
            <div className="cardMeta">可查看其在网卡（卡号脱敏）</div>
          </div>
          <div className="card" style={{ gridColumn: "span 4" }}>
            <div className="cardTitle">二级同事</div>
            <div style={{ fontSize: 28, fontWeight: 800, marginTop: 8 }}>{stats.data?.downlineLevel2Count ?? 0}</div>
            <div className="cardMeta">可吃二级差价（同星级无差价）</div>
          </div>
          <div className="card" style={{ gridColumn: "span 6" }}>
            <div className="cardTitle">团队成员</div>
            <div style={{ fontSize: 28, fontWeight: 800, marginTop: 8 }}>{stats.data?.teamMemberCount ?? 0}</div>
            <div className="cardMeta">团队在网卡：{stats.data?.teamOnNetCardCount ?? 0}（本人完整号；非本人脱敏）</div>
          </div>
          <div className="card" style={{ gridColumn: "span 6" }}>
            <div className="cardTitle">口径提示</div>
            <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 12, lineHeight: 1.7 }}>
              结算每月 5 号自动跑上月，扶持期固定 11 个月（开卡当月不计佣，从次月开始），稳定期月份按星级配置。
              <br />
              当月出现任何异常状态（停机/离网/管控/异常），该月整月不结算。
            </div>
          </div>

          <div className="card" style={{ gridColumn: "span 12" }}>
            <div className="cardTitle">我的佣金趋势</div>
            <div className="cardMeta">金额为净额（含调整单）；仅展示你有收益记录的月份。</div>
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
                <div style={{ fontSize: 11, color: "var(--muted)" }}>净佣金合计</div>
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
                    <th>结算状态</th>
                    <th style={{ textAlign: "right" }}>行项目数</th>
                    <th style={{ textAlign: "right" }}>调整行</th>
                    <th style={{ textAlign: "right" }}>净佣金</th>
                    <th style={{ textAlign: "right" }}>金额占比</th>
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
                              background: x.totalAmount >= 0 ? "linear-gradient(90deg, #0e7490, #f59e0b)" : "#f97316",
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {trendRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ color: "var(--muted)", padding: 14 }}>
                        暂无趋势数据
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
