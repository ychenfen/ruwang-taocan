import type { FastifyInstance } from "fastify";

import { startMonthlySettlementJob } from "./monthlySettlement.js";

export function startJobs(app: FastifyInstance): void {
  startMonthlySettlementJob(app);
}

