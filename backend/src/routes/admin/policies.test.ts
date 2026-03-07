import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { FastifyInstance } from "fastify";

import { setupAdminTestApp } from "../../test/setupAdminTestApp.js";

describe("/admin/policies", () => {
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

  it("creates and updates policies", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/admin/policies",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "政策A" },
    });
    expect(create.statusCode).toBe(201);
    const id = create.json().id as string;

    const list1 = await app.inject({
      method: "GET",
      url: "/admin/policies",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list1.statusCode).toBe(200);
    expect((list1.json() as any[]).some((p) => p.id === id && p.name === "政策A")).toBe(true);

    const upd = await app.inject({
      method: "PUT",
      url: `/admin/policies/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: "DISABLED" },
    });
    expect(upd.statusCode).toBe(200);

    const list2 = await app.inject({
      method: "GET",
      url: "/admin/policies",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list2.statusCode).toBe(200);
    expect((list2.json() as any[]).some((p) => p.id === id && p.status === "DISABLED")).toBe(true);
  });
});

