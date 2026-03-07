"use client";

import { useState } from "react";

import { apiFetch } from "../../../lib/api";
import { humanizeApiError } from "../../../lib/errors";

export default function AdminAccountPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  return (
    <>
      <div className="mainHeader">
        <div>
          <div className="mainTitle">管理员密码</div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
            修改当前登录管理员的密码。修改后请使用新密码登录后台。
          </div>
        </div>
      </div>

      <div className="mainBody">
        {msg ? <div style={{ marginBottom: 10, fontSize: 12, color: "var(--muted)" }}>{msg}</div> : null}
        {err ? <div className="error">{err}</div> : null}

        <div className="card" style={{ maxWidth: 680 }}>
          <div className="cardTitle">修改密码</div>
          <div className="field" style={{ marginTop: 10 }}>
            <div className="label">当前密码</div>
            <input
              className="input mono"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="field">
            <div className="label">新密码</div>
            <input
              className="input mono"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="至少 6 位"
              autoComplete="new-password"
            />
          </div>
          <div className="field">
            <div className="label">确认新密码</div>
            <input
              className="input mono"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          <div className="btnRow" style={{ marginTop: 10 }}>
            <button
              className="btn btnPrimary"
              disabled={busy}
              onClick={async () => {
                setErr(null);
                setMsg(null);
                if (!currentPassword || !newPassword || !confirmPassword) {
                  setErr("请完整填写密码字段。");
                  return;
                }
                if (newPassword.length < 6) {
                  setErr("新密码至少 6 位。");
                  return;
                }
                if (newPassword !== confirmPassword) {
                  setErr("两次输入的新密码不一致。");
                  return;
                }
                setBusy(true);
                try {
                  await apiFetch("/admin/account/password", {
                    method: "POST",
                    body: JSON.stringify({
                      currentPassword,
                      newPassword,
                    }),
                  });
                  setCurrentPassword("");
                  setNewPassword("");
                  setConfirmPassword("");
                  setMsg("密码已修改成功。");
                } catch (e) {
                  setErr(humanizeApiError(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "提交中…" : "修改密码"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

