"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";

import { apiDownload, apiFetch } from "../../../lib/api";
import { formatDateYmd } from "../../../lib/display";
import { humanizeApiError } from "../../../lib/errors";

type AuditLog = Readonly<{
  id: string;
  actorUserId?: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId?: string;
  before?: any;
  after?: any;
  meta?: any;
  createdAt: string;
}>;

type ExportSummary = Readonly<{
  days: number;
  totalCount: number;
  csvCount: number;
  xlsxCount: number;
  rows: Array<
    Readonly<{
      action: string;
      format: string;
      actorUserId?: string;
      totalCount: number;
      firstAt: string;
      lastAt: string;
    }>
  >;
  byDay: Array<
    Readonly<{
      day: string;
      action: string;
      format: string;
      totalCount: number;
    }>
  >;
}>;

const EXPORT_ACTIONS = new Set([
  "REPORT_EXPORT_SETTLEMENT_ITEMS",
  "REPORT_EXPORT_BILL_FORMAT",
  "LEDGER_EXPORT_ENTRIES",
  "AUDIT_EXPORT_LOGS",
]);

const QUICK_FILTERS: ReadonlyArray<
  Readonly<{
    label: string;
    entityType?: string;
    action?: string;
  }>
> = [
  { label: "团队变更", entityType: "teams" },
  { label: "代理变更", entityType: "agents" },
  { label: "网卡变更", entityType: "cards" },
  { label: "结算动作", entityType: "settlement_runs" },
  { label: "报表导出", entityType: "reports", action: "REPORT_EXPORT_SETTLEMENT_ITEMS" },
  { label: "账单导出", entityType: "reports", action: "REPORT_EXPORT_BILL_FORMAT" },
  { label: "分录导出", entityType: "ledger_entries", action: "LEDGER_EXPORT_ENTRIES" },
  { label: "审计导出", entityType: "audit_logs", action: "AUDIT_EXPORT_LOGS" },
];

