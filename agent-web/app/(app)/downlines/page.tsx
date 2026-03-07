"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";

import { apiFetch } from "../../../lib/api";
import { cardStatusLabel, formatDateYmd } from "../../../lib/display";
import { humanizeApiError } from "../../../lib/errors";

type Downline = Readonly<{
  level: 1 | 2;
  agentId: string;
  name: string;
  levelName: string;
  onNetCardCount: number;
  supportDiffRate: number;
  stableDiffRate: number;
}>;

type Card = Readonly<{
  id: string;
  ownerAgentId: string;
  ownerName: string;
  downlineLevel: number;
  cardNo: string;
  activatedAt: string;
  planName: string;
  monthlyRent: number;
  policyName?: string;
  currentStatus: string;
  currentStatusAt: string;
}>;

export default function DownlinesPage() {
  const downlines = useSWR("/agent/downlines", (p) => apiFetch<Downline[]>(p));
  const list = downlines.data ?? [];

  const pageSize = 50;
  const [level, setLevel] = useState<"" | "1" | "2">("");
  const [agentKeyword, setAgentKeyword] = useState("");
  const [onNetOnly, setOnNetOnly] = useState(true);
  const [offset, setOffset] = useState(0);

  const cards = useSWR(
    `/agent/downlines/cards?onNetOnly=${onNetOnly ? "true" : "false"}&limit=${pageSize}&offset=${offset}${
      level ? `&level=${level}` : ""
    }${agentKeyword.trim() ? `&agentKeyword=${encodeURIComponent(agentKeyword.trim())}` : ""}`,
    (p: string) => apiFetch<Card[]>(p),
  );
  const cardList = cards.data ?? [];

  const lvl1 = useMemo(() => list.filter((x) => x.level === 1), [list]);
  const lvl2 = useMemo(() => list.filter((x) => x.level === 2), [list]);

  return (
    <>
      <div className="mainHeader">
        <div>
          <div className="mainTitle">我的同事（一级/二级）</div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
            卡号一律脱敏。差价：仅到二级；同星级无差价。
          </div>
        </div>
        <div className="btnRow">
          <button
            className="btn"
            onClick={() => {
              setOffset(0);
              setOnNetOnly((v) => !v);
            }}
          >
            {onNetOnly ? "显示全部状态卡" : "仅看在网卡"}
          </button>
        </div>
      </div>

      <div className="mainBody">
        <div className="cardGrid">
          <div className="card" style={{ gridColumn: "span 6" }}>
            <div className="cardTitle">一级同事</div>
            <div className="tableWrap" style={{ marginTop: 10 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>姓名</th>
                    <th>星级</th>
                    <th style={{ textAlign: "right" }}>在网卡</th>
                    <th style={{ textAlign: "right" }}>扶持差价</th>
                    <th style={{ textAlign: "right" }}>稳定差价</th>
                  </tr>
                </thead>
                <tbody>
                  {lvl1.map((x) => (
                    <tr key={x.agentId}>
                      <td>{x.name}</td>
                      <td className="mono">{x.levelName}</td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {x.onNetCardCount}
                      </td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {(x.supportDiffRate * 100).toFixed(2)}%
                      </td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {(x.stableDiffRate * 100).toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                  {lvl1.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ color: "var(--muted)", padding: 14 }}>
                        暂无
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ gridColumn: "span 6" }}>
            <div className="cardTitle">二级同事</div>
            <div className="tableWrap" style={{ marginTop: 10 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>姓名</th>
                    <th>星级</th>
                    <th style={{ textAlign: "right" }}>在网卡</th>
                    <th style={{ textAlign: "right" }}>扶持差价</th>
                    <th style={{ textAlign: "right" }}>稳定差价</th>
                  </tr>
                </thead>
                <tbody>
                  {lvl2.map((x) => (
                    <tr key={x.agentId}>
                      <td>{x.name}</td>
                      <td className="mono">{x.levelName}</td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {x.onNetCardCount}
                      </td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {(x.supportDiffRate * 100).toFixed(2)}%
                      </td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {(x.stableDiffRate * 100).toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                  {lvl2.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ color: "var(--muted)", padding: 14 }}>
                        暂无
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ gridColumn: "span 12" }}>
            <div className="cardTitle">同事网卡（脱敏）</div>
            <div className="cardMeta">可按级别/职工姓名/工号筛选；用于核对是否在网。</div>

            <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 1fr", gap: 10, marginTop: 10 }}>
              <div className="field" style={{ margin: 0 }}>
                <div className="label">级别</div>
                <select
                  className="input"
                  value={level}
                  onChange={(e) => {
                    setOffset(0);
                    setLevel(e.target.value as "" | "1" | "2");
                  }}
                >
                  <option value="">(全部)</option>
                  <option value="1">一级</option>
                  <option value="2">二级</option>
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <div className="label">职工姓名/工号（可选）</div>
                <input
                  className="input"
                  value={agentKeyword}
                  onChange={(e) => {
                    setOffset(0);
                    setAgentKeyword(e.target.value);
                  }}
                  placeholder="例如：张三 / 10086"
                />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <div className="label">查询说明</div>
                <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6, paddingTop: 8 }}>
                  仅允许查询你的一/二级下级；越权会返回 403。
                </div>
              </div>
            </div>

            <div className="btnRow" style={{ marginTop: 10 }}>
              <button className="btn" disabled={offset === 0} onClick={() => setOffset((v) => Math.max(0, v - pageSize))}>
                上一页
              </button>
              <button
                className="btn"
                disabled={cardList.length < pageSize}
                onClick={() => setOffset((v) => v + pageSize)}
              >
                下一页
              </button>
              <div style={{ color: "var(--muted)", fontSize: 12, alignSelf: "center" }}>
                当前偏移 {offset}，本页 {cardList.length} 条
              </div>
            </div>
            {cards.error ? <div className="error" style={{ marginTop: 10 }}>{humanizeApiError(cards.error)}</div> : null}

            <div className="tableWrap" style={{ marginTop: 12 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>序号</th>
                    <th>层级</th>
                    <th>同事</th>
                    <th>卡号</th>
                    <th>入网日期</th>
                    <th>套餐</th>
                    <th style={{ textAlign: "right" }}>月租</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {cardList.map((x, idx) => (
                    <tr key={x.id}>
                      <td className="mono">{offset + idx + 1}</td>
                      <td className="mono">{x.downlineLevel}级</td>
                      <td>{x.ownerName}</td>
                      <td className="mono">{x.cardNo}</td>
                      <td className="mono">{formatDateYmd(x.activatedAt)}</td>
                      <td>{x.planName}</td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {x.monthlyRent.toFixed(2)}
                      </td>
                      <td className="mono">{cardStatusLabel(x.currentStatus)}</td>
                    </tr>
                  ))}
                  {cardList.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ color: "var(--muted)", padding: 14 }}>
                        暂无数据
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
