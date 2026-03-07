"use client";

import { useMemo, useState } from "react";
import useSWR, { mutate } from "swr";

import { apiFetch } from "../../../lib/api";
import { accountStatusLabel, formatDateYmd } from "../../../lib/display";
import { humanizeApiError } from "../../../lib/errors";

type Policy = Readonly<{
  id: string;
  name: string;
  status: "ACTIVE" | "DISABLED";
  createdAt: string;
}>;

type PolicyForm = Readonly<{
  name: string;
  status: "ACTIVE" | "DISABLED";
}>;

export default function PoliciesPage() {
  const policies = useSWR("/admin/policies", (p) => apiFetch<Policy[]>(p));
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Policy | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const list = policies.data ?? [];
  const defaults = useMemo<PolicyForm>(
    () => ({
      name: "",
      status: "ACTIVE",
    }),
    [],
  );
  const [form, setForm] = useState<PolicyForm>(defaults);

  const refresh = async () => mutate("/admin/policies");

  return (
    <>
      <div className="mainHeader">
        <div>
          <div className="mainTitle">政策管理</div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
            当前政策仅做关联展示；后续可扩展版本化与差异规则。
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
            新增政策
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
                <th>状态</th>
                <th>创建时间</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.id}>
                  <td>{x.name}</td>
                  <td>{accountStatusLabel(x.status)}</td>
                  <td className="mono">{formatDateYmd(x.createdAt)}</td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="btn"
                      onClick={() => {
                        setErr(null);
                        setCreateOpen(false);
                        setEditing(x);
                        setForm({ name: x.name, status: x.status });
                      }}
                    >
                      编辑
                    </button>
                  </td>
                </tr>
              ))}
              {list.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ color: "var(--muted)", padding: 14 }}>
                    暂无数据
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {(createOpen || editing) && (
          <div style={{ marginTop: 14 }} className="card">
            <div className="cardTitle">{editing ? "编辑政策" : "新增政策"}</div>
            <div className="field" style={{ marginTop: 10 }}>
              <div className="label">名称</div>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
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
                      await apiFetch(`/admin/policies/${editing.id}`, {
                        method: "PUT",
                        body: JSON.stringify({
                          name: form.name,
                          status: form.status,
                        }),
                      });
                      setEditing(null);
                    } else {
                      await apiFetch("/admin/policies", {
                        method: "POST",
                        body: JSON.stringify({
                          name: form.name,
                          status: form.status,
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
