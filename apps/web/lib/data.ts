import {
  type AvoidabilityMap,
  type CastsTableEntry,
  type Comparison,
  type DamageTakenEvent,
  type DeathStory,
  type HpEvent,
  type Fix,
  type PlayerReport,
  type RaidDeath,
  type SpecBenchmark,
  aliveTime,
  buffUptimes,
  buildDeathStory,
  buildPlayerReport,
  compareToBenchmark,
  rankFixes,
  roleOf,
} from "@log-review/analysis";
import {
  abilities as abilitiesTable,
  benchmarks,
  encounterAbilities,
  playerFightCache,
  playerMetrics,
  rankingEntries,
  snapshots,
} from "@log-review/db";
import {
  ENEMY_SOURCES,
  type Fight,
  type PlayerDetails,
  type ReportOverview,
  getFightEvents,
  getFightTable,
  getPlayerDetails,
  getReportOverview,
} from "@log-review/wcl";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, getWcl } from "./server";

/** Small in-memory cache with expiry; enough for one web instance. */
function memo<T>(ttlMs: number, maxEntries = 500) {
  const entries = new Map<string, { value: Promise<T>; expires: number }>();
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const hit = entries.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = load();
    value.catch(() => entries.delete(key)); // don't cache failures
    entries.set(key, { value, expires: Date.now() + ttlMs });
    if (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
    return value;
  };
}

// Live-logged reports gain pulls, so the overview is only cached briefly.
const overviews = memo<ReportOverview>(5 * 60_000);
const playerDetails = memo<PlayerDetails>(24 * 60 * 60_000);

export function getOverview(code: string) {
  return overviews(code, () => getReportOverview(getWcl(), code));
}

export async function getFight(code: string, fightId: number): Promise<{ report: ReportOverview; fight: Fight } | null> {
  const report = await getOverview(code);
  const fight = report.fights.find((f) => f.id === fightId);
  return fight ? { report, fight } : null;
}

export function getPlayers(code: string, fightId: number) {
  return playerDetails(`${code}:${fightId}`, () => getPlayerDetails(getWcl(), code, fightId));
}

/** The player's own performance data, for comparing against top players. */
interface PerfData {
  activeTimeMs: number;
  /** [fightTimeMs, abilityId] for every completed cast. */
  casts: [number, number][];
  damageByAbility: Record<string, number>;
  targetDamage: Record<string, number>;
  totalDamage: number;
  buffUptime: Record<string, number>;
}

interface CachedPlayerData {
  deaths: RaidDeath[];
  damageTaken: DamageTakenEvent[];
  /** Added in Phase 2; older cache rows are filled in on first view. */
  perf?: PerfData;
  /** Damage and healing (with health) in the seconds before each death, keyed by death timestamp. */
  deathWindows?: Record<string, { damage: HpEvent[]; heals: HpEvent[] }>;
}

const DEATH_WINDOW_MS = 15_000;

const slimHp = (e: Record<string, unknown>): HpEvent => ({
  timestamp: e.timestamp as number,
  type: e.type as string,
  sourceID: e.sourceID as number | undefined,
  abilityGameID: e.abilityGameID as number | undefined,
  amount: e.amount as number | undefined,
  absorbed: e.absorbed as number | undefined,
  overkill: e.overkill as number | undefined,
  hitPoints: e.hitPoints as number | undefined,
  maxHitPoints: e.maxHitPoints as number | undefined,
});

