export function apiBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/+$/, "");
  }

  if (typeof window !== "undefined") {
    // Use same-origin proxy to avoid CORS + mixed-content issues in production.
    // next.config.mjs rewrites `/api/*` -> backend `http://127.0.0.1:3000/*`.
    return "/api";
  }

  return "http://localhost:3000";
}
