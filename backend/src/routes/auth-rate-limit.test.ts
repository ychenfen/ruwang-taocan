import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { FastifyInstance } from "fastify";

import { setupAdminTestApp } from "../test/setupAdminTestApp.js";

describe("/auth/login rate limiting", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const t = await setupAdminTestApp();
    app = t.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it("locks after too many failures within a window", async () => {
    const username = "rate_limit_user";

    for (let i = 0; i < 9; i += 1) {
      const r = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { username, password: "wrong" },
      });
      expect(r.statusCode).toBe(401);
    }

    const r10 = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username, password: "wrong" },
    });
    expect(r10.statusCode).toBe(429);
    expect(r10.json().error).toBe("RATE_LIMITED");

    const r11 = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username, password: "wrong" },
    });
    expect(r11.statusCode).toBe(429);
  });
});