/** Builds a death story per death (by order). Fetches 2 queries per death the first time, then caches. */
async function getDeathStories(
  code: string,
  fight: Fight,
  actorId: number,
  data: CachedPlayerData,
  deaths: { order: number; timestamp: number; killingAbilityGameID?: number }[],
): Promise<Record<number, DeathStory>> {
  const windows = { ...data.deathWindows };
  const missing = deaths.filter((d) => !windows[d.timestamp]);
  if (missing.length) {
    const wcl = getWcl();
    for (const d of missing) {
      const range = { id: fight.id, startTime: d.timestamp - DEATH_WINDOW_MS, endTime: d.timestamp + 1 };
      // DamageTaken's sourceID is the player taking damage; Healing's targetID is the player being healed.
      const damage = await getFightEvents(wcl, code, range, "DamageTaken", {
        sourceID: actorId,
        filterExpression: ENEMY_SOURCES,
        includeResources: true,
      });
      const heals = await getFightEvents(wcl, code, range, "Healing", { targetID: actorId, includeResources: true });
      windows[d.timestamp] = {
        damage: damage.map(slimHp),
        heals: heals.filter((h) => h.targetID === actorId).map(slimHp),
      };
    }
    await getDb()
      .update(playerFightCache)
      .set({ data: { ...data, deathWindows: windows } })
      .where(
        and(eq(playerFightCache.reportCode, code), eq(playerFightCache.fightId, fight.id), eq(playerFightCache.actorId, actorId)),
      );
  }
  const stories: Record<number, DeathStory> = {};
  for (const d of deaths) {
    const w = windows[d.timestamp];
    if (w) stories[d.order] = buildDeathStory(d, w.damage, w.heals, fight.startTime, { windowMs: DEATH_WINDOW_MS });
  }
  return stories;
}

interface DamageDoneAbility {
  guid: number;
  total: number;
  targets?: { name: string; total: number }[];
}

/** 4 WCL queries: the player's casts, buffs and damage, plus WCL's active time. */
async function fetchPerfData(code: string, fight: Fight, actorId: number): Promise<PerfData> {
  const wcl = getWcl();
  const durationMs = fight.endTime - fight.startTime;
  const castsTable = await getFightTable<{ entries: CastsTableEntry[] }>(wcl, code, fight.id, "Casts");
  const castEvents = await getFightEvents(wcl, code, fight, "Casts", { sourceID: actorId });
  const buffs = await getFightTable<{ auras: { guid: number; totalUptime: number }[] }>(wcl, code, fight.id, "Buffs", {
    sourceID: actorId,
  });
  const damage = await getFightTable<{ entries: DamageDoneAbility[] }>(wcl, code, fight.id, "DamageDone", { sourceID: actorId });

  const damageByAbility: Record<string, number> = {};
  const targetDamage: Record<string, number> = {};
  for (const a of damage.entries ?? []) {
    damageByAbility[a.guid] = (damageByAbility[a.guid] ?? 0) + a.total;
    for (const t of a.targets ?? []) targetDamage[t.name] = (targetDamage[t.name] ?? 0) + t.total;
  }
  return {
    activeTimeMs: castsTable.entries.find((e) => e.id === actorId)?.activeTime ?? 0,
    casts: castEvents
      .filter((e) => e.type === "cast" && e.abilityGameID)
      .map((e) => [e.timestamp - fight.startTime, e.abilityGameID!]),
    damageByAbility,
    targetDamage,
    totalDamage: Object.values(damageByAbility).reduce((a, b) => a + b, 0),
    buffUptime: buffUptimes(buffs.auras ?? [], durationMs),
  };
}

/** Deaths and this player's damage taken: 2–3 WCL queries the first time, free after that. */
async function getPlayerData(code: string, fight: Fight, actorId: number): Promise<CachedPlayerData> {
  const db = getDb();
  const key = and(
    eq(playerFightCache.reportCode, code),
    eq(playerFightCache.fightId, fight.id),
    eq(playerFightCache.actorId, actorId),
  );
  const [cached] = await db.select({ data: playerFightCache.data }).from(playerFightCache).where(key).limit(1);
  if (cached) {
    const data = cached.data as CachedPlayerData;
    if (data.perf) return data;
    const filled = { ...data, perf: await fetchPerfData(code, fight, actorId) };
    await db.update(playerFightCache).set({ data: filled }).where(key);
    return filled;
  }

  const wcl = getWcl();
  const deaths = await getFightEvents(wcl, code, fight, "Deaths");
  // In WCL's DamageTaken view, sourceID is the player taking the damage.
  const damage = await getFightEvents(wcl, code, fight, "DamageTaken", { sourceID: actorId, filterExpression: ENEMY_SOURCES });
  const data: CachedPlayerData = {
    deaths: deaths.map((d) => ({
      timestamp: d.timestamp,
      targetID: d.targetID,
      killerID: d.killerID as number | undefined,
      killingAbilityGameID: d.killingAbilityGameID as number | undefined,
    })),
    damageTaken: damage.map((e) => ({
      timestamp: e.timestamp,
      type: e.type,
      abilityGameID: e.abilityGameID,
      amount: e.amount as number | undefined,
      absorbed: e.absorbed as number | undefined,
    })),
    perf: await fetchPerfData(code, fight, actorId),
  };
  await db.insert(playerFightCache).values({ reportCode: code, fightId: fight.id, actorId, data }).onConflictDoNothing();
  return data;
}

