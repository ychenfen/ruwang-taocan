"use client";

import { useMemo, useState } from "react";
import useSWR, { mutate } from "swr";

import { apiFetch } from "../../../lib/api";
import { formatDateYmd } from "../../../lib/display";
import { humanizeApiError } from "../../../lib/errors";

type AgentLevel = Readonly<{
  id: string;
  name: string;
  supportRate: number;
  stableRate: number;
  stableMonths: number;
  createdAt: string;
  updatedAt: string;
}>;

export default function AgentLevelsPage() {
  const levels = useSWR("/admin/agent-levels", (p) => apiFetch<AgentLevel[]>(p));
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AgentLevel | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const list = levels.data ?? [];
  const defaults = useMemo(
    () => ({
      name: "",
      supportRate: 0.03,
      stableRate: 0.01,
      stableMonths: 12,
    }),
    [],
  );

  const [form, setForm] = useState(defaults);

  const refresh = async () => mutate("/admin/agent-levels");

  return (
    <>
      <div className="mainHeader">
        <div>
          <div className="mainTitle">星级管理</div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
            扶持期固定 11 个月；稳定期月数来自等级配置；比例实时同步影响后续结算重算。
          </div>
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
            新增星级
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
                <th>扶持期比例</th>
                <th>稳定期比例</th>
                <th>稳定期月数</th>
                <th>更新时间</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.id}>
                  <td>{x.name}</td>
                  <td className="mono">{x.supportRate}</td>
                  <td className="mono">{x.stableRate}</td>
                  <td className="mono">{x.stableMonths}</td>
                  <td className="mono">{formatDateYmd(x.updatedAt)}</td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button
                        className="btn"
                        onClick={() => {
                          setErr(null);
                          setCreateOpen(false);
                          setEditing(x);
                          setForm({
                            name: x.name,
                            supportRate: x.supportRate,
                            stableRate: x.stableRate,
                            stableMonths: x.stableMonths,
                          });
                        }}
                      >
                        编辑
                      </button>
                      <button
                        className="btn btnDanger"
                        disabled={busy}
                        onClick={async () => {
                          if (!confirm("确定删除该星级吗？若已有职工在使用会被拦截。")) return;
                          setBusy(true);
                          setErr(null);
                          try {
                            await apiFetch(`/admin/agent-levels/${x.id}`, { method: "DELETE" });
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
                  <td colSpan={6} style={{ color: "var(--muted)", padding: 14 }}>
                    暂无数据
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {(createOpen || editing) && (
          <div style={{ marginTop: 14 }} className="card">
            <div className="cardTitle">{editing ? "编辑星级" : "新增星级"}</div>
            <div className="cardMeta" style={{ marginBottom: 8 }}>
              比例建议填小数，例如 3% 填 0.03。
            </div>

            <div className="field">
              <div className="label">名称</div>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="field">
              <div className="label">扶持期比例</div>
              <input
                className="input mono"
                type="number"
                step="0.000001"
                value={form.supportRate}
                onChange={(e) => setForm({ ...form, supportRate: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <div className="label">稳定期比例</div>
              <input
                className="input mono"
                type="number"
                step="0.000001"
                value={form.stableRate}
                onChange={(e) => setForm({ ...form, stableRate: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <div className="label">稳定期有效月数</div>
              <input
                className="input mono"
                type="number"
                step="1"
                value={form.stableMonths}
                onChange={(e) => setForm({ ...form, stableMonths: Number(e.target.value) })}
              />
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
                      await apiFetch(`/admin/agent-levels/${editing.id}`, {
                        method: "PUT",
                        body: JSON.stringify({
                          name: form.name,
                          supportRate: form.supportRate,
                          stableRate: form.stableRate,
                          stableMonths: form.stableMonths,
                        }),
                      });
                      setEditing(null);
                    } else {
                      await apiFetch("/admin/agent-levels", {
                        method: "POST",
                        body: JSON.stringify({
                          name: form.name,
                          supportRate: form.supportRate,
                          stableRate: form.stableRate,
                          stableMonths: form.stableMonths,
                        }),
                      });
                      setCreateOpen(false);
                    }
                    await refresh();
                  } catch (e) {
                    setErr(humanizeApiError(e));
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
