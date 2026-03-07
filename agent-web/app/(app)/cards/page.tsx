"use client";

import { useState } from "react";
import useSWR from "swr";

import { apiFetch } from "../../../lib/api";
import { cardStatusLabel, formatDateYmd } from "../../../lib/display";

type Card = Readonly<{
  id: string;
  cardNo: string;
  activatedAt: string;
  planName: string;
  monthlyRent: number;
  policyName?: string;
  currentStatus?: string;
  currentStatusAt?: string;
}>;

export default function CardsPage() {
  const pageSize = 50;
  const [onNetOnly, setOnNetOnly] = useState(true);
  const [offset, setOffset] = useState(0);
  const cards = useSWR(`/agent/cards?onNetOnly=${onNetOnly ? "true" : "false"}&limit=${pageSize}&offset=${offset}`, (p: string) =>
    apiFetch<Card[]>(p),
  );
  const list = cards.data ?? [];

  return (
    <>
      <div className="mainHeader">
        <div>
          <div className="mainTitle">我的网卡</div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
            默认仅显示在网（正常）。如需对账历史，请切换显示全部。
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
            {onNetOnly ? "显示全部状态" : "仅看在网"}
          </button>
        </div>
      </div>

      <div className="mainBody">
        <div className="btnRow" style={{ marginBottom: 10 }}>
          <button className="btn" disabled={offset === 0} onClick={() => setOffset((v) => Math.max(0, v - pageSize))}>
            上一页
          </button>
          <button
            className="btn"
            disabled={list.length < pageSize}
            onClick={() => setOffset((v) => v + pageSize)}
          >
            下一页
          </button>
          <div style={{ color: "var(--muted)", fontSize: 12, alignSelf: "center" }}>
            当前偏移 {offset}，本页 {list.length} 条
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
                <th>状态</th>
                <th>状态时间</th>
              </tr>
            </thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.id}>
                  <td className="mono">{x.cardNo}</td>
                  <td className="mono">{formatDateYmd(x.activatedAt)}</td>
                  <td>{x.planName}</td>
                  <td className="mono" style={{ textAlign: "right" }}>
                    {x.monthlyRent.toFixed(2)}
                  </td>
                  <td>{x.policyName ?? ""}</td>
                  <td className="mono">{cardStatusLabel(x.currentStatus ?? "")}</td>
                  <td className="mono">{x.currentStatusAt ? formatDateYmd(x.currentStatusAt) : ""}</td>
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
      </div>
    </>
  );
}
