import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { FastifyInstance } from "fastify";

import { setupAdminTestApp } from "../../test/setupAdminTestApp.js";

describe("/admin/agent-levels", () => {
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

  it("deletes unused level and blocks deleting in-use level", async () => {
    const create1 = await app.inject({
      method: "POST",
      url: "/admin/agent-levels",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: `可删星级-${Date.now()}`,
        supportRate: 0.03,
        stableRate: 0.01,
        stableMonths: 12,
      },
    });
    expect(create1.statusCode).toBe(201);
    const deletableId = create1.json().id as string;

    const del1 = await app.inject({
      method: "DELETE",
      url: `/admin/agent-levels/${deletableId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del1.statusCode).toBe(200);
    expect(del1.json().ok).toBe(true);

    const create2 = await app.inject({
      method: "POST",
      url: "/admin/agent-levels",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: `占用星级-${Date.now()}`,
        supportRate: 0.05,
        stableRate: 0.02,
        stableMonths: 24,
      },
    });
    expect(create2.statusCode).toBe(201);
    const usedId = create2.json().id as string;

    const createAgent = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        username: `lvlblock${Date.now()}`,
        password: "agent123456",
        name: "星级占用测试员",
        levelId: usedId,
      },
    });
    expect(createAgent.statusCode).toBe(201);

    const del2 = await app.inject({
      method: "DELETE",
      url: `/admin/agent-levels/${usedId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del2.statusCode).toBe(409);
    expect(del2.json().error).toBe("AGENT_LEVEL_IN_USE");
  });
});
