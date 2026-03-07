"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";

import { apiFetch } from "../../../lib/api";
import { humanizeApiError } from "../../../lib/errors";

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
  status: "ACTIVE" | "DISABLED";
}>;

type Policy = Readonly<{
  id: string;
  name: string;
  status: "ACTIVE" | "DISABLED";
}>;

type Agent = Readonly<{
  id: string;
  name: string;
  username: string;
  levelName: string;
  userStatus: "ACTIVE" | "DISABLED";
}>;

type CardStatus = "NORMAL" | "PAUSED" | "LEFT" | "CONTROLLED" | "ABNORMAL";

const statuses: CardStatus[] = ["NORMAL", "PAUSED", "LEFT", "CONTROLLED", "ABNORMAL"];

function cardStatusLabel(status: string): string {
  if (status === "NORMAL") return "正常";
  if (status === "PAUSED") return "停机";
  if (status === "LEFT") return "离网";
  if (status === "CONTROLLED") return "管控";
  if (status === "ABNORMAL") return "异常";
  return status;
}

function formatDateYmd(v?: string): string {
  if (!v) return "";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
  if (m) return m[1];
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toISOString().slice(0, 10);
}

export default function CardsPage() {
  const [pageSize] = useState(20);
  const [offset, setOffset] = useState(0);

  const cards = useSWR(`/admin/cards?limit=${pageSize}&offset=${offset}`, (p) => apiFetch<Card[]>(p));
  const plans = useSWR("/admin/plans", (p) => apiFetch<Plan[]>(p));
  const policies = useSWR("/admin/policies", (p) => apiFetch<Policy[]>(p));
  const agents = useSWR("/admin/agents", (p) => apiFetch<Agent[]>(p));

  const [kw, setKw] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const defaults = useMemo(
    () => ({
      cardNo: "",
      activatedAt: new Date().toISOString().slice(0, 10),
      planId: "",
      policyId: "",
      ownerAgentId: "",
      initialStatus: "NORMAL" as CardStatus,
    }),
    [],
  );
  const [form, setForm] = useState(defaults);

  const filtered = useMemo(() => {
    const base = cards.data ?? [];
    const q = kw.trim().toLowerCase();
    return base.filter((x) => {
      if (statusFilter && x.currentStatus !== statusFilter) return false;
      if (ownerFilter && x.ownerAgentId !== ownerFilter) return false;
      if (!q) return true;
      const hay = [x.cardNo, x.id, x.ownerName ?? "", x.ownerAgentId ?? "", x.planName, x.policyName ?? ""]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [cards.data, kw, statusFilter, ownerFilter]);

  return (
    <>
      <div className="mainHeader">
        <div>
          <div className="mainTitle">网卡</div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
            维护卡基础信息、归属代理与状态事件；结算引擎按卡状态时间线判定当月是否可结算。
          </div>
        </div>
        <div className="btnRow">
          <button
            className="btn btnPrimary"
            onClick={() => {
              setErr(null);
              setForm({
                ...defaults,
                planId: (plans.data ?? []).find((x) => x.status === "ACTIVE")?.id ?? "",
                policyId: (policies.data ?? []).find((x) => x.status === "ACTIVE")?.id ?? "",
                ownerAgentId: (agents.data ?? []).find((x) => x.userStatus === "ACTIVE")?.id ?? "",
              });
              setCreateOpen(true);
            }}
          >
            新增网卡
          </button>
        </div>
      </div>

      <div className="mainBody">
        {err ? <div className="error">{err}</div> : null}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 240px 1fr",
            gap: 10,
            marginBottom: 12,
          }}
        >
          <div className="field" style={{ margin: 0 }}>
            <div className="label">关键字（卡号/ID/代理/套餐）</div>
            <input className="input mono" value={kw} onChange={(e) => setKw(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <div className="label">状态</div>
            <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">(全部)</option>
              {statuses.map((x) => (
                <option key={x} value={x}>
                  {cardStatusLabel(x)}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <div className="label">归属代理</div>
            <select className="input" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
              <option value="">(全部)</option>
              {(agents.data ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} ({x.username})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>卡号</th>
                <th>入网日期</th>
                <th>套餐</th>
                <th style={{ textAlign: "right" }}>月租</th>
                <th>政策</th>
                <th>归属代理</th>
                <th>当前状态</th>
                <th>状态时间</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((x) => (
                <tr key={x.id}>
                  <td className="mono">{x.cardNo}</td>
                  <td className="mono">{formatDateYmd(x.activatedAt)}</td>
                  <td>{x.planName}</td>
                  <td className="mono" style={{ textAlign: "right" }}>
                    {x.monthlyRent.toFixed(2)}
                  </td>
                  <td>{x.policyName ?? ""}</td>
                  <td>
                    {x.ownerName ?? ""}
                    {x.ownerAgentId ? <div className="mono" style={{ fontSize: 11 }}>{x.ownerAgentId}</div> : null}
                  </td>
                  <td className="mono">{cardStatusLabel(x.currentStatus ?? "")}</td>
                  <td className="mono">{formatDateYmd(x.currentStatusAt)}</td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <a className="btn" href={`/cards/${x.id}`}>
                        详情
                      </a>
                      <button
                        className="btn btnDanger"
                        disabled={busy}
                        onClick={async () => {
                          if (!confirm("确定删除该网卡吗？若已产生结算明细将不允许删除。")) return;
                          setBusy(true);
                          setErr(null);
                          try {
                            await apiFetch(`/admin/cards/${x.id}`, { method: "DELETE" });
                            await cards.mutate();
                          } catch (e) {
                            setErr(humanizeApiError(e));
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ color: "var(--muted)", padding: 14 }}>
                    暂无数据
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="btnRow" style={{ marginTop: 10 }}>
          <button className="btn" disabled={offset === 0} onClick={() => setOffset((v) => Math.max(v - pageSize, 0))}>
            上一页
          </button>
          <button className="btn" disabled={(cards.data?.length ?? 0) < pageSize} onClick={() => setOffset((v) => v + pageSize)}>
            下一页
          </button>
          <div className="cardMeta">offset={offset} limit={pageSize}</div>
        </div>

        {createOpen ? (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="cardTitle">新增网卡</div>
            <div className="cardMeta">创建时会自动写一条初始状态事件，默认“正常”。</div>

            <div className="cardGrid" style={{ marginTop: 10 }}>
              <div className="card" style={{ gridColumn: "span 6" }}>
                <div className="label">卡号</div>
                <input className="input mono" value={form.cardNo} onChange={(e) => setForm({ ...form, cardNo: e.target.value })} />
              </div>
              <div className="card" style={{ gridColumn: "span 6" }}>
                <div className="label">入网日期</div>
                <input
                  className="input mono"
                  type="date"
                  value={form.activatedAt}
                  onChange={(e) => setForm({ ...form, activatedAt: e.target.value })}
                />
              </div>
              <div className="card" style={{ gridColumn: "span 4" }}>
                <div className="label">套餐</div>
                <select className="input" value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })}>
                  {(plans.data ?? []).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} ({x.monthlyRent.toFixed(2)})
                    </option>
                  ))}
                </select>
              </div>
              <div className="card" style={{ gridColumn: "span 4" }}>
                <div className="label">政策（可空）</div>
                <select className="input" value={form.policyId} onChange={(e) => setForm({ ...form, policyId: e.target.value })}>
                  <option value="">(无政策)</option>
                  {(policies.data ?? []).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="card" style={{ gridColumn: "span 4" }}>
                <div className="label">归属代理</div>
                <select
                  className="input"
                  value={form.ownerAgentId}
                  onChange={(e) => setForm({ ...form, ownerAgentId: e.target.value })}
                >
                  {(agents.data ?? []).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} ({x.username})
                    </option>
                  ))}
                </select>
              </div>
              <div className="card" style={{ gridColumn: "span 4" }}>
                <div className="label">初始状态</div>
                <select
                  className="input"
                  value={form.initialStatus}
                  onChange={(e) => setForm({ ...form, initialStatus: e.target.value as CardStatus })}
                >
                  {statuses.map((s) => (
                    <option key={s} value={s}>
                      {cardStatusLabel(s)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="btnRow" style={{ marginTop: 10 }}>
              <button
                className="btn btnPrimary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setErr(null);
                  try {
                    await apiFetch("/admin/cards", {
                      method: "POST",
                      body: JSON.stringify({
                        cardNo: form.cardNo.trim(),
                        activatedAt: form.activatedAt,
                        planId: form.planId,
                        policyId: form.policyId || undefined,
                        ownerAgentId: form.ownerAgentId,
                        initialStatus: form.initialStatus,
                      }),
                    });
                    await cards.mutate();
                    setCreateOpen(false);
                  } catch (e) {
                    setErr(humanizeApiError(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "创建中…" : "创建"}
              </button>
              <button
                className="btn"
                onClick={() => {
                  setCreateOpen(false);
                  setErr(null);
                }}
              >
                取消
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
