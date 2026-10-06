/**
 * Starts this week's benchmark snapshot: discovers bosses and specs, then queues one rankings
 * job per boss × difficulty × spec. The worker does the rest. Run weekly by cron; safe to re-run.
 *
 * For a small, cheap test run:
 *   npm run snapshot:start -- --test --encounters 3470 --specs Mage-Fire,Priest-Discipline --difficulties 5
 */
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { specKey } from "@log-review/analysis";
import { createDb, snapshots } from "@log-review/db";
import { Difficulty, WclClient, credentialsFromEnv, currentPartition, getClasses, getZone } from "@log-review/wcl";
import { config } from "./config";
import type { RankingsJobPayload } from "./jobs/rankings";
import { type NewJob, enqueue } from "./queue";
import { isoWeek } from "./week";

const { values: args } = parseArgs({
  options: {
    test: { type: "boolean", default: false },
    encounters: { type: "string" },
    specs: { type: "string" },
    difficulties: { type: "string" },
  },
});
const list = (value: string | undefined) => value?.split(",").map((s) => s.trim()).filter(Boolean);

const db = createDb();
const wcl = new WclClient(credentialsFromEnv());

const week = isoWeek(new Date()) + (args.test ? `-test-${Date.now()}` : "");
const [existing] = await db.select().from(snapshots).where(eq(snapshots.week, week));
if (existing) {
  console.log(`snapshot ${week} already exists (${existing.status}), nothing to do`);
  await db.close();
  process.exit(0);
}

const zone = await getZone(wcl, config.zoneId);
const partition = currentPartition(zone);
const classes = await getClasses(wcl);

const encounterFilter = list(args.encounters)?.map(Number);
const specFilter = list(args.specs);
const difficulties = list(args.difficulties)?.map(Number) ?? [Difficulty.Mythic, Difficulty.Heroic];

const encounters = zone.encounters.filter((e) => !encounterFilter || encounterFilter.includes(e.id));
const specs = classes.flatMap((c) => c.specs.map((s) => ({ classSlug: c.slug, specSlug: s.slug })))
  .filter((s) => !specFilter || specFilter.includes(specKey(s.classSlug, s.specSlug)));

const [snapshot] = await db.insert(snapshots).values({ week, zoneId: zone.id, partition }).returning();
if (!snapshot) throw new Error("Failed to create snapshot");

const newJobs: NewJob[] = [];
for (const encounter of encounters) {
  for (const difficulty of difficulties) {
    for (const s of specs) {
      const payload: RankingsJobPayload = { encounterId: encounter.id, difficulty, ...s, partition };
      newJobs.push({
        snapshotId: snapshot.id,
        kind: "rankings",
        key: `rankings:${snapshot.id}:${encounter.id}:${difficulty}:${specKey(s.classSlug, s.specSlug)}`,
        priority: difficulty === Difficulty.Mythic ? 0 : 1,
        payload,
      });
    }
  }
}
await enqueue(db, newJobs);

console.log(
  `snapshot ${week}: ${zone.name}, partition ${partition}, ${encounters.length} bosses × ${difficulties.length} difficulties × ${specs.length} specs = ${newJobs.length} rankings jobs queued`,
);
await db.close();
