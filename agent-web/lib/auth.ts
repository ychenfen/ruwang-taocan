import { apiFetch } from "./api";
import { setToken } from "./token";

export type AuthUser = Readonly<{
  id: string;
  username: string;
  role: "ADMIN" | "AGENT";
}>;

export async function login(username: string, password: string): Promise<AuthUser> {
  const res = await apiFetch<{ token: string; user: AuthUser }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  setToken(res.token);
  return res.user;
}

