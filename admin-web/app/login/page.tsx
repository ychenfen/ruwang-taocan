"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { ApiError } from "../../lib/api";
import { apiBaseUrl } from "../../lib/env";
import { login } from "../../lib/auth";

function humanizeError(e: unknown): string {
  const err = e as ApiError;
  if (!err || typeof err !== "object") return "未知错误";

  if (err.code === "INVALID_CREDENTIALS") return "账号或密码错误，或账号已被禁用";
  if (err.code === "RATE_LIMITED") {
    const retry = err.details?.retryAfterSec;
    if (typeof retry === "number" && Number.isFinite(retry) && retry > 0) {
      return `尝试次数过多，请 ${retry}s 后再试`;
    }
    return "尝试次数过多，请稍后再试";
  }
  if (err.status >= 500) return "服务端错误，请稍后再试";
  return `请求失败：${err.code ?? "HTTP_ERROR"}`;
}

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hint = useMemo(() => {
    const base = apiBaseUrl();
    return `API: ${base}`;
  }, []);

  return (
    <div className="container" style={{ maxWidth: 980 }}>
      <div
        style={{
          minHeight: "calc(100vh - 36px)",
          display: "grid",
          gridTemplateColumns: "1.1fr 0.9fr",
          gap: 18,
          alignItems: "stretch",
        }}
      >
        <div
          style={{
            borderRadius: "var(--radius)",
            border: "1px solid var(--border)",
            background: "rgba(255,255,255,0.78)",
            boxShadow: "var(--shadow)",
            backdropFilter: "blur(10px)",
            padding: 18,
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: -40,
              background:
                "radial-gradient(700px 240px at 15% 10%, rgba(19,181,166,0.18), transparent 60%), radial-gradient(620px 240px at 80% 20%, rgba(11,77,214,0.18), transparent 60%)",
              filter: "blur(0px)",
              pointerEvents: "none",
            }}
          />
          <div style={{ position: "relative" }}>
            <div className="brand" style={{ marginBottom: 14 }}>
              <div className="brandMark" />
              <div>
                <div className="brandTitle" style={{ fontSize: 18 }}>
                  入网套餐后台
                </div>
                <div className="brandSub">结算 + 记账 + 审计</div>
              </div>
            </div>

            <div style={{ marginTop: 22, maxWidth: 520 }}>
              <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.06 }}>
                把佣金结算做成
                <br />
                可复算的账本
              </div>
              <div style={{ marginTop: 12, color: "var(--muted)", lineHeight: 1.6 }}>
                你会看到：结算跑批，审核入账，调整单差异，报表筛选导出，操作审计链路。
              </div>

              <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 999,
                    border: "1px solid rgba(17,24,39,0.10)",
                    background: "rgba(255,255,255,0.8)",
                    fontSize: 12,
                    color: "var(--muted)",
                  }}
                >
                  {hint}
                </div>
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 999,
                    border: "1px solid rgba(17,24,39,0.10)",
                    background: "rgba(255,255,255,0.8)",
                    fontSize: 12,
                    color: "var(--muted)",
                  }}
                >
                  端口：后台 3000 / 管理台 3001
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            borderRadius: "var(--radius)",
            border: "1px solid var(--border)",
            background: "rgba(255,255,255,0.78)",
            boxShadow: "var(--shadow)",
            backdropFilter: "blur(10px)",
            padding: 18,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}>管理员登录</div>
          <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 12 }}>
            仅管理员账号可用此入口（职工端请用 agent-web）。
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setSubmitting(true);
              setError(null);
              try {
                const user = await login(username.trim(), password);
                if (user.role !== "ADMIN") {
                  setError("该账号不是管理员");
                  return;
                }
                router.replace("/dashboard");
              } catch (err) {
                setError(humanizeError(err));
              } finally {
                setSubmitting(false);
              }
            }}
          >
            <div className="field" style={{ marginTop: 14 }}>
              <div className="label">用户名</div>
              <input
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                autoComplete="username"
              />
            </div>
            <div className="field">
              <div className="label">密码</div>
              <input
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                type="password"
                autoComplete="current-password"
              />
            </div>

            {error ? <div className="error">{error}</div> : null}

            <div className="btnRow" style={{ marginTop: 12 }}>
              <button className="btn btnPrimary" type="submit" disabled={submitting}>
                {submitting ? "登录中…" : "登录"}
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setUsername("admin");
                  setPassword("admin123456");
                }}
              >
                填入开发默认账号
              </button>
            </div>
          </form>

          <div style={{ marginTop: 14, color: "var(--muted)", fontSize: 12, lineHeight: 1.6 }}>
            安全提示：连续失败会触发限流（10 分钟窗口内 10 次失败锁 10 分钟）。
          </div>
        </div>
      </div>
    </div>
  );
}
