import {
  type CastsTableEntry,
  type DamageDoneTableEntry,
  type PlayerMetrics,
  buffUptimes,
  extractFightMetrics,
} from "@log-review/analysis";
import { type Db, abilities, fights, playerMetrics, rankingEntries } from "@log-review/db";
import { ENEMY_SOURCES, type WclQuerier, getFightEvents, getFightTable } from "@log-review/wcl";
import { and, count, eq } from "drizzle-orm";

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
 * Avoidability needs damage taken from many players, but not from every top fight: this many fights per
 * boss and difficulty (×20 players each) is plenty, and skipping the rest roughly halves the crawl.
 */
export const AVOIDABILITY_SAMPLE_FIGHTS = 60;

type Named = { guid: number; name: string; abilityIcon?: string };

/**
 * Downloads one fight (once ever: logs don't change) and fills in what this snapshot's ranked players
 * in it need. Per fight: 2 queries for everyone (active time, target split), plus damage taken for the
 * first fights of each boss (avoidability). Per ranked player: their casts and buffs (1 query each),
 * and a cast timeline for #1 players.
 */
export async function runFightJob(db: Db, wcl: WclQuerier, snapshotId: number, p: FightJobPayload) {
  const where = and(eq(fights.reportCode, p.reportCode), eq(fights.fightId, p.fightId));
  const [existing] = await db.select({ durationMs: fights.durationMs }).from(fights).where(where).limit(1);
  const durationMs = existing?.durationMs ?? (await downloadFight(db, wcl, p));

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

  const names: Named[] = [];
  for (const r of ranked) {
    const pmWhere = and(
      eq(playerMetrics.reportCode, p.reportCode),
      eq(playerMetrics.fightId, p.fightId),
      eq(playerMetrics.name, r.name),
      eq(playerMetrics.specKey, r.specKey),
    );
    const [pm] = await db
      .select({
        actorId: playerMetrics.actorId,
        metrics: playerMetrics.metrics,
        buffUptime: playerMetrics.buffUptime,
        timeline: playerMetrics.timeline,
      })
      .from(playerMetrics)
      .where(pmWhere)
      .limit(1);
    if (!pm) {
      console.warn(`fight ${p.reportCode}#${p.fightId}: ranked player ${r.name} (${r.specKey}) not found in the log`);
      continue;
    }

    // Casts per minute from the player's own Casts table: complete (unlike the all-players table) and named.
    const metrics = pm.metrics as PlayerMetrics;
    if (!Object.keys(metrics.cpm).length) {
      const table = await getFightTable<{ entries: (Named & { total: number })[] }>(wcl, p.reportCode, p.fightId, "Casts", {
        sourceID: pm.actorId,
      });
      const cpm: Record<string, number> = {};
      for (const e of table.entries ?? []) cpm[e.guid] = (e.total * 60_000) / durationMs;
      names.push(...(table.entries ?? []));
      await db.update(playerMetrics).set({ metrics: { ...metrics, cpm } }).where(pmWhere);
    }

    if (!pm.buffUptime) {
      const table = await getFightTable<{ auras: (Named & { totalUptime: number })[] }>(wcl, p.reportCode, p.fightId, "Buffs", {
        sourceID: pm.actorId,
      });
      names.push(...(table.auras ?? []));
      await db.update(playerMetrics).set({ buffUptime: buffUptimes(table.auras ?? [], durationMs) }).where(pmWhere);
    }

    if (r.rank === 1 && !pm.timeline) {
      const events = await getFightEvents(
        wcl,
        p.reportCode,
        { id: p.fightId, startTime: p.fightStartTime, endTime: p.fightEndTime },
        "Casts",
        { sourceID: pm.actorId },
      );
      const timeline = events
        .filter((e) => e.type === "cast" && e.abilityGameID)
        .map((e) => [e.timestamp - p.fightStartTime, e.abilityGameID!]);
      await db.update(playerMetrics).set({ timeline }).where(pmWhere);
    }
  }

  // Ability and buff names come free with the per-player tables; the site uses them for benchmark rows.
  const unique = new Map(names.filter((n) => n.guid > 0 && n.name).map((n) => [n.guid, n]));
  if (unique.size) {
    await db
      .insert(abilities)
      .values([...unique.values()].map((a) => ({ id: a.guid, name: a.name, icon: a.abilityIcon || null })))
      .onConflictDoNothing();
  }
}

/** Stores what we know about every player in the fight and returns its duration. */
async function downloadFight(db: Db, wcl: WclQuerier, p: FightJobPayload): Promise<number> {
  const players = await getFightTable<{ entries: CastsTableEntry[]; totalTime: number }>(wcl, p.reportCode, p.fightId, "Casts");
  const done = await getFightTable<{ entries: DamageDoneTableEntry[] }>(wcl, p.reportCode, p.fightId, "DamageDone");

  const [sampled] = await db
    .select({ n: count() })
    .from(fights)
    .where(and(eq(fights.encounterId, p.encounterId), eq(fights.difficulty, p.difficulty), eq(fights.hasDamageTaken, true)));
  const wantDamageTaken = (sampled?.n ?? 0) < AVOIDABILITY_SAMPLE_FIGHTS;
  // Enemy damage only: self-damage like Burning Rush would otherwise look like an avoidable boss ability.
  const damageTakenEvents = wantDamageTaken
    ? await getFightEvents(wcl, p.reportCode, { id: p.fightId, startTime: p.fightStartTime, endTime: p.fightEndTime }, "DamageTaken", {
        filterExpression: ENEMY_SOURCES,
      })
    : [];

  const durationMs = players.totalTime || p.fightEndTime - p.fightStartTime;
  // Casts are filled in per ranked player afterwards; deaths aren't needed for benchmarks.
  const metrics = extractFightMetrics({
    durationMs,
    fightStartTime: p.fightStartTime,
    players: players.entries,
    castEvents: [],
    damageTakenEvents,
    damageDone: done.entries,
    deaths: [],
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
    await tx
      .insert(fights)
      .values({
        reportCode: p.reportCode,
        fightId: p.fightId,
        encounterId: p.encounterId,
        difficulty: p.difficulty,
        durationMs,
        hasDamageTaken: wantDamageTaken,
      })
      .onConflictDoNothing();
  });
  return durationMs;
}