/** Avoidability for a boss and difficulty from the newest snapshot that has it. */
async function getAvoidability(encounterId: number, difficulty: number): Promise<{ map: AvoidabilityMap; week: string | null }> {
  const db = getDb();
  const scope = and(eq(encounterAbilities.encounterId, encounterId), eq(encounterAbilities.difficulty, difficulty));
  const [latest] = await db
    .select({ snapshotId: encounterAbilities.snapshotId, week: snapshots.week })
    .from(encounterAbilities)
    .innerJoin(snapshots, eq(snapshots.id, encounterAbilities.snapshotId))
    .where(scope)
    .orderBy(desc(encounterAbilities.snapshotId))
    .limit(1);
  if (!latest) return { map: {}, week: null };

  const rows = await db
    .select()
    .from(encounterAbilities)
    .where(and(scope, eq(encounterAbilities.snapshotId, latest.snapshotId)));
  const map: AvoidabilityMap = {};
  for (const r of rows) map[r.abilityId] = { classification: r.classification, zeroShare: r.zeroShare };
  return { map, week: latest.week };
}

export interface TopPlayer {
  name: string;
  amount: number;
  durationMs: number;
  timeline: [number, number][];
}

/** The spec's benchmark from the newest snapshot that has one, plus the #1 player's cast timeline. */
async function getBenchmark(
  encounterId: number,
  difficulty: number,
  specKey: string,
): Promise<{ benchmark: SpecBenchmark; week: string; top: TopPlayer | null } | null> {
  const db = getDb();
  const [row] = await db
    .select({ data: benchmarks.data, snapshotId: benchmarks.snapshotId, week: snapshots.week })
    .from(benchmarks)
    .innerJoin(snapshots, eq(snapshots.id, benchmarks.snapshotId))
    .where(and(eq(benchmarks.encounterId, encounterId), eq(benchmarks.difficulty, difficulty), eq(benchmarks.specKey, specKey)))
    .orderBy(desc(benchmarks.snapshotId))
    .limit(1);
  if (!row) return null;

  const [top] = await db
    .select({
      name: rankingEntries.name,
      amount: rankingEntries.amount,
      durationMs: rankingEntries.durationMs,
      timeline: playerMetrics.timeline,
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
        eq(rankingEntries.snapshotId, row.snapshotId),
        eq(rankingEntries.encounterId, encounterId),
        eq(rankingEntries.difficulty, difficulty),
        eq(rankingEntries.specKey, specKey),
        eq(rankingEntries.rank, 1),
      ),
    )
    .limit(1);

  return {
    benchmark: row.data as SpecBenchmark,
    week: row.week,
    top: top?.timeline ? { ...top, timeline: top.timeline as [number, number][] } : null,
  };
}

export interface PlayerAnalysis {
  report: ReportOverview;
  fight: Fight;
  player: { id: number; name: string; classSlug: string; specKey: string | null };
  analysis: PlayerReport;
  /** Timestamped story of each death that mattered, by death order. */
  deathStories: Record<number, DeathStory>;
  comparison: Comparison | null;
  /** Survival and DPS findings in one ranked list. */
  fixes: Fix[];
  benchmarkWeek: string | null;
  topPlayer: TopPlayer | null;
  playerCasts: [number, number][];
  snapshotWeek: string | null;
  abilities: Record<number, { name: string; icon: string }>;
  names: Record<number, string>;
  /** Class slug per player ID, for coloring names. */
  classes: Record<number, string>;
}

