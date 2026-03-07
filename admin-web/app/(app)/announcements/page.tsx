"use client";

import { useMemo, useState } from "react";
import useSWR, { mutate } from "swr";

import { apiFetch } from "../../../lib/api";
import { accountStatusLabel, formatDateYmd } from "../../../lib/display";
import { humanizeApiError } from "../../../lib/errors";

type Announcement = Readonly<{
  id: string;
  title: string;
  body: string;
  status: "ACTIVE" | "DISABLED";
  startsAt: string;
  endsAt?: string;
  createdAt: string;
  updatedAt: string;
}>;

type AnnouncementForm = Readonly<{
  title: string;
  body: string;
  status: "ACTIVE" | "DISABLED";
  startsAt: string;
  endsAt: string;
}>;

export default function AnnouncementsPage() {
  const anns = useSWR("/admin/announcements", (p) => apiFetch<Announcement[]>(p));
  const list = anns.data ?? [];
  const [pageSize] = useState(20);
  const [offset, setOffset] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const defaults = useMemo<AnnouncementForm>(
    () => ({
      title: "",
      body: "",
      status: "ACTIVE",
      startsAt: "",
      endsAt: "",
    }),
    [],
  );
  const [form, setForm] = useState<AnnouncementForm>(defaults);

  const refresh = async () => mutate("/admin/announcements");
  const page = useMemo(() => list.slice(offset, offset + pageSize), [list, offset, pageSize]);

  return (
    <>
      <div className="mainHeader">
        <div>
          <div className="mainTitle">公告</div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>职工端只会看到当前生效且启用中的公告。</div>
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
            新增公告
          </button>
        </div>
      </div>

      <div className="mainBody">
        {err ? <div className="error">{err}</div> : null}

        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>标题</th>
                <th>状态</th>
                <th>开始</th>
                <th>结束</th>
                <th>更新时间</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {page.map((x) => (
                <tr key={x.id}>
                  <td>{x.title}</td>
                  <td className="mono">{accountStatusLabel(x.status)}</td>
                  <td className="mono">{formatDateYmd(x.startsAt)}</td>
                  <td className="mono">{x.endsAt ? formatDateYmd(x.endsAt) : ""}</td>
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
                            title: x.title,
                            body: x.body,
                            status: x.status,
                            startsAt: x.startsAt,
                            endsAt: x.endsAt ?? "",
                          });
                        }}
                      >
                        编辑
                      </button>
                      <button
                        className="btn btnDanger"
                        disabled={busy}
                        onClick={async () => {
                          if (!confirm("确定删除该公告吗？删除后职工端将不可见，且不可恢复。")) return;
                          setBusy(true);
                          setErr(null);
                          try {
                            await apiFetch(`/admin/announcements/${x.id}`, { method: "DELETE" });
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
              {page.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ color: "var(--muted)", padding: 14 }}>
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
            <div className="cardTitle">{editing ? "编辑公告" : "新增公告"}</div>
            <div className="field" style={{ marginTop: 10 }}>
              <div className="label">标题</div>
              <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="field">
              <div className="label">内容</div>
              <textarea
                className="input"
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                rows={6}
                style={{ resize: "vertical", fontFamily: "var(--font-sans), system-ui, -apple-system, Segoe UI, sans-serif" }}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field" style={{ margin: 0 }}>
                <div className="label">状态</div>
                <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as any })}>
                  <option value="ACTIVE">启用</option>
                  <option value="DISABLED">停用</option>
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <div className="label">开始时间（可空，默认当前时间）</div>
                <input
                  className="input mono"
                  value={form.startsAt}
                  onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                  placeholder="2026-02-15T00:00:00+08:00"
                />
              </div>
            </div>
            <div className="field">
              <div className="label">结束时间（可空）</div>
              <input
                className="input mono"
                value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                placeholder="2026-12-31T23:59:59+08:00"
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
                      await apiFetch(`/admin/announcements/${editing.id}`, {
                        method: "PUT",
                        body: JSON.stringify({
                          title: form.title,
                          body: form.body,
                          status: form.status,
                          startsAt: form.startsAt.trim() || undefined,
                          endsAt: form.endsAt.trim() ? form.endsAt.trim() : null,
                        }),
                      });
                      setEditing(null);
                    } else {
                      await apiFetch("/admin/announcements", {
                        method: "POST",
                        body: JSON.stringify({
                          title: form.title,
                          body: form.body,
                          status: form.status,
                          startsAt: form.startsAt.trim() || undefined,
                          endsAt: form.endsAt.trim() ? form.endsAt.trim() : null,
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
