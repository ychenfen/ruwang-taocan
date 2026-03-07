import "dotenv/config";

import { buildApp } from "./app.js";
import { startJobs } from "./jobs/index.js";

async function main() {
  const app = await buildApp();
  // Keep Date-based scheduling and YYYY-MM calculations aligned with configured timezone.
  process.env.TZ = app.config.TZ;
  startJobs(app);
  await app.listen({ port: app.config.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
