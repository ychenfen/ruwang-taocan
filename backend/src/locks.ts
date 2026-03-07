import type { Db } from "./db.js";

export async function tryAcquireDbLock(args: Readonly<{
  db: Db;
  name: string;
  ttlMs: number;
  owner: string;
}>): Promise<boolean> {
  const { db, name, ttlMs, owner } = args;
  const lockedUntilIso = new Date(Date.now() + ttlMs).toISOString();

  // Fast-path: steal expired lock.
  const upd = await db.query(
    "update job_locks set locked_until = $2, locked_by = $3, updated_at = now() where name = $1 and locked_until < now()",
    [name, lockedUntilIso, owner],
  );
  if (upd.rowCount === 1) return true;

  // Attempt insert. If another worker inserted first, this will fail.
  try {
    await db.query(
      "insert into job_locks (name, locked_until, locked_by, updated_at) values ($1, $2, $3, now())",
      [name, lockedUntilIso, owner],
    );
    return true;
  } catch {
    return false;
  }
}

export async function releaseDbLock(args: Readonly<{ db: Db; name: string; owner: string }>): Promise<void> {
  const { db, name, owner } = args;
  await db.query("update job_locks set locked_until = now(), updated_at = now() where name = $1 and locked_by = $2", [
    name,
    owner,
  ]);
}

