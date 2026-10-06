/**
 * Recomputes benchmarks for a snapshot from stored metrics, without calling the WCL API.
 * Use after fixing analysis code.
 *   npm run snapshot:reaggregate -w apps/worker -- [week]   (defaults to the newest snapshot)
 */
import { createDb, snapshots } from "@log-review/db";
import { desc, eq } from "drizzle-orm";
import { config } from "./config";
import { aggregateSnapshot } from "./finalize";

const week = process.argv[2];
const db = createDb();
const [snapshot] = await db
  .select()
  .from(snapshots)
  .where(week ? eq(snapshots.week, week) : undefined)
  .orderBy(desc(snapshots.id))
  .limit(1);
if (!snapshot) throw new Error(week ? `No snapshot ${week}` : "No snapshots yet");

console.log(`re-aggregating snapshot ${snapshot.week}`);
await aggregateSnapshot(db, snapshot.id, config.difficulties);
await db.close();
