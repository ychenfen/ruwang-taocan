import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  JWT_SECRET: z.string().min(16),
  DATABASE_URL: z.string().min(1).optional(),
  PGLITE_PATH: z.string().min(1).default("./.data/pglite"),
  TZ: z.string().default("Asia/Shanghai"),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid env:\n${msg}`);
  }
  return parsed.data;
}
