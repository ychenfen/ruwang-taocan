import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuth } from "../auth/prehandlers.js";
import { verifyPassword } from "../security/password.js";

const loginBody = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

type LoginBucket = {
  firstAtMs: number;
  failCount: number;
  lockedUntilMs: number;
};

const LOGIN_WINDOW_MS = 10 * 60_000;
const LOGIN_LOCK_MS = 10 * 60_000;
const LOGIN_MAX_FAILS = 10;
const loginBuckets = new Map<string, LoginBucket>();

function loginKey(ip: string, username: string): string {
  return `${ip}|${username.toLowerCase()}`;
}

function nowMs(): number {
  return Date.now();
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/auth/login", async (request, reply) => {
    const parsed = loginBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });

    const { username, password } = parsed.data;

    const ip = request.ip ?? "unknown";
    const k = loginKey(ip, username);
    const t = nowMs();
    const existingBucket = loginBuckets.get(k);
    if (existingBucket && existingBucket.lockedUntilMs > t) {
      return reply.code(429).send({
        error: "RATE_LIMITED",
        retryAfterSec: Math.max(Math.ceil((existingBucket.lockedUntilMs - t) / 1000), 1),
      });
    }

    const r = await app.db.query<{
      id: string;
      username: string;
      password_hash: string;
      role: "ADMIN" | "AGENT";
      status: "ACTIVE" | "DISABLED";
    }>(
      "select id, username, password_hash, role, status from users where username = $1 limit 1",
      [username],
    );
    const u = r.rows[0];
    if (!u || u.status !== "ACTIVE" || !verifyPassword(password, u.password_hash)) {
      const bucket = existingBucket ?? { firstAtMs: t, failCount: 0, lockedUntilMs: 0 };
      if (t - bucket.firstAtMs > LOGIN_WINDOW_MS) {
        bucket.firstAtMs = t;
        bucket.failCount = 0;
        bucket.lockedUntilMs = 0;
      }
      bucket.failCount += 1;
      if (bucket.failCount >= LOGIN_MAX_FAILS) {
        bucket.lockedUntilMs = t + LOGIN_LOCK_MS;
        loginBuckets.set(k, bucket);
        return reply.code(429).send({
          error: "RATE_LIMITED",
          retryAfterSec: Math.max(Math.ceil(LOGIN_LOCK_MS / 1000), 1),
        });
      }
      loginBuckets.set(k, bucket);
      return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
    }

    loginBuckets.delete(k);
    const token = app.jwt.sign({ sub: u.id, role: u.role });
    return reply.send({
      token,
      user: { id: u.id, username: u.username, role: u.role },
    });
  });

  app.get("/auth/me", { preHandler: [requireAuth] }, async (request, reply) => {
    if (reply.sent) return;
    const userId = request.user.sub;
    const r = await app.db.query<{ id: string; username: string; role: "ADMIN" | "AGENT"; status: string }>(
      "select id, username, role, status from users where id = $1",
      [userId],
    );
    const u = r.rows[0];
    if (!u) return reply.code(401).send({ error: "UNAUTHORIZED" });
    if (u.status !== "ACTIVE") return reply.code(403).send({ error: "DISABLED" });
    return reply.send({ id: u.id, username: u.username, role: u.role });
  });
};
