import {
  type CastEvent,
  type CastsTableEntry,
  type DamageDoneTableEntry,
  buffUptimes,
  extractFightMetrics,
} from "@log-review/analysis";
import { type Db, abilities, fights, playerMetrics, rankingEntries } from "@log-review/db";
import { ENEMY_SOURCES, type WclQuerier, getFightEvents, getFightTable, getReportAbilities } from "@log-review/wcl";
import { and, eq } from "drizzle-orm";

export interface FightJobPayload {
  reportCode: string;
  fightId: number;
  encounterId: number;
  difficulty: number;
  /** Report-relative milliseconds. */
  fightStartTime: number;
  fightEndTime: number;
}

/**
 * Downloads one fight (once ever: logs don't change), stores metrics for every player in it,
 * then fills in per-player buff uptimes for this snapshot's ranked players and a cast
 * timeline for any #1-ranked player.
 */
export async function runFightJob(db: Db, wcl: WclQuerier, snapshotId: number, p: FightJobPayload) {
  const where = and(eq(fights.reportCode, p.reportCode), eq(fights.fightId, p.fightId));
  const [existing] = await db.select({ durationMs: fights.durationMs }).from(fights).where(where).limit(1);
  // Cast events are only in memory when we just downloaded the fight; otherwise timelines cost a query.
  let castEvents: CastEvent[] | null = null;
  let durationMs: number;
  if (existing) durationMs = existing.durationMs;
  else ({ durationMs, castEvents } = await downloadFight(db, wcl, p));

  const ranked = await db
    .select({ name: rankingEntries.name, specKey: rankingEntries.specKey, rank: rankingEntries.rank })
    .from(rankingEntries)
    .where(
      and(
        eq(rankingEntries.snapshotId, snapshotId),
        eq(rankingEntries.reportCode, p.reportCode),
        eq(rankingEntries.fightId, p.fightId),
      ),
    );

  for (const r of ranked) {
    const pmWhere = and(
      eq(playerMetrics.reportCode, p.reportCode),
      eq(playerMetrics.fightId, p.fightId),
      eq(playerMetrics.name, r.name),
      eq(playerMetrics.specKey, r.specKey),
    );
    const [pm] = await db
      .select({ actorId: playerMetrics.actorId, buffUptime: playerMetrics.buffUptime, timeline: playerMetrics.timeline })
      .from(playerMetrics)
      .where(pmWhere)
      .limit(1);
    if (!pm) {
      console.warn(`fight ${p.reportCode}#${p.fightId}: ranked player ${r.name} (${r.specKey}) not found in the log`);
      continue;
    }

    if (!pm.buffUptime) {
      const table = await getFightTable<{ auras: { guid: number; totalUptime: number }[] }>(
        wcl,
        p.reportCode,
        p.fightId,
        "Buffs",
        { sourceID: pm.actorId },
      );
      await db.update(playerMetrics).set({ buffUptime: buffUptimes(table.auras, durationMs) }).where(pmWhere);
    }

    if (r.rank === 1 && !pm.timeline) {
      const events =
        castEvents?.filter((e) => e.sourceID === pm.actorId) ??
        (await getFightEvents(
          wcl,
          p.reportCode,
          { id: p.fightId, startTime: p.fightStartTime, endTime: p.fightEndTime },
          "Casts",
          { sourceID: pm.actorId },
        ));
      const timeline = events
        .filter((e) => e.type === "cast" && e.abilityGameID)
        .map((e) => [e.timestamp - p.fightStartTime, e.abilityGameID!]);
      await db.update(playerMetrics).set({ timeline }).where(pmWhere);
    }
  }
}

/**
 * Fetches everything for all ~20 players in a fight (about 8 queries, most of them one page)
 * and stores their metrics. The all-players tables cut ability lists to the top 5, so casts
 * and damage taken come from raw events instead.
 */
async function downloadFight(
  db: Db,
  wcl: WclQuerier,
  p: FightJobPayload,
): Promise<{ durationMs: number; castEvents: CastEvent[] }> {
  const range = { id: p.fightId, startTime: p.fightStartTime, endTime: p.fightEndTime };
  const players = await getFightTable<{ entries: CastsTableEntry[]; totalTime: number }>(wcl, p.reportCode, p.fightId, "Casts");
  const castEvents = await getFightEvents(wcl, p.reportCode, range, "Casts");
  // Enemy damage only: self-damage like Burning Rush would otherwise look like an avoidable boss ability.
  const damageTakenEvents = await getFightEvents(wcl, p.reportCode, range, "DamageTaken", { filterExpression: ENEMY_SOURCES });
  const done = await getFightTable<{ entries: DamageDoneTableEntry[] }>(wcl, p.reportCode, p.fightId, "DamageDone");
  const deaths = await getFightEvents(wcl, p.reportCode, range, "Deaths");
  const reportAbilities = await getReportAbilities(wcl, p.reportCode);

  const durationMs = players.totalTime || p.fightEndTime - p.fightStartTime;
  const metrics = extractFightMetrics({
    durationMs,
    fightStartTime: p.fightStartTime,
    players: players.entries,
    castEvents,
    damageTakenEvents,
    damageDone: done.entries,
    deaths,
  });

  await db.transaction(async (tx) => {
    if (metrics.length) {
      await tx
        .insert(playerMetrics)
        .values(
          metrics.map((m) => ({
            reportCode: p.reportCode,
            fightId: p.fightId,
            actorId: m.actorId,
            name: m.name,
            specKey: m.specKey,
            metrics: m,
          })),
        )
        .onConflictDoNothing();
    }
    // Names for casts, damage and buffs alike; WCL uses the same IDs for all three.
    const named = reportAbilities.filter((a) => a.gameID > 0 && a.name);
    for (let i = 0; i < named.length; i += 500) {
      await tx
        .insert(abilities)
        .values(named.slice(i, i + 500).map((a) => ({ id: a.gameID, name: a.name, icon: a.icon || null })))
        .onConflictDoNothing();
    }
    await tx
      .insert(fights)
      .values({ reportCode: p.reportCode, fightId: p.fightId, encounterId: p.encounterId, difficulty: p.difficulty, durationMs })
      .onConflictDoNothing();
  });
  return { durationMs, castEvents };
}
