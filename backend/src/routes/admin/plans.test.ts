import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import type { Db } from "../../db.js";
import { setupAdminTestApp } from "../../test/setupAdminTestApp.js";

describe("/admin/plans", () => {
  let app: FastifyInstance;
  let db: Db;
  let token: string;

  beforeAll(async () => {
    const t = await setupAdminTestApp();
    app = t.app;
    db = t.db;
    token = t.token;
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires auth", async () => {
    const res = await app.inject({ method: "GET", url: "/admin/plans" });
    expect(res.statusCode).toBe(401);
  });

  it("creates and updates a plan", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/admin/plans",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "双百套餐 2.0", monthlyRent: 29 },
    });
    expect(createRes.statusCode).toBe(201);
    const planId = createRes.json().id as string;
    expect(typeof planId).toBe("string");

    const listRes1 = await app.inject({
      method: "GET",
      url: "/admin/plans",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listRes1.statusCode).toBe(200);
    const list1 = listRes1.json() as any[];
    expect(list1.some((p) => p.id === planId && p.name === "双百套餐 2.0" && p.monthlyRent === 29)).toBe(true);

    const updRes = await app.inject({
      method: "PUT",
      url: `/admin/plans/${planId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { monthlyRent: 30.5, status: "DISABLED" },
    });
    expect(updRes.statusCode).toBe(200);

    const listRes2 = await app.inject({
      method: "GET",
      url: "/admin/plans",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listRes2.statusCode).toBe(200);
    const list2 = listRes2.json() as any[];
    expect(list2.some((p) => p.id === planId && p.monthlyRent === 30.5 && p.status === "DISABLED")).toBe(true);
  });

  it("deletes unused plan and blocks deleting in-use plan", async () => {
    const create1 = await app.inject({
      method: "POST",
      url: "/admin/plans",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: `可删套餐-${Date.now()}`, monthlyRent: 19.9 },
    });
    expect(create1.statusCode).toBe(201);
    const deletableId = create1.json().id as string;

    const del1 = await app.inject({
      method: "DELETE",
      url: `/admin/plans/${deletableId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del1.statusCode).toBe(200);
    expect(del1.json().ok).toBe(true);

    const create2 = await app.inject({
      method: "POST",
      url: "/admin/plans",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: `占用套餐-${Date.now()}`, monthlyRent: 29 },
    });
    expect(create2.statusCode).toBe(201);
    const usedId = create2.json().id as string;

    await db.query(
      `insert into cards (id, card_no, activated_at, plan_id, policy_id, created_by, created_at)
       values ($1, $2, $3, $4, null, null, now())`,
      [randomUUID(), `PLOCK-${Date.now()}`, "2026-01-01", usedId],
    );

    const del2 = await app.inject({
      method: "DELETE",
      url: `/admin/plans/${usedId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del2.statusCode).toBe(409);
    expect(del2.json().error).toBe("PLAN_IN_USE");
  });
});
