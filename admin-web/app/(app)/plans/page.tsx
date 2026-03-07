"use client";

import { useMemo, useState } from "react";
import useSWR, { mutate } from "swr";

import { apiFetch } from "../../../lib/api";
import { accountStatusLabel, formatDateYmd } from "../../../lib/display";
import { humanizeApiError } from "../../../lib/errors";

type Plan = Readonly<{
  id: string;
  name: string;
  monthlyRent: number;
  status: "ACTIVE" | "DISABLED";
  createdAt: string;
}>;

type PlanForm = Readonly<{
  name: string;
  monthlyRent: number;
  status: "ACTIVE" | "DISABLED";
}>;

export default function PlansPage() {
  const plans = useSWR("/admin/plans", (p) => apiFetch<Plan[]>(p));
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const list = plans.data ?? [];
  const defaults = useMemo<PlanForm>(
    () => ({
      name: "",
      monthlyRent: 29,
      status: "ACTIVE",
    }),
    [],
  );
  const [form, setForm] = useState<PlanForm>(defaults);

  const refresh = async () => mutate("/admin/plans");

  return (
    <>
      <div className="mainHeader">
        <div>
          <div className="mainTitle">套餐管理</div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>月租是佣金计算基数。</div>
        </div>
        <div className="btnRow">
          <button
            className="btn btnPrimary"
            onClick={() => {
              setErr(null);
              setForm(defaults);
              setEditing(null);
              setCreateOpen(true);
            }}
          >
            新增套餐
          </button>
        </div>
      </div>

      <div className="mainBody">
        {err ? <div className="error">{err}</div> : null}

        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>名称</th>
                <th>月租</th>
                <th>状态</th>
                <th>创建时间</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.id}>
                  <td>{x.name}</td>
                  <td className="mono">{x.monthlyRent}</td>
                  <td>{accountStatusLabel(x.status)}</td>
                  <td className="mono">{formatDateYmd(x.createdAt)}</td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button
                        className="btn"
                        onClick={() => {
                          setErr(null);
                          setCreateOpen(false);
                          setEditing(x);
                          setForm({ name: x.name, monthlyRent: x.monthlyRent, status: x.status });
                        }}
                      >
                        编辑
                      </button>
                      <button
                        className="btn btnDanger"
                        disabled={busy}
                        onClick={async () => {
                          if (!confirm("确定删除该套餐吗？若已有网卡使用会被拦截。")) return;
                          setBusy(true);
                          setErr(null);
                          try {
                            await apiFetch(`/admin/plans/${x.id}`, { method: "DELETE" });
                            if (editing?.id === x.id) {
                              setEditing(null);
                              setCreateOpen(false);
                              setForm(defaults);
                            }
                            await refresh();
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
              {list.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ color: "var(--muted)", padding: 14 }}>
                    暂无数据
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {(createOpen || editing) && (
          <div style={{ marginTop: 14 }} className="card">
            <div className="cardTitle">{editing ? "编辑套餐" : "新增套餐"}</div>
            <div className="field" style={{ marginTop: 10 }}>
              <div className="label">名称</div>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="field">
              <div className="label">月租</div>
              <input
                className="input mono"
                type="number"
                step="0.01"
                value={form.monthlyRent}
                onChange={(e) => setForm({ ...form, monthlyRent: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <div className="label">状态</div>
              <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as any })}>
                <option value="ACTIVE">启用</option>
                <option value="DISABLED">停用</option>
              </select>
            </div>

            <div className="btnRow" style={{ marginTop: 10 }}>
              <button
                className="btn btnPrimary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setErr(null);
                  try {
                    if (editing) {
                      await apiFetch(`/admin/plans/${editing.id}`, {
                        method: "PUT",
                        body: JSON.stringify({
                          name: form.name,
                          monthlyRent: form.monthlyRent,
                          status: form.status,
                        }),
                      });
                      setEditing(null);
                    } else {
                      await apiFetch("/admin/plans", {
                        method: "POST",
                        body: JSON.stringify({
                          name: form.name,
                          monthlyRent: form.monthlyRent,
                          status: form.status,
                        }),
                      });
                      setCreateOpen(false);
                    }
                    await refresh();
                  } catch (e) {
                    const code = (e as any)?.code;
                    if (editing && code === "NOT_FOUND") {
                      await refresh();
                      setEditing(null);
                      setErr("该套餐已变化或已删除，列表已刷新，请重新选择后再编辑。");
                    } else {
                      setErr(humanizeApiError(e));
                    }
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "保存中…" : "保存"}
              </button>
              <button
                className="btn"
                onClick={() => {
                  setCreateOpen(false);
                  setEditing(null);
                  setErr(null);
                }}
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