export async function getPlayerAnalysis(code: string, fightId: number, actorId: number): Promise<PlayerAnalysis | null> {
  const found = await getFight(code, fightId);
  const actor = found?.report.players.find((p) => p.id === actorId);
  if (!found || !actor) return null;
  const { report, fight } = found;

  const [data, details, avoidability] = await Promise.all([
    getPlayerData(code, fight, actorId),
    getPlayers(code, fightId),
    fight.difficulty ? getAvoidability(fight.encounterID, fight.difficulty) : Promise.resolve({ map: {}, week: null }),
  ]);
  const detail = [...details.tanks, ...details.healers, ...details.dps].find((p) => p.id === actorId);
  const specKey = detail?.icon ?? null;
  const bench = specKey && fight.difficulty ? await getBenchmark(fight.encounterID, fight.difficulty, specKey) : null;

  const analysis = buildPlayerReport({
    playerId: actorId,
    fightStartTime: fight.startTime,
    raidSize: fight.friendlyPlayers?.length ?? 20,
    kill: !!fight.kill,
    raidDeaths: data.deaths,
    damageTaken: data.damageTaken,
    avoidability: avoidability.map,
  });

  const deathStories = await getDeathStories(
    code,
    fight,
    actorId,
    data,
    analysis.deaths.filter((d) => d.category !== "after-wipe"),
  );

  const durationMs = fight.endTime - fight.startTime;
  const perf = data.perf!;
  const comparison = bench
    ? compareToBenchmark(
        {
          // Healers are benchmarked by HPS, so their DPS isn't comparable.
          amount: specKey && roleOf(specKey) !== "healer" ? perf.totalDamage / (durationMs / 1000) : null,
          durationMs,
          aliveMs: aliveTime(
            durationMs,
            data.deaths.filter((d) => d.targetID === actorId).map((d) => d.timestamp - fight.startTime),
          ),
          itemLevel: detail?.maxItemLevel ?? null,
          activeTimeMs: perf.activeTimeMs,
          casts: countCasts(perf.casts),
          damageByAbility: perf.damageByAbility,
          buffUptime: perf.buffUptime,
          targetShare: shares(perf.targetDamage, perf.totalDamage),
        },
        bench.benchmark,
      )
    : null;

  const abilities: PlayerAnalysis["abilities"] = {};
  for (const a of report.abilities) abilities[a.gameID] = { name: a.name, icon: a.icon };
  // Benchmark abilities you never used aren't in your report; look their names up from the crawler's data.
  const missing = comparison
    ? [...comparison.abilities, ...comparison.buffs].map((a) => a.abilityId).filter((id) => !abilities[id])
    : [];
  if (missing.length) {
    const rows = await getDb().select().from(abilitiesTable).where(inArray(abilitiesTable.id, missing));
    for (const r of rows) abilities[r.id] = { name: r.name, icon: r.icon ?? "" };
  }
  const names: Record<number, string> = {};
  const classes: Record<number, string> = {};
  for (const p of report.players) {
    names[p.id] = p.name;
    classes[p.id] = p.subType;
  }

  return {
    report,
    fight,
    player: { id: actorId, name: actor.name, classSlug: actor.subType, specKey },
    analysis,
    deathStories,
    comparison,
    fixes: rankFixes(analysis, comparison),
    benchmarkWeek: bench?.week ?? null,
    topPlayer: bench?.top ?? null,
    playerCasts: perf.casts,
    snapshotWeek: avoidability.week,
    abilities,
    names,
    classes,
  };
}

function countCasts(casts: [number, number][]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [, id] of casts) out[id] = (out[id] ?? 0) + 1;
  return out;
}

function shares(byKey: Record<string, number>, total: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (total > 0) for (const [k, v] of Object.entries(byKey)) out[k] = v / total;
  return out;
}
