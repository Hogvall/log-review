import { createDb } from "@log-review/db";
import { WclClient, credentialsFromEnv } from "@log-review/wcl";
import { BudgetedClient } from "./budget";
import { config } from "./config";
import { aggregateReadyGroups, finalizeSnapshots } from "./finalize";
import { type FightJobPayload, runFightJob } from "./jobs/fight";
import { type RankingsJobPayload, runRankingsJob } from "./jobs/rankings";
import { claimJob, completeJob, failJob, requeueMissingTimelines, resetStaleJobs } from "./queue";

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
const requeued = await requeueMissingTimelines(db, config.difficulties);
if (requeued) console.log(`re-queued ${requeued} fights crawled before cast timelines were stored for every top player`);
console.log(
  `worker started (zone ${config.zoneId}, top ${config.topN}, difficulties ${config.difficulties.join(",")}, crawl limit ${config.crawlPointLimit} points/hour)`,
);

let processed = 0;
let skipped = 0;
while (!stopping) {
  let job: Awaited<ReturnType<typeof claimJob>>;
  try {
    job = await claimJob(db);
    if (!job) await finalizeSnapshots(db, config.difficulties);
  } catch (err) {
    // e.g. the database is restarting; keep the worker alive and try again.
    console.error("queue error:", err instanceof Error ? err.message : err);
    job = null;
  }
  if (!job) {
    await sleep(IDLE_MS);
    continue;
  }

  // Difficulties we no longer crawl (e.g. Heroic after switching to Mythic-only) are skipped without API calls.
  const difficulty = (job.payload as { difficulty?: number }).difficulty;
  if (difficulty != null && !config.difficulties.includes(difficulty)) {
    await completeJob(db, job);
    if (++skipped % 500 === 0) console.log(`skipped ${skipped} jobs for difficulties not in ${config.difficulties.join(",")}`);
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
    await aggregateReadyGroups(db, config.difficulties).catch((err) => console.error("aggregation error:", err instanceof Error ? err.message : err));
  }
}

await db.close();
