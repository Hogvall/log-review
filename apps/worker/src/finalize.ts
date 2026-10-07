import {
  type CastMark,
  type CohortMember,
  type PhaseSpan,
  type PlayerMetrics,
  encounterAvoidability,
  isCombatPotion,
  roleOf,
  specBenchmark,
} from "@log-review/analysis";
import {
  type Db,
  abilities,
  aggregations,
  benchmarks,
  encounterAbilities,
  fights,
  jobs,
  playerMetrics,
  rankingEntries,
  snapshots,
} from "@log-review/db";
import { and, count, eq, inArray, sql } from "drizzle-orm";

/**
 * Aggregates each boss and difficulty of a running snapshot as soon as all of its jobs are finished,
 * so the site can use Mythic data on day one instead of waiting for the whole crawl. A group is
 * aggregated again when any of its jobs finished after its last aggregation (e.g. after a backfill).
 */
export async function aggregateReadyGroups(db: Db, difficulties: number[]) {
  const ready = await db.execute<{ snapshot_id: number; encounter_id: number; difficulty: number }>(sql`
    SELECT DISTINCT r.snapshot_id, r.encounter_id, r.difficulty
    FROM ranking_entries r
    JOIN snapshots s ON s.id = r.snapshot_id AND s.status = 'running'
    WHERE r.difficulty IN ${difficulties.length ? difficulties : [-1]}
    AND NOT EXISTS (
      SELECT 1 FROM aggregations a
      WHERE a.snapshot_id = r.snapshot_id AND a.encounter_id = r.encounter_id AND a.difficulty = r.difficulty
        AND a.aggregated_at >= (
          SELECT max(j.updated_at) FROM jobs j
          WHERE j.snapshot_id = r.snapshot_id
            AND (j.payload->>'encounterId')::int = r.encounter_id AND (j.payload->>'difficulty')::int = r.difficulty
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM jobs j
      WHERE j.snapshot_id = r.snapshot_id AND j.status IN ('pending', 'running')
        AND (j.payload->>'encounterId')::int = r.encounter_id AND (j.payload->>'difficulty')::int = r.difficulty
    )
  `);
  for (const g of ready) {
    await aggregateGroup(db, g.snapshot_id, g.encounter_id, g.difficulty);
  }
}

/** Completes every running snapshot whose jobs have all finished (done or permanently failed). */
export async function finalizeSnapshots(db: Db, difficulties: number[]) {
  const running = await db.select().from(snapshots).where(eq(snapshots.status, "running"));
  for (const snapshot of running) {
    const [open] = await db
      .select({ n: count() })
      .from(jobs)
      .where(and(eq(jobs.snapshotId, snapshot.id), inArray(jobs.status, ["pending", "running"])));
    if (open && open.n > 0) continue;

    console.log(`snapshot ${snapshot.week}: all jobs finished, aggregating`);
    await aggregateSnapshot(db, snapshot.id, difficulties);
    await db.update(snapshots).set({ status: "complete", completedAt: new Date() }).where(eq(snapshots.id, snapshot.id));
    console.log(`snapshot ${snapshot.week}: complete`);
  }
}

/** Computes spec benchmarks and ability avoidability, one boss and difficulty at a time to bound memory. */
export async function aggregateSnapshot(db: Db, snapshotId: number, difficulties: number[]) {
  const groups = await db
    .selectDistinct({ encounterId: rankingEntries.encounterId, difficulty: rankingEntries.difficulty })
    .from(rankingEntries)
    .where(and(eq(rankingEntries.snapshotId, snapshotId), inArray(rankingEntries.difficulty, difficulties)));

  for (const { encounterId, difficulty } of groups) await aggregateGroup(db, snapshotId, encounterId, difficulty);
}

async function aggregateGroup(db: Db, snapshotId: number, encounterId: number, difficulty: number) {
  const rows = await db
    .select({
      specKey: rankingEntries.specKey,
      amount: rankingEntries.amount,
      itemLevel: rankingEntries.itemLevel,
      metrics: playerMetrics.metrics,
      buffUptime: playerMetrics.buffUptime,
      timeline: playerMetrics.timeline,
      precasts: playerMetrics.precasts,
      phases: fights.phases,
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
    .leftJoin(fights, and(eq(fights.reportCode, rankingEntries.reportCode), eq(fights.fightId, rankingEntries.fightId)))
    .where(
      and(
        eq(rankingEntries.snapshotId, snapshotId),
        eq(rankingEntries.encounterId, encounterId),
        eq(rankingEntries.difficulty, difficulty),
      ),
    );

  // Combat potions differ between players; find them by name so their first use is benchmarked as one.
  const castIds = [...new Set(rows.flatMap((r) => ((r.timeline as CastMark[] | null) ?? []).map(([, id]) => id)))];
  const potionIds = new Set<number>();
  for (let i = 0; i < castIds.length; i += 1000) {
    const named = await db.select().from(abilities).where(inArray(abilities.id, castIds.slice(i, i + 1000)));
    for (const a of named) if (isCombatPotion(a.name, a.icon ?? "")) potionIds.add(a.id);
  }

  const cohorts = new Map<string, CohortMember[]>();
  for (const row of rows) {
    const cohort = cohorts.get(row.specKey) ?? [];
    const metrics = row.metrics as PlayerMetrics;
    cohort.push({
      amount: row.amount,
      itemLevel: row.itemLevel,
      metrics,
      buffUptime: row.buffUptime as Record<string, number> | null,
      // Timelines are only comparable with phases known (they're [] for bosses without phases).
      timeline:
        row.timeline && row.precasts && row.phases
          ? {
              casts: row.timeline as CastMark[],
              precasts: row.precasts as number[],
              durationMs: metrics.durationMs,
              phases: row.phases as PhaseSpan[],
            }
          : null,
    });
    cohorts.set(row.specKey, cohort);
  }

  // Every non-tank player in the snapshot's fights for this boss, not just the ranked ones.
  const fightPlayers = await db
    .select({ specKey: playerMetrics.specKey, metrics: playerMetrics.metrics })
    .from(playerMetrics)
    .where(
      // Only fights where damage taken was downloaded (a sample per boss) can say what's avoidable.
      sql`(${playerMetrics.reportCode}, ${playerMetrics.fightId}) IN (
        SELECT DISTINCT r.report_code, r.fight_id FROM ranking_entries r
        JOIN fights f ON f.report_code = r.report_code AND f.fight_id = r.fight_id AND f.has_damage_taken
        WHERE r.snapshot_id = ${snapshotId} AND r.encounter_id = ${encounterId} AND r.difficulty = ${difficulty}
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
          const data = specBenchmark(cohort, undefined, potionIds);
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
    await tx
      .insert(aggregations)
      .values({ snapshotId, encounterId, difficulty })
      .onConflictDoUpdate({ target: [aggregations.snapshotId, aggregations.encounterId, aggregations.difficulty], set: { aggregatedAt: sql`now()` } });
  });
  console.log(`  encounter ${encounterId} difficulty ${difficulty}: ${cohorts.size} specs, ${fightPlayers.length} players`);
}
