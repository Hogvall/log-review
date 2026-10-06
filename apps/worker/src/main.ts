import { createDb } from "@log-review/db";
import { WclClient, credentialsFromEnv } from "@log-review/wcl";
import { BudgetedClient } from "./budget";
import { config } from "./config";
import { aggregateReadyGroups, finalizeSnapshots } from "./finalize";
import { type FightJobPayload, runFightJob } from "./jobs/fight";
import { type RankingsJobPayload, runRankingsJob } from "./jobs/rankings";
import { claimJob, completeJob, failJob, resetStaleJobs } from "./queue";

const IDLE_MS = 30_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const db = createDb();
const wcl = new BudgetedClient(new WclClient(credentialsFromEnv()), config.crawlPointLimit);

let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`${signal} received, finishing the current job`);
    stopping = true;
  });
}

await resetStaleJobs(db);
console.log(`worker started (zone ${config.zoneId}, top ${config.topN}, crawl limit ${config.crawlPointLimit} points/hour)`);

let processed = 0;
while (!stopping) {
  let job: Awaited<ReturnType<typeof claimJob>>;
  try {
    job = await claimJob(db);
    if (!job) await finalizeSnapshots(db);
  } catch (err) {
    // e.g. the database is restarting; keep the worker alive and try again.
    console.error("queue error:", err instanceof Error ? err.message : err);
    job = null;
  }
  if (!job) {
    await sleep(IDLE_MS);
    continue;
  }

  try {
    if (job.kind === "rankings") {
      await runRankingsJob(db, wcl, job.snapshotId, job.payload as RankingsJobPayload, config.topN);
    } else {
      await runFightJob(db, wcl, job.snapshotId, job.payload as FightJobPayload);
    }
    await completeJob(db, job);
  } catch (err) {
    console.error(`job ${job.key} failed (attempt ${job.attempts}):`, err instanceof Error ? err.message : err);
    await failJob(db, job, err);
  }

  if (++processed % 25 === 0) {
    console.log(`processed ${processed} jobs`);
    await aggregateReadyGroups(db).catch((err) => console.error("aggregation error:", err instanceof Error ? err.message : err));
  }
}

await db.close();
