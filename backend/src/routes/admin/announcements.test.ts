import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { FastifyInstance } from "fastify";

import { setupAdminTestApp } from "../../test/setupAdminTestApp.js";

describe("/admin/announcements + audit + /agent/announcements", () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    const t = await setupAdminTestApp();
    app = t.app;
    adminToken = t.token;
  });

  afterAll(async () => {
    await app.close();
  });

  it("admin can create/update announcements; agent can see active announcements; audit log recorded", async () => {
    // Create an agent so /agent/* works.
    const levelId = (
      await app.inject({
        method: "POST",
        url: "/admin/agent-levels",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: "公告测试等级", supportRate: 0.03, stableRate: 0.01, stableMonths: 12 },
      })
    ).json().id as string;

    const agent = await app.inject({
      method: "POST",
      url: "/admin/agents",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username: "annAgent", password: "agent123456", name: "公告代理", levelId },
    });
    expect(agent.statusCode).toBe(201);

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: "annAgent", password: "agent123456" },
    });
    expect(login.statusCode).toBe(200);
    const agentToken = login.json().token as string;

    const create = await app.inject({
      method: "POST",
      url: "/admin/announcements",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { title: "公告1", body: "内容1", status: "ACTIVE" },
    });
    expect(create.statusCode).toBe(201);
    const annId = create.json().id as string;

    const agentList1 = await app.inject({
      method: "GET",
      url: "/agent/announcements",
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(agentList1.statusCode).toBe(200);
    expect((agentList1.json() as any[]).some((x) => x.id === annId && x.title === "公告1")).toBe(true);

    const audit = await app.inject({
      method: "GET",
      url: `/admin/audit-logs?action=ANNOUNCEMENT_CREATE&entityType=announcements&entityId=${annId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(audit.statusCode).toBe(200);
    expect((audit.json() as any[]).some((x) => x.action === "ANNOUNCEMENT_CREATE" && x.entityId === annId)).toBe(true);

    const upd = await app.inject({
      method: "PUT",
      url: `/admin/announcements/${annId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { status: "DISABLED" },
    });
    expect(upd.statusCode).toBe(200);

    const agentList2 = await app.inject({
      method: "GET",
      url: "/agent/announcements",
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(agentList2.statusCode).toBe(200);
    expect((agentList2.json() as any[]).some((x) => x.id === annId)).toBe(false);

    const del = await app.inject({
      method: "DELETE",
      url: `/admin/announcements/${annId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().ok).toBe(true);

    const adminList = await app.inject({
      method: "GET",
      url: "/admin/announcements",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(adminList.statusCode).toBe(200);
    expect((adminList.json() as any[]).some((x) => x.id === annId)).toBe(false);

    const auditDelete = await app.inject({
      method: "GET",
      url: `/admin/audit-logs?action=ANNOUNCEMENT_DELETE&entityType=announcements&entityId=${annId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(auditDelete.statusCode).toBe(200);
    expect((auditDelete.json() as any[]).some((x) => x.action === "ANNOUNCEMENT_DELETE" && x.entityId === annId)).toBe(true);
  });
});
