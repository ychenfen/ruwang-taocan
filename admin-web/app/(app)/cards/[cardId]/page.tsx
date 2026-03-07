"use client";

import { useState } from "react";
import useSWR from "swr";
import { useParams } from "next/navigation";

import { apiFetch } from "../../../../lib/api";
import { humanizeApiError } from "../../../../lib/errors";

type Card = Readonly<{
  id: string;
  cardNo: string;
  activatedAt: string;
  planId: string;
  planName: string;
  monthlyRent: number;
  policyId?: string;
  policyName?: string;
  ownerAgentId?: string;
  ownerName?: string;
  currentStatus?: string;
  currentStatusAt?: string;
  createdAt: string;
}>;

type Plan = Readonly<{
  id: string;
  name: string;
  monthlyRent: number;
}>;

type Policy = Readonly<{
  id: string;
  name: string;
}>;

type Agent = Readonly<{
  id: string;
  name: string;
  username: string;
  userStatus: "ACTIVE" | "DISABLED";
}>;

type CardStatusEvent = Readonly<{
  id: string;
  status: "NORMAL" | "PAUSED" | "LEFT" | "CONTROLLED" | "ABNORMAL";
  reason?: string;
  happenedAt: string;
  createdAt: string;
}>;

type CardStatus = CardStatusEvent["status"];

const statuses: CardStatus[] = ["NORMAL", "PAUSED", "LEFT", "CONTROLLED", "ABNORMAL"];

function toIsoFromLocalInput(v: string): string {
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/u.test(v)) return `${v}T00:00:00+08:00`;
  return new Date(v).toISOString();
}

