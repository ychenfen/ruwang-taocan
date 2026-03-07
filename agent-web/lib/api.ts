import { apiBaseUrl } from "./env";
import { clearToken, getToken } from "./token";

export type ApiError = Readonly<{
  status: number;
  code: string;
  details?: any;
  message?: string;
}>;

async function parseJsonSafe(res: Response): Promise<any> {
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    const text = await res.text();
    return text.length ? { raw: text } : null;
  }
  return res.json();
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers = new Headers(init?.headers ?? {});
  headers.set("accept", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");

  const url = `${apiBaseUrl()}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
  });

  const data = await parseJsonSafe(res);
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) clearToken();
    const code = data && typeof data === "object" && data.error ? String(data.error) : "HTTP_ERROR";
    const err: ApiError = { status: res.status, code, details: data, message: undefined };
    throw err;
  }
  return data as T;
}

