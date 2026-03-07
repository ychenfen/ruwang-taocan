"use client";

import useSWR from "swr";

import { apiFetch } from "../../../lib/api";
import { formatDateYmd } from "../../../lib/display";

type Announcement = Readonly<{
  id: string;
  title: string;
  body: string;
  startsAt: string;
  endsAt?: string;
  createdAt: string;
}>;

export default function AnnouncementsPage() {
  const ann = useSWR("/agent/announcements", (p) => apiFetch<Announcement[]>(p));
  const list = ann.data ?? [];

  return (
    <>
      <div className="mainHeader">
        <div>
          <div className="mainTitle">公告</div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
            仅展示当前生效且启用中的公告（在开始/结束时间范围内）。
          </div>
        </div>
      </div>

      <div className="mainBody">
        <div className="cardGrid">
          {list.map((x) => (
            <div key={x.id} className="card" style={{ gridColumn: "span 12" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.02em" }}>{x.title}</div>
                <div className="mono" style={{ color: "var(--muted)", fontSize: 12 }}>
                  {formatDateYmd(x.startsAt)}
                  {x.endsAt ? ` ~ ${formatDateYmd(x.endsAt)}` : ""}
                </div>
              </div>
              <div style={{ marginTop: 10, whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{x.body}</div>
            </div>
          ))}
          {list.length === 0 ? (
            <div className="card" style={{ gridColumn: "span 12", color: "var(--muted)" }}>
              暂无公告
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
