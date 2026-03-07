"use client";

import { useState } from "react";
import useSWR from "swr";

import { apiFetch } from "../../../lib/api";
import { cardStatusLabel, formatDateYmd } from "../../../lib/display";

type TeamMember = Readonly<{
  agentId: string;
  name: string;
  teamLabel: string;
  levelName: string;
  onNetCardCount: number;
}>;

type TeamCard = Readonly<{
  id: string;
  ownerAgentId: string;
  ownerName: string;
  teamLabel: string;
  cardNo: string;
  isOwn: boolean;
  activatedAt: string;
  planName: string;
  monthlyRent: number;
  policyName?: string;
  currentStatus: string;
  currentStatusAt: string;
}>;

export default function TeamPage() {
  const pageSize = 50;
  const members = useSWR("/agent/team-members", (p: string) => apiFetch<TeamMember[]>(p));
  const [onNetOnly, setOnNetOnly] = useState(true);
  const [offset, setOffset] = useState(0);
  const cards = useSWR(
    `/agent/team/cards?onNetOnly=${onNetOnly ? "true" : "false"}&limit=${pageSize}&offset=${offset}`,
    (p: string) => apiFetch<TeamCard[]>(p),
  );

  const memberList = members.data ?? [];
  const cardList = cards.data ?? [];

  return (
    <>
      <div className="mainHeader">
        <div>
          <div className="mainTitle">我的团队</div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
            团队展示只看成员姓名、在网号卡数量、星级。团队卡号：本人完整号；非本人脱敏。
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
            <div className="cardTitle">团队成员</div>
            <div className="tableWrap" style={{ marginTop: 10 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>团队标签</th>
                    <th>成员</th>
                    <th>星级</th>
                    <th style={{ textAlign: "right" }}>在网卡</th>
                  </tr>
                </thead>
                <tbody>
                  {memberList.map((x) => (
                    <tr key={x.agentId}>
                      <td className="mono">{x.teamLabel}</td>
                      <td>{x.name}</td>
                      <td className="mono">{x.levelName}</td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {x.onNetCardCount}
                      </td>
                    </tr>
                  ))}
                  {memberList.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ color: "var(--muted)", padding: 14 }}>
                        你当前没有团队，或团队暂无成员
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ gridColumn: "span 6" }}>
            <div className="cardTitle">团队网卡</div>
            <div className="cardMeta">用于核对团队在网情况；非本人卡号会脱敏。</div>
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
            <div className="tableWrap" style={{ marginTop: 10 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>团队标签</th>
                    <th>成员</th>
                    <th>卡号</th>
                    <th>入网日期</th>
                    <th>套餐</th>
                    <th style={{ textAlign: "right" }}>月租</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {cardList.map((x) => (
                    <tr key={x.id}>
                      <td className="mono">{x.teamLabel}</td>
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
                      <td colSpan={7} style={{ color: "var(--muted)", padding: 14 }}>
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
