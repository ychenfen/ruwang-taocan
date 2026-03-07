import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { FastifyInstance } from "fastify";

import { setupAdminTestApp } from "../../test/setupAdminTestApp.js";

describe("/admin/account/password", () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    const t = await setupAdminTestApp();
    app = t.app;
    token = t.token;
  });

  afterAll(async () => {
    await app.close();
  });

  it("changes admin password and old password stops working", async () => {
    const change = await app.inject({
      method: "POST",
      url: "/admin/account/password",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        currentPassword: "admin123456",
        newPassword: "admin654321",
      },
    });
    expect(change.statusCode).toBe(200);
    expect(change.json().ok).toBe(true);

    const oldLogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: "admin", password: "admin123456" },
    });
    expect(oldLogin.statusCode).toBe(401);
    expect(oldLogin.json().error).toBe("INVALID_CREDENTIALS");

    const newLogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: "admin", password: "admin654321" },
    });
    expect(newLogin.statusCode).toBe(200);
    expect(newLogin.json().user.role).toBe("ADMIN");
  });
});

