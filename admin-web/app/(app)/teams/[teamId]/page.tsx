"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { useParams } from "next/navigation";

import { apiFetch } from "../../../../lib/api";
import { agentDisplayName, resolveAgentByKeyword, type LookupAgent } from "../../../../lib/agent-lookup";
import { formatDateYmd } from "../../../../lib/display";
import { humanizeApiError } from "../../../../lib/errors";

type Team = Readonly<{
  id: string;
  name: string;
  tag?: string;
  leaderName?: string;
  status: string;
  activeMemberCount: number;
}>;

type Member = Readonly<{
  agentId: string;
  name: string;
  levelId: string;
  levelName: string;
  joinedAt: string;
  phone?: string;
  employeeNo?: string;
  province?: string;
  channel?: string;
}>;

type AgentLite = LookupAgent;

export default function TeamDetailPage() {
  const params = useParams();
  const teamId = String((params as any)?.teamId ?? "");

  const teams = useSWR("/admin/teams", (p) => apiFetch<Team[]>(p));
  const members = useSWR(teamId ? `/admin/teams/${teamId}/members` : null, (p) => apiFetch<Member[]>(p));
  const allAgents = useSWR("/admin/agents", (p) => apiFetch<AgentLite[]>(p));

  const team = useMemo(() => (teams.data ?? []).find((x) => x.id === teamId) ?? null, [teams.data, teamId]);

  const [agentKeyword, setAgentKeyword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const list = members.data ?? [];
  const resolvedMemberTarget = useMemo(() => {
    const keyword = agentKeyword.trim();
    if (!keyword) return null;
    return resolveAgentByKeyword(keyword, allAgents.data ?? []);
  }, [agentKeyword, allAgents.data]);

  return (
    <>
      <div className="mainHeader">
        <div>
          <div className="mainTitle">团队成员</div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
            {team ? (
              <>
                <span>{team.name}</span>
                {team.tag ? <span className="mono"> ({team.tag})</span> : null}
                <span className="mono"> · {teamId}</span>
              </>
            ) : (
              <span className="mono">{teamId}</span>
            )}
          </div>
        </div>
        <div className="btnRow">
          <a className="btn" href="/teams">
            返回团队列表
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

        <div className="card" style={{ marginBottom: 12 }}>
          <div className="cardTitle">新增/转移成员</div>
          <div className="cardMeta">输入代理姓名/工号/账号即可（会自动从原团队转移）。</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, marginTop: 10 }}>
            <div>
              <input
                className="input"
                list="team-member-agent-options"
                value={agentKeyword}
                onChange={(e) => setAgentKeyword(e.target.value)}
                placeholder="例如：张三 / 10086 / zhangsan"
              />
              <datalist id="team-member-agent-options">
                {(allAgents.data ?? []).map((x) => (
                  <option key={x.id} value={x.employeeNo || x.name}>
                    {agentDisplayName(x)}
                  </option>
                ))}
              </datalist>
              {agentKeyword.trim() ? (
                <div className="cardMeta" style={{ marginTop: 6 }}>
                  {resolvedMemberTarget?.ok
                    ? `已匹配：${agentDisplayName(resolvedMemberTarget.agent)}`
                    : resolvedMemberTarget?.message ?? ""}
                </div>
              ) : null}
            </div>
            <button
              className="btn btnPrimary"
              disabled={busy || agentKeyword.trim().length === 0}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                setMsg(null);
                try {
                  const resolved = resolveAgentByKeyword(agentKeyword.trim(), allAgents.data ?? []);
                  if (!resolved.ok) {
                    setErr(resolved.message);
                    return;
                  }
                  const r = await apiFetch<any>(`/admin/teams/${teamId}/members`, {
                    method: "POST",
                    body: JSON.stringify({ agentId: resolved.agentId }),
                  });
                  setMsg(`完成：membershipId=${r.membershipId}`);
                  setAgentKeyword("");
                  await members.mutate();
                  await teams.mutate();
                } catch (e) {
                  setErr(humanizeApiError(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "处理中…" : "加入团队"}
            </button>
          </div>
        </div>

        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>星级</th>
                <th>加入时间</th>
                <th className="mono">agentId</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.agentId}>
                  <td>{m.name}</td>
                  <td className="mono">{m.levelName}</td>
                  <td className="mono">{formatDateYmd(m.joinedAt)}</td>
                  <td className="mono">{m.agentId}</td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="btn btnDanger"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setErr(null);
                        setMsg(null);
                        try {
                          await apiFetch(`/admin/teams/${teamId}/members/${m.agentId}`, { method: "DELETE" });
                          setMsg("已移除");
                          await members.mutate();
                          await teams.mutate();
                        } catch (e) {
                          setErr(humanizeApiError(e));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      删除成员
                    </button>
                  </td>
                </tr>
              ))}
              {!members.data ? (
                <tr>
                  <td colSpan={5} style={{ color: "var(--muted)", padding: 14 }}>
                    加载中…
                  </td>
                </tr>
              ) : null}
              {members.data && list.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ color: "var(--muted)", padding: 14 }}>
                    暂无成员
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