function formatDateYmd(v?: string): string {
  if (!v) return "";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
  if (m) return m[1];
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function cardStatusLabel(status: string): string {
  if (status === "NORMAL") return "正常";
  if (status === "PAUSED") return "停机";
  if (status === "LEFT") return "离网";
  if (status === "CONTROLLED") return "管控";
  if (status === "ABNORMAL") return "异常";
  return status;
}

export default function CardDetailPage() {
  const params = useParams();
  const cardId = String((params as any)?.cardId ?? "");

  const cardDetail = useSWR(cardId ? `/admin/cards/${cardId}` : null, (p) => apiFetch<Card>(p));
  const plans = useSWR("/admin/plans", (p) => apiFetch<Plan[]>(p));
  const policies = useSWR("/admin/policies", (p) => apiFetch<Policy[]>(p));
  const agents = useSWR("/admin/agents", (p) => apiFetch<Agent[]>(p));
  const events = useSWR(cardId ? `/admin/cards/${cardId}/status-events` : null, (p) => apiFetch<CardStatusEvent[]>(p));

  const card = cardDetail.data ?? null;

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [activatedAt, setActivatedAt] = useState("");
  const [planId, setPlanId] = useState("");
  const [policyId, setPolicyId] = useState("");
  const [newOwnerAgentId, setNewOwnerAgentId] = useState("");
  const [assignEffectiveAt, setAssignEffectiveAt] = useState(() => new Date().toISOString().slice(0, 10));

  const [newStatus, setNewStatus] = useState<CardStatus>("NORMAL");
  const [newHappenedAtLocal, setNewHappenedAtLocal] = useState(() => new Date().toISOString().slice(0, 10));
  const [newReason, setNewReason] = useState("");

  return (
    <>
      <div className="mainHeader">
        <div>
          <div className="mainTitle">网卡详情</div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
            <span className="mono">{cardId}</span>
          </div>
        </div>
        <div className="btnRow">
          <button
            className="btn btnDanger"
            disabled={busy || !card}
            onClick={async () => {
              if (!card) return;
              if (!confirm("确定删除该网卡吗？若该卡已产生结算明细将不允许删除。")) return;
              setBusy(true);
              setErr(null);
              setMsg(null);
              try {
                await apiFetch(`/admin/cards/${card.id}`, { method: "DELETE" });
                window.location.href = "/cards";
              } catch (e) {
                setErr(humanizeApiError(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            删除网卡
          </button>
          <a className="btn" href="/cards">
            返回网卡列表
          </a>
        </div>
      </div>

      <div className="mainBody">
        {msg ? (
          <div style={{ marginBottom: 10, fontSize: 12, color: "var(--muted)" }}>
            {msg}
          </div>
        ) : null}
        {err ? <div className="error">{err}</div> : null}

        <div className="cardGrid">
          <div className="card" style={{ gridColumn: "span 6" }}>
            <div className="cardTitle">当前信息</div>
            {card ? (
              <div className="cardMeta" style={{ marginTop: 8, lineHeight: 1.8 }}>
                <div className="mono">卡号：{card.cardNo}</div>
                <div className="mono">入网日期：{formatDateYmd(card.activatedAt)}</div>
                <div>套餐：{card.planName}</div>
                <div>政策：{card.policyName ?? "(无)"}</div>
                <div>
                  归属代理：{card.ownerName ?? "(无)"} {card.ownerAgentId ? <span className="mono">({card.ownerAgentId})</span> : null}
                </div>
                <div className="mono">当前状态：{cardStatusLabel(card.currentStatus ?? "")}</div>
                <div className="mono">状态时间：{formatDateYmd(card.currentStatusAt)}</div>
              </div>
            ) : (
              <div style={{ color: "var(--muted)", marginTop: 8 }}>加载中…</div>
            )}
          </div>

          <div className="card" style={{ gridColumn: "span 6" }}>
            <div className="cardTitle">编辑基础信息</div>
            <div className="cardMeta">可更新入网日期 / 套餐 / 政策。</div>

            <div className="field" style={{ marginTop: 10 }}>
              <div className="label">入网日期</div>
              <input
                className="input mono"
                type="date"
                value={activatedAt || formatDateYmd(card?.activatedAt) || ""}
                onChange={(e) => setActivatedAt(e.target.value)}
              />
            </div>
            <div className="field">
              <div className="label">套餐</div>
              <select className="input" value={planId || card?.planId || ""} onChange={(e) => setPlanId(e.target.value)}>
                {(plans.data ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({x.monthlyRent.toFixed(2)})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <div className="label">政策</div>
              <select className="input" value={policyId || card?.policyId || ""} onChange={(e) => setPolicyId(e.target.value)}>
                <option value="">(无政策)</option>
                {(policies.data ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="btnRow" style={{ marginTop: 10 }}>
              <button
                className="btn btnPrimary"
                disabled={busy || !card}
                onClick={async () => {
                  if (!card) return;
                  const normalizedActivatedAt = (activatedAt || formatDateYmd(card.activatedAt)).trim();
                  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalizedActivatedAt)) {
                    setErr("入网日期格式错误，请选择有效日期后重试。");
                    return;
                  }
                  setBusy(true);
                  setErr(null);
                  setMsg(null);
                  try {
                    await apiFetch(`/admin/cards/${card.id}`, {
                      method: "PUT",
                      body: JSON.stringify({
                        activatedAt: normalizedActivatedAt,
                        planId: planId || card.planId,
                        policyId: (policyId || card.policyId || "") ? (policyId || card.policyId) : null,
                      }),
                    });
                    setMsg("基础信息已更新");
                    await cardDetail.mutate();
                  } catch (e) {
                    setErr(humanizeApiError(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "保存中…" : "保存基础信息"}
              </button>
            </div>
          </div>

          <div className="card" style={{ gridColumn: "span 6" }}>
            <div className="cardTitle">转移归属代理</div>
            <div className="cardMeta">会自动结束当前 assignment 并新增新 assignment，写入审计日志。</div>
            <div className="field" style={{ marginTop: 10 }}>
              <div className="label">新归属代理</div>
              <select className="input" value={newOwnerAgentId} onChange={(e) => setNewOwnerAgentId(e.target.value)}>
                <option value="">(请选择)</option>
                {(agents.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.username}){a.userStatus !== "ACTIVE" ? " [停用]" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <div className="label">生效日期</div>
              <input
                className="input mono"
                type="date"
                value={assignEffectiveAt}
                onChange={(e) => setAssignEffectiveAt(e.target.value)}
              />
            </div>
            <div className="btnRow" style={{ marginTop: 10 }}>
              <button
                className="btn btnPrimary"
                disabled={busy || !card || !newOwnerAgentId}
                onClick={async () => {
                  if (!card || !newOwnerAgentId) return;
                  if (!/^\d{4}-\d{2}-\d{2}$/u.test(assignEffectiveAt)) {
                    setErr("转移生效日期格式错误，请选择有效日期。");
                    return;
                  }
                  setBusy(true);
                  setErr(null);
                  setMsg(null);
                  try {
                    await apiFetch(`/admin/cards/${card.id}/assign`, {
                      method: "POST",
                      body: JSON.stringify({ ownerAgentId: newOwnerAgentId, effectiveAt: assignEffectiveAt }),
                    });
                    setMsg("归属代理已更新");
                    setNewOwnerAgentId("");
                    await cardDetail.mutate();
                  } catch (e) {
                    setErr(humanizeApiError(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "处理中…" : "执行转移"}
              </button>
            </div>
          </div>

          <div className="card" style={{ gridColumn: "span 6" }}>
            <div className="cardTitle">新增状态事件</div>
            <div className="cardMeta">注意：当月任一异常状态事件会导致该月佣金为 0。</div>
            <div className="field" style={{ marginTop: 10 }}>
              <div className="label">状态</div>
              <select className="input" value={newStatus} onChange={(e) => setNewStatus(e.target.value as CardStatus)}>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {cardStatusLabel(s)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <div className="label">发生日期</div>
              <input
                className="input mono"
                type="date"
                value={newHappenedAtLocal}
                onChange={(e) => setNewHappenedAtLocal(e.target.value)}
              />
            </div>
            <div className="field">
              <div className="label">原因（可选）</div>
              <input className="input" value={newReason} onChange={(e) => setNewReason(e.target.value)} />
            </div>
            <div className="btnRow" style={{ marginTop: 10 }}>
              <button
                className="btn btnPrimary"
                disabled={busy || !card}
                onClick={async () => {
                  if (!card) return;
                  setBusy(true);
                  setErr(null);
                  setMsg(null);
                  try {
                    await apiFetch(`/admin/cards/${card.id}/status-events`, {
                      method: "POST",
                      body: JSON.stringify({
                        status: newStatus,
                        happenedAt: toIsoFromLocalInput(newHappenedAtLocal),
                        reason: newReason.trim() || undefined,
                      }),
                    });
                    setMsg("状态事件已添加");
                    setNewReason("");
                    await events.mutate();
                    await cardDetail.mutate();
                  } catch (e) {
                    setErr(humanizeApiError(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "保存中…" : "新增状态事件"}
              </button>
            </div>
          </div>
        </div>

        <div className="tableWrap" style={{ marginTop: 14 }}>
          <table className="table">
            <thead>
              <tr>
                <th>状态</th>
                <th>发生时间</th>
                <th>原因</th>
                <th>记录时间</th>
                <th className="mono">eventId</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {(events.data ?? []).map((x) => (
                <tr key={x.id}>
                  <td className="mono">{cardStatusLabel(x.status)}</td>
                  <td className="mono">{formatDateYmd(x.happenedAt)}</td>
                  <td>{x.reason ?? ""}</td>
                  <td className="mono">{formatDateYmd(x.createdAt)}</td>
                  <td className="mono">{x.id}</td>
                  <td>
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={async () => {
                        if (!card) return;
                        if (!confirm("确定删除该状态事件吗？若已影响入账月将被拒绝。")) return;
                        setBusy(true);
                        setErr(null);
                        setMsg(null);
                        try {
                          await apiFetch(`/admin/cards/${card.id}/status-events/${x.id}`, { method: "DELETE" });
                          setMsg("状态事件已删除");
                          await events.mutate();
                          await cardDetail.mutate();
                        } catch (e: any) {
                          const raw = String(e?.message ?? "");
                          if (raw.includes("LAST_STATUS_EVENT_CANNOT_DELETE")) {
                            setErr("无法删除最后一条状态事件。");
                          } else if (raw.includes("STATUS_EVENT_LOCKED_BY_POSTED_SETTLEMENT")) {
                            setErr("该事件已影响已入账月份，禁止直接删除，请通过调整单处理。");
                          } else {
                            setErr(humanizeApiError(e));
                          }
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
              {(events.data ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ color: "var(--muted)", padding: 14 }}>
                    暂无状态事件
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
