import { randomUUID } from "node:crypto";

import type { Db } from "../db.js";

export type AuditActorRole = "ADMIN" | "AGENT" | "SYSTEM";

export async function writeAuditLog(
  db: Db,
  args: Readonly<{
    actorUserId: string | null;
    actorRole: AuditActorRole;
    action: string;
    entityType: string;
    entityId?: string | null;
    before?: any;
    after?: any;
    meta?: any;
  }>,
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `
      insert into audit_logs (
        id,
        actor_user_id,
        actor_role,
        action,
        entity_type,
        entity_id,
        before_json,
        after_json,
        meta,
        created_at
      ) values (
        $1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,now()
      )
    `,
    [
      id,
      args.actorUserId,
      args.actorRole,
      args.action,
      args.entityType,
      args.entityId ?? null,
      args.before === undefined ? null : JSON.stringify(args.before),
      args.after === undefined ? null : JSON.stringify(args.after),
      JSON.stringify(args.meta ?? {}),
    ],
  );
  return id;
}

