"use client";

import { useMemo, useState } from "react";
import useSWR, { mutate } from "swr";

import { apiFetch } from "../../../lib/api";
import { agentDisplayName, resolveAgentByKeyword, type LookupAgent } from "../../../lib/agent-lookup";
import { accountStatusLabel, formatDateYmd } from "../../../lib/display";
import { humanizeApiError } from "../../../lib/errors";

type Team = Readonly<{
  id: string;
  name: string;
  tag?: string;
  leaderAgentId?: string;
  leaderName?: string;
  status: "ACTIVE" | "DISABLED";
  createdAt: string;
  activeMemberCount: number;
}>;

type TeamForm = Readonly<{
  name: string;
  tag: string;
  leaderAgentKeyword: string;
  status: "ACTIVE" | "DISABLED";
}>;

type AgentLite = LookupAgent;

export default function TeamsPage() {
  const teams = useSWR("/admin/teams", (p) => apiFetch<Team[]>(p));
  const allAgents = useSWR("/admin/agents", (p) => apiFetch<AgentLite[]>(p));
  const list = teams.data ?? [];
  const [pageSize] = useState(20);
  const [offset, setOffset] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Team | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const defaults = useMemo<TeamForm>(
    () => ({
      name: "",
      tag: "",
      leaderAgentKeyword: "",
      status: "ACTIVE",
    }),
    [],
  );
  const [form, setForm] = useState<TeamForm>(defaults);

  const resolvedLeader = useMemo(() => {
    const keyword = form.leaderAgentKeyword.trim();
    if (!keyword) return null;
    return resolveAgentByKeyword(keyword, allAgents.data ?? []);
  }, [form.leaderAgentKeyword, allAgents.data]);

  const refresh = async () => mutate("/admin/teams");
  const page = useMemo(() => list.slice(offset, offset + pageSize), [list, offset, pageSize]);

  return (
    <>
      <div className="mainHeader">
        <div>
          <div className="mainTitle">团队</div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
            团队标签/名称可自定义；代理同一时间只能归属一个团队（通过历史表维护）。
          </div>
        </div>
        <div className="btnRow">
          <button
            className="btn btnPrimary"
            onClick={() => {
              setErr(null);
              setEditing(null);
              setForm(defaults);
              setCreateOpen(true);
            }}
          >
            新增团队
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
                <th>标签</th>
                <th>队长</th>
                <th style={{ textAlign: "right" }}>成员</th>
                <th>状态</th>
                <th>创建时间</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {page.map((x) => (
                <tr key={x.id}>
                  <td>{x.name}</td>
                  <td className="mono">{x.tag ?? ""}</td>
                  <td>{x.leaderName ?? ""}</td>
                  <td className="mono" style={{ textAlign: "right" }}>
                    {x.activeMemberCount}
                  </td>
                  <td className="mono">{accountStatusLabel(x.status)}</td>
                  <td className="mono">{formatDateYmd(x.createdAt)}</td>
                  <td style={{ textAlign: "right", display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                    <a className="btn" href={`/teams/${x.id}`}>
                      成员
                    </a>
                    <button
                      className="btn"
                      onClick={() => {
                        setErr(null);
                        setCreateOpen(false);
                        setEditing(x);
                        setForm({
                          name: x.name,
                          tag: x.tag ?? "",
                          leaderAgentKeyword: x.leaderAgentId ?? x.leaderName ?? "",
                          status: x.status,
                        });
                      }}
                    >
                      编辑
                    </button>
                    <button
                      className="btn btnDanger"
                      disabled={busy}
                      onClick={async () => {
                        if (!confirm("确定删除该团队吗？如仍有成员或成员历史，将被拦截。")) return;
                        setBusy(true);
                        setErr(null);
                        try {
                          await apiFetch(`/admin/teams/${x.id}`, { method: "DELETE" });
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
              {page.length === 0 ? (
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
          <button className="btn" disabled={offset + pageSize >= list.length} onClick={() => setOffset((v) => v + pageSize)}>
            下一页
          </button>
          <div className="cardMeta">offset={offset} limit={pageSize} total={list.length}</div>
        </div>

        {(createOpen || editing) && (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="cardTitle">{editing ? "编辑团队" : "新增团队"}</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
              <div className="field" style={{ margin: 0 }}>
                <div className="label">名称</div>
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <div className="label">标签（可选）</div>
                <input className="input mono" value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <div className="label">队长（姓名/工号，可选）</div>
                <input
                  className="input"
                  list="leader-agent-options"
                  value={form.leaderAgentKeyword}
                  onChange={(e) => setForm({ ...form, leaderAgentKeyword: e.target.value })}
                  placeholder="例如：张三 / 10086 / zhangsan"
                />
                <datalist id="leader-agent-options">
                  {(allAgents.data ?? []).map((x) => (
                    <option key={x.id} value={x.employeeNo || x.name}>
                      {agentDisplayName(x)}
                    </option>
                  ))}
                </datalist>
                {form.leaderAgentKeyword.trim() ? (
                  <div className="cardMeta" style={{ marginTop: 6 }}>
                    {resolvedLeader?.ok ? `已匹配：${agentDisplayName(resolvedLeader.agent)}` : resolvedLeader?.message ?? ""}
                  </div>
                ) : null}
              </div>
              <div className="field" style={{ margin: 0 }}>
                <div className="label">状态</div>
                <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as any })}>
                  <option value="ACTIVE">启用</option>
                  <option value="DISABLED">停用</option>
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
                    const resolved =
                      form.leaderAgentKeyword.trim().length > 0
                        ? resolveAgentByKeyword(form.leaderAgentKeyword.trim(), allAgents.data ?? [])
                        : null;
                    if (resolved && !resolved.ok) {
                      setErr(resolved.message);
                      return;
                    }
                    if (editing) {
                      await apiFetch(`/admin/teams/${editing.id}`, {
                        method: "PUT",
                        body: JSON.stringify({
                          name: form.name,
                          tag: form.tag.trim() || undefined,
                          leaderAgentId: resolved?.ok ? resolved.agentId : undefined,
                          status: form.status,
                        }),
                      });
                      setEditing(null);
                    } else {
                      await apiFetch("/admin/teams", {
                        method: "POST",
                        body: JSON.stringify({
                          name: form.name,
                          tag: form.tag.trim() || undefined,
                          leaderAgentId: resolved?.ok ? resolved.agentId : undefined,
                          status: form.status,
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
