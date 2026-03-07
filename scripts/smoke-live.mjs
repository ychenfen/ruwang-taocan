#!/usr/bin/env node

const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3000";
const ADMIN_WEB_URL = process.env.ADMIN_WEB_URL ?? "http://127.0.0.1:3001";
const AGENT_WEB_URL = process.env.AGENT_WEB_URL ?? "http://127.0.0.1:3002";
const ADMIN_USER = process.env.ADMIN_USER ?? "admin";
const ADMIN_PASS = process.env.ADMIN_PASS ?? "admin123456";
const READY_TIMEOUT_MS = Number(process.env.SMOKE_READY_TIMEOUT_MS ?? 120000);
const READY_RETRY_MS = Number(process.env.SMOKE_READY_RETRY_MS ?? 2000);

function logOk(msg) {
  console.log(`[OK] ${msg}`);
}

function logFail(msg) {
  console.error(`[FAIL] ${msg}`);
}

function ymPrev() {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}`;
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const ct = res.headers.get("content-type") ?? "";
  const body = ct.includes("application/json") ? await res.json() : await res.text();
  return { res, body };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttpReady(url, label, timeoutMs = READY_TIMEOUT_MS, retryMs = READY_RETRY_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        logOk(`${label}: ${res.status}`);
        return;
      }
      lastErr = new Error(`${label} expected 200, got ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await sleep(retryMs);
  }
  throw new Error(
    `timeout waiting for ${label} (${timeoutMs}ms): ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

async function main() {
  const month = ymPrev();

  await waitForHttpReady(`${API_BASE_URL}/health`, "backend health");
  await waitForHttpReady(`${ADMIN_WEB_URL}/login`, "admin-web /login");
  await waitForHttpReady(`${AGENT_WEB_URL}/login`, "agent-web /login");

  const login = await fetchJson(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  if (!login.res.ok || !login.body?.token) {
    throw new Error(`admin login failed: ${login.res.status}`);
  }
  const token = login.body.token;
  logOk("admin login");

  const me = await fetchJson(`${API_BASE_URL}/auth/me`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!me.res.ok || me.body?.role !== "ADMIN") {
    throw new Error(`/auth/me failed or role mismatch: ${me.res.status}`);
  }
  logOk("auth/me");

  const audit = await fetchJson(`${API_BASE_URL}/admin/audit-logs?limit=1`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!audit.res.ok) {
    throw new Error(`/admin/audit-logs failed: ${audit.res.status}`);
  }
  logOk("admin/audit-logs");

  const preview = await fetchJson(
    `${API_BASE_URL}/admin/reports/settlement-items-preview?commissionMonth=${encodeURIComponent(month)}&limit=1&offset=0`,
    {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    },
  );
  if (!(preview.res.status === 200 || preview.res.status === 404)) {
    throw new Error(`/admin/reports/settlement-items-preview unexpected status: ${preview.res.status}`);
  }
  logOk(`reports preview (${preview.res.status === 200 ? "run exists" : "run not found"})`);

  const ledger = await fetchJson(`${API_BASE_URL}/admin/ledger/entries?limit=1&offset=0`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!ledger.res.ok) {
    throw new Error(`/admin/ledger/entries failed: ${ledger.res.status}`);
  }
  logOk("ledger entries");

  console.log("Smoke live check passed.");
}

main().catch((err) => {
  logFail(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
