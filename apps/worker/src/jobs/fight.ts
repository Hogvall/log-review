import {
  type CastMark,
  type CastsTableEntry,
  type DamageDoneTableEntry,
  type PlayerMetrics,
  buffUptimes,
  executeStarts,
  extractFightMetrics,
  findPrecasts,
  isExecuteSpell,
  phaseSpans,
} from "@log-review/analysis";
import { type Db, abilities, fights, playerMetrics, rankingEntries } from "@log-review/db";
import { ENEMY_SOURCES, type WclQuerier, getFightEvents, getFightMeta, getFightTable, getHealthGraph } from "@log-review/wcl";
import { and, count, eq, inArray } from "drizzle-orm";

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
 * in it need. Per fight: 2 queries for everyone (active time, target split), 1 for boss phases and
 * ability names, plus damage taken for the first fights of each boss (avoidability). Per ranked player:
 * their cast events (counts, timeline and precasts) and buffs, 1 query each.
 *
 * Every step is skipped when its data is already stored, so re-running a done job (a backfill) only
 * fetches what's missing.
 */
export async function runFightJob(db: Db, wcl: WclQuerier, snapshotId: number, p: FightJobPayload) {
  const where = and(eq(fights.reportCode, p.reportCode), eq(fights.fightId, p.fightId));
  const [existing] = await db.select({ durationMs: fights.durationMs }).from(fights).where(where).limit(1);
  const durationMs = existing?.durationMs ?? (await downloadFight(db, wcl, p));
  await ensurePhases(db, wcl, p, durationMs);

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
        precasts: playerMetrics.precasts,
      })
      .from(playerMetrics)
      .where(pmWhere)
      .limit(1);
    if (!pm) {
      console.warn(`fight ${p.reportCode}#${p.fightId}: ranked player ${r.name} (${r.specKey}) not found in the log`);
      continue;
    }

    // The player's own cast events: complete (unlike the all-players Casts table, which cuts abilities at 5)
    // and timed, so one query gives casts per minute, the timeline and precasts.
    const metrics = pm.metrics as PlayerMetrics;
    if (!Object.keys(metrics.cpm).length || !pm.timeline || !pm.precasts) {
      const events = await getFightEvents(
        wcl,
        p.reportCode,
        { id: p.fightId, startTime: p.fightStartTime, endTime: p.fightEndTime },
        "Casts",
        { sourceID: pm.actorId },
      );
      const own = events.filter((e) => e.abilityGameID && e.sourceID === pm.actorId);
      const timeline: CastMark[] = own.filter((e) => e.type === "cast").map((e) => [e.timestamp - p.fightStartTime, e.abilityGameID!]);
      const precasts = findPrecasts(own.map((e) => ({ fightTimeMs: e.timestamp - p.fightStartTime, type: e.type, abilityId: e.abilityGameID! })));
      const update: Partial<typeof playerMetrics.$inferInsert> = { timeline, precasts };
      if (!Object.keys(metrics.cpm).length) {
        const cpm: Record<string, number> = {};
        for (const [, id] of timeline) cpm[id] = (cpm[id] ?? 0) + 60_000 / durationMs;
        update.metrics = { ...metrics, cpm };
      }
      await db.update(playerMetrics).set(update).where(pmWhere);
    }

    if (!pm.buffUptime) {
      const table = await getFightTable<{ auras: (Named & { totalUptime: number })[] }>(wcl, p.reportCode, p.fightId, "Buffs", {
        sourceID: pm.actorId,
      });
      names.push(...(table.auras ?? []));
      await db.update(playerMetrics).set({ buffUptime: buffUptimes(table.auras ?? [], durationMs) }).where(pmWhere);
    }
  }

  await ensureExecuteStarts(db, wcl, p, durationMs, snapshotId);

  // Ability and buff names come free with the per-player tables; the site uses them for benchmark rows.
  const unique = new Map(names.filter((n) => n.guid > 0 && n.name).map((n) => [n.guid, n]));
  if (unique.size) {
    await db
      .insert(abilities)
      .values([...unique.values()].map((a) => ({ id: a.guid, name: a.name, icon: a.abilityIcon || null })))
      .onConflictDoNothing();
  }
}

/**
 * Stores the fight's boss phases, when bosses reached execute range, and the report's ability names (cast
 * events only carry IDs): 1 query, once.
 */
async function ensurePhases(db: Db, wcl: WclQuerier, p: FightJobPayload, durationMs: number) {
  const where = and(eq(fights.reportCode, p.reportCode), eq(fights.fightId, p.fightId));
  const [row] = await db.select({ phases: fights.phases }).from(fights).where(where).limit(1);
  if (!row || row.phases) return;
  const meta = await getFightMeta(wcl, p.reportCode, p.fightId);
  const phases = meta ? phaseSpans(meta.phaseTransitions, meta.startTime, durationMs, meta.phases) : [];
  const starts = meta ? executeStarts(meta.health, p.fightStartTime, durationMs) : {};
  const names = (meta?.abilities ?? []).filter((a) => a.gameID > 0 && a.name);
  for (let i = 0; i < names.length; i += 500) {
    await db
      .insert(abilities)
      .values(names.slice(i, i + 500).map((a) => ({ id: a.gameID, name: a.name, icon: a.icon || null })))
      .onConflictDoNothing();
  }
  await db.update(fights).set({ phases, executeStarts: starts }).where(where);
}

/**
 * For fights downloaded before execute windows were stored: fetches the bosses' health (1 query) only when a
 * ranked player in the fight cast an execute spell; otherwise marks the fight as checked ({}).
 */
async function ensureExecuteStarts(db: Db, wcl: WclQuerier, p: FightJobPayload, durationMs: number, snapshotId: number) {
  const where = and(eq(fights.reportCode, p.reportCode), eq(fights.fightId, p.fightId));
  const [row] = await db.select({ executeStarts: fights.executeStarts }).from(fights).where(where).limit(1);
  if (!row) return;
  const stored = row.executeStarts as Record<string, unknown> | null;
  if (stored && Object.keys(stored).length) return;

  const timelines = await db
    .select({ timeline: playerMetrics.timeline })
    .from(playerMetrics)
    .innerJoin(
      rankingEntries,
      and(
        eq(rankingEntries.reportCode, playerMetrics.reportCode),
        eq(rankingEntries.fightId, playerMetrics.fightId),
        eq(rankingEntries.name, playerMetrics.name),
        eq(rankingEntries.specKey, playerMetrics.specKey),
        eq(rankingEntries.snapshotId, snapshotId),
      ),
    )
    .where(and(eq(playerMetrics.reportCode, p.reportCode), eq(playerMetrics.fightId, p.fightId)));
  const castIds = [...new Set(timelines.flatMap((t) => ((t.timeline as CastMark[] | null) ?? []).map(([, id]) => id)))];
  const named = castIds.length ? await db.select({ name: abilities.name }).from(abilities).where(inArray(abilities.id, castIds)) : [];
  if (!named.some((a) => isExecuteSpell(a.name))) {
    if (!stored) await db.update(fights).set({ executeStarts: {} }).where(where);
    return;
  }
  const health = await getHealthGraph(wcl, p.reportCode, p.fightId);
  await db.update(fights).set({ executeStarts: executeStarts(health, p.fightStartTime, durationMs) }).where(where);
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
