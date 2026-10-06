import {
  type CohortMember,
  type PlayerMetrics,
  encounterAvoidability,
  roleOf,
  specBenchmark,
} from "@log-review/analysis";
import { type Db, benchmarks, encounterAbilities, jobs, playerMetrics, rankingEntries, snapshots } from "@log-review/db";
import { and, count, eq, inArray, sql } from "drizzle-orm";

/** Completes every running snapshot whose jobs have all finished (done or permanently failed). */
export async function finalizeSnapshots(db: Db) {
  const running = await db.select().from(snapshots).where(eq(snapshots.status, "running"));
  for (const snapshot of running) {
    const [open] = await db
      .select({ n: count() })
      .from(jobs)
      .where(and(eq(jobs.snapshotId, snapshot.id), inArray(jobs.status, ["pending", "running"])));
    if (open && open.n > 0) continue;

    console.log(`snapshot ${snapshot.week}: all jobs finished, aggregating`);
    await aggregateSnapshot(db, snapshot.id);
    await db.update(snapshots).set({ status: "complete", completedAt: new Date() }).where(eq(snapshots.id, snapshot.id));
    console.log(`snapshot ${snapshot.week}: complete`);
  }
}

/** Computes spec benchmarks and ability avoidability, one boss and difficulty at a time to bound memory. */
export async function aggregateSnapshot(db: Db, snapshotId: number) {
  const groups = await db
    .selectDistinct({ encounterId: rankingEntries.encounterId, difficulty: rankingEntries.difficulty })
    .from(rankingEntries)
    .where(eq(rankingEntries.snapshotId, snapshotId));

  for (const { encounterId, difficulty } of groups) {
    const rows = await db
      .select({
        specKey: rankingEntries.specKey,
        amount: rankingEntries.amount,
        itemLevel: rankingEntries.itemLevel,
        metrics: playerMetrics.metrics,
        buffUptime: playerMetrics.buffUptime,
      })
      .from(rankingEntries)
      .innerJoin(
        playerMetrics,
        and(
          eq(playerMetrics.reportCode, rankingEntries.reportCode),
          eq(playerMetrics.fightId, rankingEntries.fightId),
          eq(playerMetrics.name, rankingEntries.name),
          eq(playerMetrics.specKey, rankingEntries.specKey),
        ),
      )
      .where(
        and(
          eq(rankingEntries.snapshotId, snapshotId),
          eq(rankingEntries.encounterId, encounterId),
          eq(rankingEntries.difficulty, difficulty),
        ),
      );

    const cohorts = new Map<string, CohortMember[]>();
    for (const row of rows) {
      const cohort = cohorts.get(row.specKey) ?? [];
      cohort.push({
        amount: row.amount,
        itemLevel: row.itemLevel,
        metrics: row.metrics as PlayerMetrics,
        buffUptime: row.buffUptime as Record<string, number> | null,
      });
      cohorts.set(row.specKey, cohort);
    }

    // Every non-tank player in the snapshot's fights for this boss, not just the ranked ones.
    const fightPlayers = await db
      .select({ specKey: playerMetrics.specKey, metrics: playerMetrics.metrics })
      .from(playerMetrics)
      .where(
        sql`(${playerMetrics.reportCode}, ${playerMetrics.fightId}) IN (
          SELECT DISTINCT report_code, fight_id FROM ranking_entries
          WHERE snapshot_id = ${snapshotId} AND encounter_id = ${encounterId} AND difficulty = ${difficulty}
        )`,
      );
    const avoidability = encounterAvoidability(
      fightPlayers.filter((p) => roleOf(p.specKey) !== "tank").map((p) => p.metrics as PlayerMetrics),
    );

    const scope = (table: typeof benchmarks | typeof encounterAbilities) =>
      and(eq(table.snapshotId, snapshotId), eq(table.encounterId, encounterId), eq(table.difficulty, difficulty));

    // Delete-then-insert so re-running aggregation is safe.
    await db.transaction(async (tx) => {
      await tx.delete(benchmarks).where(scope(benchmarks));
      await tx.delete(encounterAbilities).where(scope(encounterAbilities));
      if (cohorts.size) {
        await tx.insert(benchmarks).values(
          [...cohorts].map(([specKey, cohort]) => {
            const data = specBenchmark(cohort);
            return { snapshotId, encounterId, difficulty, specKey, sampleSize: data.sampleSize, insufficient: data.insufficient, data };
          }),
        );
      }
      const abilityRows = Object.entries(avoidability).map(([abilityId, a]) => ({
        snapshotId,
        encounterId,
        difficulty,
        abilityId: Number(abilityId),
        zeroShare: a.zeroShare,
        medianDtpsWhenHit: a.medianDtpsWhenHit,
        sampleSize: a.sampleSize,
        classification: a.classification,
      }));
      for (let i = 0; i < abilityRows.length; i += 500) {
        await tx.insert(encounterAbilities).values(abilityRows.slice(i, i + 500));
      }
    });
    console.log(`  encounter ${encounterId} difficulty ${difficulty}: ${cohorts.size} specs, ${fightPlayers.length} players`);
  }
}
