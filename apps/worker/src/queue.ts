import { type Db, jobs } from "@log-review/db";
import { WclError } from "@log-review/wcl";
import { sql } from "drizzle-orm";

export type JobKind = (typeof jobs.$inferInsert)["kind"];
export type NewJob = typeof jobs.$inferInsert;

export interface ClaimedJob {
  id: number;
  snapshotId: number;
  kind: JobKind;
  key: string;
  payload: unknown;
  attempts: number;
}

const MAX_ATTEMPTS = 5;

export async function enqueue(db: Db, newJobs: NewJob[]) {
  for (let i = 0; i < newJobs.length; i += 500) {
    await db.insert(jobs).values(newJobs.slice(i, i + 500)).onConflictDoNothing({ target: jobs.key });
  }
}

/** Atomically takes the highest-priority runnable job, or returns null if there is none. */
export async function claimJob(db: Db): Promise<ClaimedJob | null> {
  const rows = await db.execute<{
    id: string;
    snapshot_id: number;
    kind: JobKind;
    key: string;
    payload: unknown;
    attempts: number;
  }>(sql`
    UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = now()
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'pending' AND run_after <= now()
      ORDER BY priority, id
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, snapshot_id, kind, key, payload, attempts
  `);
  const row = rows[0];
  if (!row) return null;
  return { id: Number(row.id), snapshotId: row.snapshot_id, kind: row.kind, key: row.key, payload: row.payload, attempts: row.attempts };
}

export async function completeJob(db: Db, job: ClaimedJob) {
  await db.execute(sql`UPDATE jobs SET status = 'done', last_error = NULL, updated_at = now() WHERE id = ${job.id}`);
}

/** Retries with exponential backoff; gives up on permanent errors (private or deleted logs). */
export async function failJob(db: Db, job: ClaimedJob, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const permanent = err instanceof WclError && (err.kind === "private" || err.kind === "not_found");
  if (permanent || job.attempts >= MAX_ATTEMPTS) {
    await db.execute(sql`UPDATE jobs SET status = 'failed', last_error = ${message}, updated_at = now() WHERE id = ${job.id}`);
    return;
  }
  const delayMinutes = err instanceof WclError && err.kind === "rate_limited" ? 15 : 2 ** job.attempts;
  await db.execute(sql`
    UPDATE jobs SET status = 'pending', last_error = ${message}, updated_at = now(),
      run_after = now() + make_interval(mins => ${delayMinutes})
    WHERE id = ${job.id}
  `);
}

/** Jobs left 'running' by a crashed or redeployed worker go back in the queue. Assumes a single worker. */
export async function resetStaleJobs(db: Db) {
  await db.execute(sql`UPDATE jobs SET status = 'pending', updated_at = now() WHERE status = 'running'`);
}