function buildQuery(obj: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (!v) continue;
    sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export default function AuditLogsPage() {
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [action, setAction] = useState("");
  const [actorUserId, setActorUserId] = useState("");
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [summaryDays, setSummaryDays] = useState(30);
  const [exportingFormat, setExportingFormat] = useState<"" | "csv" | "xlsx">("");
  const [err, setErr] = useState<string | null>(null);

  const qs = useMemo(
    () =>
      buildQuery({
        entityType: entityType.trim() || undefined,
        entityId: entityId.trim() || undefined,
        action: action.trim() || undefined,
        actorUserId: actorUserId.trim() || undefined,
        limit: String(limit),
        offset: String(offset),
      }),
    [entityType, entityId, action, actorUserId, limit, offset],
  );
  const filterQs = useMemo(
    () =>
      buildQuery({
        entityType: entityType.trim() || undefined,
        entityId: entityId.trim() || undefined,
        action: action.trim() || undefined,
        actorUserId: actorUserId.trim() || undefined,
      }),
    [entityType, entityId, action, actorUserId],
  );
  const summaryQs = useMemo(
    () =>
      buildQuery({
        days: String(summaryDays),
        actorUserId: actorUserId.trim() || undefined,
        action: EXPORT_ACTIONS.has(action.trim()) ? action.trim() : undefined,
      }),
    [summaryDays, actorUserId, action],
  );

  const logs = useSWR(`/admin/audit-logs${qs}`, (p) => apiFetch<AuditLog[]>(p));
  const summary = useSWR(`/admin/audit-logs/export-summary${summaryQs}`, (p) => apiFetch<ExportSummary>(p));

  const downloadAuditLogs = async (format: "csv" | "xlsx") => {
    try {
      setErr(null);
      setExportingFormat(format);
      const { blob, filename } = await apiDownload(`/admin/audit-logs.${format}${filterQs}`, { method: "GET" });
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = filename ?? `audit-logs.${format}`;
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
          <div className="mainTitle">审计</div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
            关键变更都会落审计，便于追责与复盘。
          </div>
        </div>
        <div className="btnRow">
          <button className="btn" onClick={() => logs.mutate()}>
            刷新
          </button>
          <button className="btn btnPrimary" disabled={exportingFormat.length > 0} onClick={() => downloadAuditLogs("csv")}>
            {exportingFormat === "csv" ? "导出中…" : "导出 CSV"}
          </button>
          <button className="btn" disabled={exportingFormat.length > 0} onClick={() => downloadAuditLogs("xlsx")}>
            {exportingFormat === "xlsx" ? "导出中…" : "导出 XLSX"}
          </button>
        </div>
      </div>

      <div className="mainBody">
        {err ? <div className="error" style={{ marginBottom: 10 }}>{err}</div> : null}
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="cardTitle">导出行为统计</div>
          <div className="cardMeta">统计最近 N 天导出行为（CSV/XLSX）。可叠加当前 action / actor 筛选。</div>
          <div className="btnRow" style={{ marginTop: 10 }}>
            <select
              className="input"
              style={{ width: 150 }}
              value={String(summaryDays)}
              onChange={(e) => setSummaryDays(Math.max(Number(e.target.value) || 1, 1))}
            >
              <option value="7">最近 7 天</option>
              <option value="30">最近 30 天</option>
              <option value="90">最近 90 天</option>
              <option value="180">最近 180 天</option>
              <option value="365">最近 365 天</option>
            </select>
            <button className="btn" onClick={() => summary.mutate()}>
              刷新统计
            </button>
            <div className="cardMeta" style={{ marginLeft: "auto" }}>
              total=<span className="mono">{summary.data?.totalCount ?? 0}</span> / csv=
              <span className="mono">{summary.data?.csvCount ?? 0}</span> / xlsx=
              <span className="mono">{summary.data?.xlsxCount ?? 0}</span>
            </div>
          </div>
          {summary.error ? <div className="error" style={{ marginTop: 10 }}>{humanizeApiError(summary.error)}</div> : null}
          {action.trim().length > 0 && !EXPORT_ACTIONS.has(action.trim()) ? (
            <div className="cardMeta" style={{ marginTop: 8, color: "#9a3412" }}>
              当前 action 非导出动作，统计查询会忽略 action 筛选（仅统计导出行为）。
            </div>
          ) : null}
          <div className="tableWrap" style={{ marginTop: 10 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>action</th>
                  <th>format</th>
                  <th>actorUserId</th>
                  <th style={{ textAlign: "right" }}>count</th>
                  <th>firstAt</th>
                  <th>lastAt</th>
                </tr>
              </thead>
              <tbody>
                {(summary.data?.rows ?? []).map((x, idx) => (
                  <tr key={`${x.action}-${x.format}-${x.actorUserId ?? "-"}-${idx}`}>
                    <td className="mono">{x.action}</td>
                    <td className="mono">{x.format || "-"}</td>
                    <td className="mono">{x.actorUserId ?? ""}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{x.totalCount}</td>
                    <td className="mono">{formatDateYmd(x.firstAt)}</td>
                    <td className="mono">{formatDateYmd(x.lastAt)}</td>
                  </tr>
                ))}
                {!summary.data ? (
                  <tr>
                    <td colSpan={6} style={{ color: "var(--muted)", padding: 14 }}>加载中…</td>
                  </tr>
                ) : null}
                {summary.data && summary.data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ color: "var(--muted)", padding: 14 }}>最近窗口暂无导出行为</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="tableWrap" style={{ marginTop: 10 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>day</th>
                  <th>action</th>
                  <th>format</th>
                  <th style={{ textAlign: "right" }}>count</th>
                </tr>
              </thead>
              <tbody>
                {(summary.data?.byDay ?? []).map((x, idx) => (
                  <tr key={`${x.day}-${x.action}-${x.format}-${idx}`}>
                    <td className="mono">{x.day}</td>
                    <td className="mono">{x.action}</td>
                    <td className="mono">{x.format || "-"}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{x.totalCount}</td>
                  </tr>
                ))}
                {!summary.data ? (
                  <tr>
                    <td colSpan={4} style={{ color: "var(--muted)", padding: 14 }}>加载中…</td>
                  </tr>
                ) : null}
                {summary.data && summary.data.byDay.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ color: "var(--muted)", padding: 14 }}>最近窗口暂无按日数据</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 12 }}>
          <div className="cardTitle">筛选</div>
          <div className="btnRow" style={{ marginTop: 10 }}>
            {QUICK_FILTERS.map((x) => (
              <button
                key={x.label}
                className="btn"
                onClick={() => {
                  setOffset(0);
                  setEntityType(x.entityType ?? "");
                  setAction(x.action ?? "");
                }}
              >
                {x.label}
              </button>
            ))}
            <button
              className="btn"
              onClick={() => {
                setOffset(0);
                setEntityType("");
                setEntityId("");
                setAction("");
                setActorUserId("");
              }}
            >
              清空筛选
            </button>
          </div>
          <div className="cardGrid" style={{ marginTop: 10 }}>
            <div className="card" style={{ gridColumn: "span 4" }}>
              <div className="label">entityType</div>
              <input
                className="input mono"
                value={entityType}
                onChange={(e) => {
                  setOffset(0);
                  setEntityType(e.target.value);
                }}
                placeholder="agents / cards / ..."
              />
            </div>
            <div className="card" style={{ gridColumn: "span 4" }}>
              <div className="label">entityId</div>
              <input
                className="input mono"
                value={entityId}
                onChange={(e) => {
                  setOffset(0);
                  setEntityId(e.target.value);
                }}
                placeholder="(optional)"
              />
            </div>
            <div className="card" style={{ gridColumn: "span 4" }}>
              <div className="label">action</div>
              <input
                className="input mono"
                value={action}
                onChange={(e) => {
                  setOffset(0);
                  setAction(e.target.value);
                }}
                placeholder="TEAM_CREATE / CARD_UPDATE ..."
              />
            </div>
            <div className="card" style={{ gridColumn: "span 6" }}>
              <div className="label">actorUserId</div>
              <input
                className="input mono"
                value={actorUserId}
                onChange={(e) => {
                  setOffset(0);
                  setActorUserId(e.target.value);
                }}
                placeholder="(optional)"
              />
            </div>
            <div className="card" style={{ gridColumn: "span 6" }}>
              <div className="label">limit</div>
              <input
                className="input mono"
                type="number"
                value={limit}
                onChange={(e) => {
                  setOffset(0);
                  setLimit(Math.max(Number(e.target.value) || 1, 1));
                }}
              />
              <div className="label" style={{ marginTop: 8 }}>offset</div>
              <input className="input mono" type="number" value={offset} onChange={(e) => setOffset(Math.max(Number(e.target.value) || 0, 0))} />
              <div className="cardMeta" style={{ marginTop: 8 }}>
                query: <span className="mono">{qs}</span>
              </div>
            </div>
          </div>
        </div>

        {logs.error ? <div className="error">{humanizeApiError(logs.error)}</div> : null}

        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>time</th>
                <th>actor</th>
                <th>action</th>
                <th>entity</th>
                <th className="mono">id</th>
                <th>meta</th>
              </tr>
            </thead>
            <tbody>
              {(logs.data ?? []).map((x) => (
                <tr key={x.id}>
                  <td className="mono">{formatDateYmd(x.createdAt)}</td>
                  <td className="mono">
                    {x.actorRole}:{x.actorUserId ?? "-"}
                  </td>
                  <td className="mono">{x.action}</td>
                  <td className="mono">{x.entityType}</td>
                  <td className="mono">{x.entityId ?? ""}</td>
                  <td style={{ maxWidth: 360 }}>
                    <pre
                      className="mono"
                      style={{
                        margin: 0,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        color: "var(--muted)",
                        fontSize: 11,
                        lineHeight: 1.4,
                      }}
                    >
                      {JSON.stringify(x.meta ?? {}, null, 0)}
                    </pre>
                  </td>
                </tr>
              ))}
              {!logs.data ? (
                <tr>
                  <td colSpan={6} style={{ color: "var(--muted)", padding: 14 }}>
                    加载中…
                  </td>
                </tr>
              ) : null}
              {logs.data && logs.data.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ color: "var(--muted)", padding: 14 }}>
                    暂无数据
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
          <button className="btn" disabled={(logs.data?.length ?? 0) < limit} onClick={() => setOffset((v) => v + limit)}>
            下一页
          </button>
          <div className="cardMeta">offset={offset} limit={limit}</div>
        </div>
      </div>
    </>
  );
}
