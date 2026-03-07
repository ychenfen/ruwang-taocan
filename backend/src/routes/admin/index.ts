import type { FastifyPluginAsync } from "fastify";

import { adminAccountRoutes } from "./account.js";
import { adminAgentRoutes } from "./agents.js";
import { adminAgentLevelRoutes } from "./agent-levels.js";
import { adminAnnouncementRoutes } from "./announcements.js";
import { adminAuditLogRoutes } from "./audit-logs.js";
import { adminCardRoutes } from "./cards.js";
import { adminLedgerRoutes } from "./ledger.js";
import { adminPlanRoutes } from "./plans.js";
import { adminPolicyRoutes } from "./policies.js";
import { adminReportRoutes } from "./reports.js";
import { adminSettlementRoutes } from "./settlements.js";
import { adminSettlementDeleteRoutes } from "./settlement-delete.js";
import { adminTeamRoutes } from "./teams.js";
import { adminStatsRoutes } from "./stats.js";

export const adminRoutes: FastifyPluginAsync = async (app) => {
  await app.register(adminAccountRoutes);
  await app.register(adminStatsRoutes);
  await app.register(adminAuditLogRoutes);
  await app.register(adminLedgerRoutes);
  await app.register(adminAgentLevelRoutes);
  await app.register(adminPlanRoutes);
  await app.register(adminPolicyRoutes);
  await app.register(adminCardRoutes);
  await app.register(adminTeamRoutes);
  await app.register(adminAgentRoutes);
  await app.register(adminSettlementRoutes);
  await app.register(adminSettlementDeleteRoutes);
  await app.register(adminReportRoutes);
  await app.register(adminAnnouncementRoutes);
};
