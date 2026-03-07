"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";

import { apiFetch } from "../../../lib/api";
import { accountStatusLabel, formatDateYmd } from "../../../lib/display";
import { humanizeApiError } from "../../../lib/errors";

type Agent = Readonly<{
  id: string;
  userId: string;
  username: string;
  userStatus: "ACTIVE" | "DISABLED";
  name: string;
  phone?: string;
  employeeNo?: string;
  province?: string;
  channel?: string;
  levelId: string;
  levelName: string;
  teamId?: string;
  teamName?: string;
  createdAt: string;
}>;

type AgentLevel = Readonly<{
  id: string;
  name: string;
}>;

type Team = Readonly<{
  id: string;
  name: string;
  tag?: string;
}>;

type AgentForm = Readonly<{
  username: string;
  password: string;
  name: string;
  phone: string;
  employeeNo: string;
  province: string;
  channel: string;
  levelId: string;
  teamId: string;
  userStatus: "ACTIVE" | "DISABLED";
}>;

export default function AgentsPage() {
  const [pageSize] = useState(20);
  const [offset, setOffset] = useState(0);

  const agents = useSWR(`/admin/agents?limit=${pageSize}&offset=${offset}`, (p) => apiFetch<Agent[]>(p));
  const levels = useSWR("/admin/agent-levels", (p) => apiFetch<AgentLevel[]>(p));
  const teams = useSWR("/admin/teams", (p) => apiFetch<Team[]>(p));

  const list = agents.data ?? [];

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const defaults = useMemo<AgentForm>(
    () => ({
      username: "",
      password: "",
      name: "",
      phone: "",
      employeeNo: "",
      province: "",
      channel: "",
      levelId: "",
      teamId: "",
      userStatus: "ACTIVE",
    }),
    [],
  );
  const [form, setForm] = useState<AgentForm>(defaults);

  const refresh = async () => agents.mutate();

  return (
    <>
      <div className="mainHeader">
        <div>
          <div className="mainTitle">职工</div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
            职工账号用于登录职工端；可维护星级、团队归属、上下级关系（详情页）。
          </div>
        </div>
        <div className="btnRow">
          <button
            className="btn btnPrimary"
            onClick={() => {
              setErr(null);
              setEditing(null);
              setForm({ ...defaults, levelId: (levels.data ?? [])[0]?.id ?? "" });
              setCreateOpen(true);
            }}
          >
            新增职工
          </button>
        </div>
      </div>

      <div className="mainBody">
        {err ? <div className="error">{err}</div> : null}

        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>用户名</th>
                <th>星级</th>
                <th>团队</th>
                <th>状态</th>
                <th>创建</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.id}>
                  <td>{x.name}</td>
                  <td className="mono">{x.username}</td>
                  <td className="mono">{x.levelName}</td>
                  <td>{x.teamName ?? ""}</td>
                  <td className="mono">{accountStatusLabel(x.userStatus)}</td>
                  <td className="mono">{formatDateYmd(x.createdAt)}</td>
                  <td style={{ textAlign: "right", display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                    <a className="btn" href={`/agents/${x.id}`}>
                      详情
                    </a>
                    <button
                      className="btn"
                      onClick={() => {
                        setErr(null);
                        setCreateOpen(false);
                        setEditing(x);
                        setForm({
                          username: x.username,
                          password: "",
                          name: x.name,
                          phone: x.phone ?? "",
                          employeeNo: x.employeeNo ?? "",
                          province: x.province ?? "",
                          channel: x.channel ?? "",
                          levelId: x.levelId,
                          teamId: x.teamId ?? "",
                          userStatus: x.userStatus,
                        });
                      }}
                    >
                      编辑
                    </button>
                    <button
                      className="btn btnDanger"
                      disabled={busy}
                      onClick={async () => {
                        if (!confirm(`确定删除职工「${x.name}」吗？删除后无法恢复。`)) return;
                        setBusy(true);
                        setErr(null);
                        try {
                          await apiFetch(`/admin/agents/${x.id}`, { method: "DELETE" });
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
                  </td>
                </tr>
              ))}
              {list.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ color: "var(--muted)", padding: 14 }}>
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
          <button className="btn" disabled={list.length < pageSize} onClick={() => setOffset((v) => v + pageSize)}>
            下一页
          </button>
          <div className="cardMeta">offset={offset} limit={pageSize}</div>
        </div>

        {(createOpen || editing) && (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="cardTitle">{editing ? "编辑职工" : "新增职工"}</div>
            {!editing ? <div className="cardMeta">创建时需要设置登录账号与密码。</div> : null}

            <div className="cardGrid" style={{ marginTop: 10 }}>
              {!editing ? (
                <>
                  <div className="card" style={{ gridColumn: "span 6" }}>
                    <div className="label">用户名</div>
                    <input className="input mono" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
                  </div>
                  <div className="card" style={{ gridColumn: "span 6" }}>
                    <div className="label">密码</div>
                    <input
                      className="input mono"
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      placeholder="至少 6 位"
                    />
                  </div>
                </>
              ) : null}

              <div className="card" style={{ gridColumn: "span 6" }}>
                <div className="label">姓名</div>
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="card" style={{ gridColumn: "span 6" }}>
                <div className="label">手机号</div>
                <input className="input mono" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="card" style={{ gridColumn: "span 4" }}>
                <div className="label">工号</div>
                <input className="input mono" value={form.employeeNo} onChange={(e) => setForm({ ...form, employeeNo: e.target.value })} />
              </div>
              <div className="card" style={{ gridColumn: "span 4" }}>
                <div className="label">省份</div>
                <input className="input" value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} />
              </div>
              <div className="card" style={{ gridColumn: "span 4" }}>
                <div className="label">渠道</div>
                <input className="input" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} />
              </div>
              <div className="card" style={{ gridColumn: "span 6" }}>
                <div className="label">星级</div>
                <select className="input" value={form.levelId} onChange={(e) => setForm({ ...form, levelId: e.target.value })}>
                  {(levels.data ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="card" style={{ gridColumn: "span 6" }}>
                <div className="label">团队（可空）</div>
                <select className="input" value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })}>
                  <option value="">(无团队)</option>
                  {(teams.data ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.tag ? ` (${t.tag})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              {editing ? (
                <div className="card" style={{ gridColumn: "span 6" }}>
                  <div className="label">重置密码（可选）</div>
                  <input
                    className="input mono"
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="留空则不修改，填写需至少 6 位"
                  />
                </div>
              ) : null}
              {editing ? (
                <div className="card" style={{ gridColumn: "span 6" }}>
                  <div className="label">账号状态</div>
                  <select
                    className="input"
                    value={form.userStatus}
                    onChange={(e) => setForm({ ...form, userStatus: e.target.value as any })}
                  >
                    <option value="ACTIVE">启用</option>
                    <option value="DISABLED">停用</option>
                  </select>
                </div>
              ) : null}
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
                      await apiFetch(`/admin/agents/${editing.id}`, {
                        method: "PUT",
                        body: JSON.stringify({
                          name: form.name,
                          phone: form.phone.trim() || undefined,
                          employeeNo: form.employeeNo.trim() || undefined,
                          province: form.province.trim() || undefined,
                          channel: form.channel.trim() || undefined,
                          levelId: form.levelId,
                          teamId: form.teamId ? form.teamId : null,
                          userStatus: form.userStatus,
                          password: form.password.trim() ? form.password : undefined,
                        }),
                      });
                      setEditing(null);
                    } else {
                      await apiFetch("/admin/agents", {
                        method: "POST",
                        body: JSON.stringify({
                          username: form.username,
                          password: form.password,
                          name: form.name,
                          phone: form.phone.trim() || undefined,
                          employeeNo: form.employeeNo.trim() || undefined,
                          province: form.province.trim() || undefined,
                          channel: form.channel.trim() || undefined,
                          levelId: form.levelId,
                          teamId: form.teamId ? form.teamId : undefined,
                          status: "ACTIVE",
                        }),
                      });
                      setCreateOpen(false);
                    }
                    setForm(defaults);
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
