"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { useParams } from "next/navigation";

import { apiFetch } from "../../../../lib/api";
import { humanizeApiError } from "../../../../lib/errors";

type Agent = Readonly<{
  id: string;
  username: string;
  userStatus: string;
  name: string;
  levelName: string;
  teamName?: string;
}>;

type Upline = Readonly<{
  uplineAgentId: string | null;
  uplineName?: string;
}>;

type CardRow = Readonly<{
  ownerAgentId?: string;
  currentStatus?: string;
}>;

export default function AgentDetailPage() {
  const params = useParams();
  const agentId = String((params as any)?.agentId ?? "");

  const agents = useSWR("/admin/agents", (p) => apiFetch<Agent[]>(p));
  const upline = useSWR(agentId ? `/admin/agents/${agentId}/upline` : null, (p) => apiFetch<Upline>(p));
  const cards = useSWR("/admin/cards", (p) => apiFetch<CardRow[]>(p));

  const agent = useMemo(() => (agents.data ?? []).find((a) => a.id === agentId) ?? null, [agents.data, agentId]);

  const onNetCardCount = useMemo(() => {
    let n = 0;
    for (const c of cards.data ?? []) {
      if (c.ownerAgentId === agentId && c.currentStatus === "NORMAL") n += 1;
    }
    return n;
  }, [cards.data, agentId]);

  const [newUplineId, setNewUplineId] = useState("");
  const [uplineEffectiveAt, setUplineEffectiveAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <>
      <div className="mainHeader">
        <div>
          <div className="mainTitle">职工详情</div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
            <span className="mono">{agentId}</span>
          </div>
        </div>
        <div className="btnRow">
          <a className="btn" href="/agents">
            返回列表
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
            <div className="cardTitle">基本信息</div>
            <div className="cardMeta" style={{ marginTop: 8 }}>
              {agent ? (
                <>
                  <div>姓名：{agent.name}</div>
                  <div className="mono">用户名：{agent.username}</div>
                  <div className="mono">状态：{agent.userStatus}</div>
                  <div>星级：{agent.levelName}</div>
                  <div>团队：{agent.teamName ?? "(无)"}</div>
                  <div className="mono">在网卡：{onNetCardCount}</div>
                </>
              ) : (
                <div style={{ color: "var(--muted)" }}>加载中…</div>
              )}
            </div>
          </div>

          <div className="card" style={{ gridColumn: "span 6" }}>
            <div className="cardTitle">上下级</div>
            <div className="cardMeta" style={{ marginTop: 8 }}>
              当前上级：{" "}
              {upline.data ? (
                upline.data.uplineAgentId ? (
                  <>
                    <span className="mono">{upline.data.uplineAgentId}</span> {upline.data.uplineName ? <span>({upline.data.uplineName})</span> : null}
                  </>
                ) : (
                  "(无)"
                )
              ) : (
                "加载中…"
              )}
            </div>

            <div className="field" style={{ marginTop: 10 }}>
              <div className="label">设置新上级（可选）</div>
              <select className="input" value={newUplineId} onChange={(e) => setNewUplineId(e.target.value)}>
                <option value="">(清空上级)</option>
                {(agents.data ?? [])
                  .filter((a) => a.id !== agentId)
                  .slice(0, 2000)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.username})
                    </option>
                  ))}
              </select>
              <div className="cardMeta" style={{ marginTop: 8 }}>
                如果代理数量很多，后续再加搜索选择器。
              </div>
            </div>

            <div className="field">
              <div className="label">生效日期</div>
              <input
                className="input mono"
                type="date"
                value={uplineEffectiveAt}
                onChange={(e) => setUplineEffectiveAt(e.target.value)}
              />
              <div className="cardMeta" style={{ marginTop: 8 }}>
                历史月重算请回填到真实生效日（按月末关系快照计算差价）。
              </div>
            </div>

            <div className="btnRow" style={{ marginTop: 10 }}>
              <button
                className="btn btnPrimary"
                disabled={busy}
                onClick={async () => {
                  if (!/^\d{4}-\d{2}-\d{2}$/u.test(uplineEffectiveAt)) {
                    setErr("生效日期格式错误，请选择有效日期。");
                    return;
                  }
                  setBusy(true);
                  setErr(null);
                  setMsg(null);
                  try {
                    await apiFetch(`/admin/agents/${agentId}/upline`, {
                      method: "PUT",
                      body: JSON.stringify({
                        uplineAgentId: newUplineId || null,
                        effectiveAt: uplineEffectiveAt,
                      }),
                    });
                    setMsg("已更新上级");
                    await upline.mutate();
                  } catch (e) {
                    setErr(humanizeApiError(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "保存中…" : "保存上级"}
              </button>
              <button className="btn" onClick={() => upline.mutate()}>
                刷新
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
