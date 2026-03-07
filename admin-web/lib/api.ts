import { apiBaseUrl } from "./env";
import { clearToken, getToken } from "./token";

export type ApiError = Readonly<{
  status: number;
  code: string;
  details?: any;
  message?: string;
}>;

export type ApiDownloadResult = Readonly<{
  blob: Blob;
  filename?: string;
  contentType: string;
}>;

function buildApiUrl(path: string): string {
  return `${apiBaseUrl()}${path.startsWith("/") ? "" : "/"}${path}`;
}

function parseFilenameFromDisposition(contentDisposition: string | null): string | undefined {
  if (!contentDisposition) return undefined;

  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const quotedMatch = /filename="([^"]+)"/i.exec(contentDisposition);
  if (quotedMatch?.[1]) return quotedMatch[1];

  const plainMatch = /filename=([^;]+)/i.exec(contentDisposition);
  if (plainMatch?.[1]) return plainMatch[1].trim();

  return undefined;
}

async function parseJsonSafe(res: Response): Promise<any> {
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    const text = await res.text();
    return text.length ? { raw: text } : null;
  }
  return res.json();
}

async function toApiError(res: Response): Promise<ApiError> {
  const data = await parseJsonSafe(res);
  if (res.status === 401 || res.status === 403) {
    clearToken();
  }
  const code = (data && typeof data === "object" && data.error) ? String(data.error) : "HTTP_ERROR";
  return { status: res.status, code, details: data, message: undefined };
}

function buildHeaders(init: RequestInit | undefined, accept: string): Headers {
  const token = getToken();
  const headers = new Headers(init?.headers ?? {});
  headers.set("accept", accept);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return headers;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = buildHeaders(init, "application/json");
  const url = buildApiUrl(path);
  const res = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
  });

  if (!res.ok) {
    throw await toApiError(res);
  }
  const data = await parseJsonSafe(res);
  return data as T;
}

export async function apiDownload(path: string, init?: RequestInit): Promise<ApiDownloadResult> {
  const headers = buildHeaders(init, "*/*");
  const url = buildApiUrl(path);
  const res = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
  });
  if (!res.ok) {
    throw await toApiError(res);
  }

  const blob = await res.blob();
  return {
    blob,
    filename: parseFilenameFromDisposition(res.headers.get("content-disposition")),
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
  };
}
