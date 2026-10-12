import {
  type AvoidabilityMap,
  type CastsTableEntry,
  type Comparison,
  type DamageTakenEvent,
  type DeathStory,
  type ExecuteStarts,
  type DebuffEvent,
  type ConsumableCounts,
  type DefensiveReview,
  type HpEvent,
  type Fix,
  type PlayerReport,
  type RaidDeath,
  type PhaseSpan,
  type SpecBenchmark,
  type TimelineReview,
  aliveTime,
  buffUptimes,
  buildDeathStory,
  buildPlayerReport,
  compareToBenchmark,
  rankFixes,
  countConsumables,
  findPrecasts,
  OPENER_MS,
  gainOf,
  isCombatPotion,
  isCooldownCpm,
  executeStarts,
  executeThresholdOf,
  isAoeSpell,
  hitsSeveralTargets,
  isExecuteSpell,
  isRaidUtility,
  isUtilitySpell,
  phaseSpans,
  reviewDefensives,
  reviewTimeline,
  roleOf,
} from "@log-review/analysis";
import { type AbilityTip, getAbilityTip, getBoss } from "@log-review/encounters";
import {
  abilities as abilitiesTable,
  benchmarks,
  encounterAbilities,
  fights,
  playerFightCache,
  playerMetrics,
  rankingEntries,
  snapshots,
} from "@log-review/db";
import {
  ENEMY_SOURCES,
  type Fight,
  type PlayerDetails,
  type WclEvent,
  type ReportOverview,
  getFightEvents,
  getFightTable,
  getHealthGraph,
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

// Top players' reports are finished logs, so their phases can be kept for a day.
const topOverviews = memo<ReportOverview>(24 * 60 * 60_000, 200);

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
  /** Spells hardcast before the pull. Added later; older cache rows are filled in on first view. */
  precasts?: number[];
  damageByAbility: Record<string, number>;
  targetDamage: Record<string, number>;
  totalDamage: number;
  buffUptime: Record<string, number>;
  /**
   * When a boss first reached each execute threshold, for judging execute spells. null when the player cast
   * none (not fetched); undefined in rows cached before this existed (filled in on first view).
   */
  executeStarts?: Partial<ExecuteStarts> | null;
  /** Abilities that spread their damage over 3+ enemies this pull (AoE, even if not in the list). Missing in older rows. */
  aoeIds?: number[];
}

interface CachedPlayerData {
  deaths: RaidDeath[];
  damageTaken: DamageTakenEvent[];
  /** Added in Phase 2; older cache rows are filled in on first view. */
  perf?: PerfData;
  /** Damage and healing (with health) in the seconds before each death, keyed by death timestamp. */
  deathWindows?: Record<string, { damage: HpEvent[]; heals: HpEvent[] }>;
  /** Boss debuffs on the player for the whole pull (stacks build up long before a death). */
  bossDebuffs?: DebuffEvent[];
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

/**
 * Builds a death story per death (by order). The first time, fetches 2 queries per death plus 1 for
 * the player's boss debuffs over the pull, then caches.
 */
async function getDeathStories(
  code: string,
  fight: Fight,
  actorId: number,
  playerIds: Set<number>,
  data: CachedPlayerData,
  deaths: { order: number; timestamp: number; killingAbilityGameID?: number }[],
): Promise<{ stories: Record<number, DeathStory>; windows: NonNullable<CachedPlayerData["deathWindows"]> }> {
  const windows = { ...data.deathWindows };
  const missing = deaths.filter((d) => !windows[d.timestamp]);
  let bossDebuffs = data.bossDebuffs;
  if (deaths.length && !bossDebuffs) {
    // In WCL's Debuffs view, sourceID is the player who has the debuff; drop debuffs other players put on them.
    const events = await getFightEvents(getWcl(), code, fight, "Debuffs", { sourceID: actorId });
    bossDebuffs = events
      .filter((e) => e.targetID === actorId && !playerIds.has(e.sourceID ?? -1))
      .map((e) => ({
        timestamp: e.timestamp,
        type: e.type,
        sourceID: e.sourceID,
        abilityGameID: e.abilityGameID,
        stack: e.stack as number | undefined,
      }));
  }
  if (missing.length || bossDebuffs !== data.bossDebuffs) {
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
      .set({ data: { ...data, deathWindows: windows, bossDebuffs } })
      .where(
        and(eq(playerFightCache.reportCode, code), eq(playerFightCache.fightId, fight.id), eq(playerFightCache.actorId, actorId)),
      );
  }
  const stories: Record<number, DeathStory> = {};
  for (const d of deaths) {
    const w = windows[d.timestamp];
    if (w) stories[d.order] = buildDeathStory(d, w.damage, w.heals, fight.startTime, { windowMs: DEATH_WINDOW_MS }, bossDebuffs);
  }
  return { stories, windows };
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
    aoeIds: (damage.entries ?? []).filter((a) => hitsSeveralTargets(a.targets)).map((a) => a.guid),
    activeTimeMs: castsTable.entries.find((e) => e.id === actorId)?.activeTime ?? 0,
    casts: castEvents
      .filter((e) => e.type === "cast" && e.abilityGameID)
      .map((e) => [e.timestamp - fight.startTime, e.abilityGameID!]),
    precasts: precastsOf(castEvents, fight),
    damageByAbility,
    targetDamage,
    totalDamage: Object.values(damageByAbility).reduce((a, b) => a + b, 0),
    buffUptime: buffUptimes(buffs.auras ?? [], durationMs),
  };
}

function precastsOf(castEvents: WclEvent[], fight: Fight): number[] {
  return findPrecasts(
    castEvents
      .filter((e) => e.abilityGameID)
      .map((e) => ({ fightTimeMs: e.timestamp - fight.startTime, type: e.type, abilityId: e.abilityGameID! })),
  );
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
    if (data.perf?.precasts) return data;
    if (data.perf) {
      // Cached before precast detection: 1 query for the cast events.
      const castEvents = await getFightEvents(getWcl(), code, fight, "Casts", { sourceID: actorId });
      const filled = { ...data, perf: { ...data.perf, precasts: precastsOf(castEvents, fight) } };
      await db.update(playerFightCache).set({ data: filled }).where(key);
      return filled;
    }
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
async function getAvoidability(
  encounterId: number,
  difficulty: number,
): Promise<{ map: AvoidabilityMap; tankMap: AvoidabilityMap; week: string | null }> {
  const db = getDb();
  const scope = and(eq(encounterAbilities.encounterId, encounterId), eq(encounterAbilities.difficulty, difficulty));
  const [latest] = await db
    .select({ snapshotId: encounterAbilities.snapshotId, week: snapshots.week })
    .from(encounterAbilities)
    .innerJoin(snapshots, eq(snapshots.id, encounterAbilities.snapshotId))
    .where(scope)
    .orderBy(desc(encounterAbilities.snapshotId))
    .limit(1);
  if (!latest) return { map: {}, tankMap: {}, week: null };

  const rows = await db
    .select()
    .from(encounterAbilities)
    .where(and(scope, eq(encounterAbilities.snapshotId, latest.snapshotId)));
  const map: AvoidabilityMap = {};
  // Tanks' view, falling back to everyone's for abilities (or snapshots) without enough tank data.
  const tankMap: AvoidabilityMap = {};
  for (const r of rows) {
    map[r.abilityId] = { classification: r.classification, zeroShare: r.zeroShare, fightShare: r.fightShare, raidBreadth: r.raidBreadth };
    tankMap[r.abilityId] =
      r.tankClassification && r.tankZeroShare != null
        ? { ...map[r.abilityId]!, classification: r.tankClassification, zeroShare: r.tankZeroShare }
        : map[r.abilityId]!;
  }
  return { map, tankMap, week: latest.week };
}

export interface TopPlayer {
  name: string;
  amount: number;
  durationMs: number;
  timeline: [number, number][];
  /** Boss phases in the #1 player's fight; [] if the boss has none or their log couldn't be read. */
  phases: PhaseSpan[];
}

/**
 * The phases of a top player's fight: stored by the crawler, or for fights crawled before that,
 * 1 WCL query per report, cached for a day.
 */
async function getTopPhases(reportCode: string, fightId: number, durationMs: number, stored: unknown): Promise<PhaseSpan[]> {
  if (stored) return stored as PhaseSpan[];
  try {
    const report = await topOverviews(reportCode, () => getReportOverview(getWcl(), reportCode));
    const fight = report.fights.find((f) => f.id === fightId);
    if (!fight) return [];
    const names = report.phases.find((p) => p.encounterID === fight.encounterID)?.phases ?? [];
    return phaseSpans(fight.phaseTransitions, fight.startTime, durationMs, names);
  } catch {
    return [];
  }
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
      reportCode: rankingEntries.reportCode,
      fightId: rankingEntries.fightId,
      timeline: playerMetrics.timeline,
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
    top: top?.timeline
      ? {
          name: top.name,
          amount: top.amount,
          durationMs: top.durationMs,
          timeline: top.timeline as [number, number][],
          phases: await getTopPhases(top.reportCode, top.fightId, top.durationMs, top.phases),
        }
      : null,
  };
}

export interface PlayerAnalysis {
  report: ReportOverview;
  fight: Fight;
  player: { id: number; name: string; classSlug: string; specKey: string | null };
  analysis: PlayerReport;
  /** Timestamped story of each death that mattered, by death order. */
  deathStories: Record<number, DeathStory>;
  /** Defensives and consumables around each death, by death order. */
  defensiveReviews: Record<number, DefensiveReview>;
  /** Potions and healthstones over the whole pull, counted from casts. */
  consumables: ConsumableCounts;
  /** Boss strategy tips by ability ID, where we have one. */
  tips: Record<number, AbilityTip>;
  bossGuide: { name: string; url: string } | null;
  comparison: Comparison | null;
  /** Precast, opener and activity per phase, vs the #1 player when we have their timeline. */
  timeline: TimelineReview;
  /** Boss phases in this pull ([] if the boss has none). */
  phases: PhaseSpan[];
  /** Survival and DPS findings in one ranked list. */
  fixes: Fix[];
  benchmarkWeek: string | null;
  topPlayer: TopPlayer | null;
  playerCasts: [number, number][];
  /** DPS cooldowns (and the combat potion) for the cooldown chart; no defensives or movement. */
  cooldownIds: number[];
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
    fight.difficulty ? getAvoidability(fight.encounterID, fight.difficulty) : Promise.resolve({ map: {}, tankMap: {}, week: null }),
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
    // Tanks take boss melee and tank busters on purpose, so they're judged by top tanks.
    avoidability: specKey && roleOf(specKey) === "tank" ? avoidability.tankMap : avoidability.map,
  });

  const { stories: deathStories, windows: deathWindows } = await getDeathStories(
    code,
    fight,
    actorId,
    new Set(report.players.map((p) => p.id)),
    data,
    analysis.deaths.filter((d) => d.category !== "after-wipe"),
  );

  const durationMs = fight.endTime - fight.startTime;
  let perf = data.perf!;
  if (perf.executeStarts === undefined) {
    // Boss health over the pull (1 query, cached), only for players who cast an execute spell.
    const names = new Map(report.abilities.map((a) => [a.gameID, a.name]));
    const castsExecute = perf.casts.some(([, id]) => isExecuteSpell(names.get(id) ?? ""));
    const starts = castsExecute ? executeStarts(await getHealthGraph(getWcl(), code, fight.id), fight.startTime, durationMs) : null;
    perf = { ...perf, executeStarts: starts };
    await getDb()
      .update(playerFightCache)
      .set({ data: { ...data, perf } })
      .where(and(eq(playerFightCache.reportCode, code), eq(playerFightCache.fightId, fight.id), eq(playerFightCache.actorId, actorId)));
  }
  // Healers are benchmarked by HPS, so their DPS isn't comparable.
  const amount = specKey && roleOf(specKey) !== "healer" ? perf.totalDamage / (durationMs / 1000) : null;
  const aliveMs = aliveTime(
    durationMs,
    data.deaths.filter((d) => d.targetID === actorId).map((d) => d.timestamp - fight.startTime),
  );
  const top = bench?.top ?? null;
  const topOpener = (top?.timeline ?? []).filter(([t]) => t <= OPENER_MS);

  const abilities: PlayerAnalysis["abilities"] = {};
  for (const a of report.abilities) abilities[a.gameID] = { name: a.name, icon: a.icon };
  // Benchmark abilities (and #1's opener casts) you never used aren't in your report; look their names up from the crawler's data.
  const missing = [
    ...new Set([
      ...(bench ? [...Object.keys(bench.benchmark.cpm), ...Object.keys(bench.benchmark.buffUptime)].map(Number) : []),
      ...topOpener.map(([, id]) => id),
    ]),
  ].filter((id) => !abilities[id]);
  if (missing.length) {
    const rows = await getDb().select().from(abilitiesTable).where(inArray(abilitiesTable.id, missing));
    for (const r of rows) abilities[r.id] = { name: r.name, icon: r.icon ?? "" };
  }
  // Movement, defensives, raid utility and consumables never become DPS findings; Bloodlust isn't shown at all.
  const named = Object.entries(abilities).map(([id, a]) => [Number(id), a] as const);
  const utilityIds = new Set(named.filter(([, a]) => isUtilitySpell(a.name, a.icon)).map(([id]) => id));
  const hiddenIds = new Set(named.filter(([, a]) => isRaidUtility(a.name)).map(([id]) => id));
  const aoeIds = new Set([...named.filter(([, a]) => isAoeSpell(a.name)).map(([id]) => id), ...(perf.aoeIds ?? [])]);
  const executeIds = new Map(named.flatMap(([id, a]) => {
    const threshold = executeThresholdOf(a.name);
    return threshold ? [[id, threshold] as const] : [];
  }));

  const comparison = bench
    ? compareToBenchmark(
        {
          amount,
          durationMs,
          aliveMs,
          itemLevel: detail?.maxItemLevel ?? null,
          activeTimeMs: perf.activeTimeMs,
          casts: countCasts(perf.casts),
          damageByAbility: perf.damageByAbility,
          buffUptime: perf.buffUptime,
          targetShare: shares(perf.targetDamage, perf.totalDamage),
          castTimes: perf.casts,
          executeStarts: perf.executeStarts ?? null,
        },
        bench.benchmark,
        { utilityIds, hiddenIds, executeIds, aoeIds },
      )
    : null;

  // Players use different combat potions; compare when the first one was drunk, whichever it was.
  const potionIds = [...new Set([...perf.casts, ...topOpener].map(([, id]) => id))].filter(
    (id) => abilities[id] && isCombatPotion(abilities[id]!.name, abilities[id]!.icon),
  );
  // DPS cooldowns: cast at most ~2 times a minute by top players, not movement, defensives or utility.
  // Defensives depend on the fight's damage, so their timing says nothing about the rotation.
  // Executes are left out too: when they become usable depends on boss health.
  const dpsCooldowns = (comparison?.abilities ?? []).filter((a) => isCooldownCpm(a.benchmark) && a.role === "damage");
  const phaseNames = report.phases.find((p) => p.encounterID === fight.encounterID)?.phases ?? [];
  const phases = phaseSpans(fight.phaseTransitions, fight.startTime, durationMs, phaseNames);
  const timeline = reviewTimeline({
    casts: perf.casts,
    precasts: perf.precasts ?? [],
    durationMs,
    aliveMs,
    amount,
    phases,
    top: top ? { casts: top.timeline, durationMs: top.durationMs, phases: top.phases } : null,
    // Cooldowns: abilities top players cast at most ~2 times a minute, plus the combat potion. With timeline
    // medians, only those top players press in the first minute (not e.g. a blink used whenever).
    cooldownIds: [
      ...dpsCooldowns
        .filter((a) => {
          const first = bench?.benchmark.timeline?.firstUse[a.abilityId];
          return !bench?.benchmark.timeline || (first != null && first.median <= 60_000);
        })
        .map((a) => a.abilityId),
      ...(comparison ? potionIds : []),
    ],
    potionIds,
    benchmark: bench?.benchmark.timeline ?? null,
  });
  if (comparison && timeline.findings.length) {
    // Idle stretches and low casting time are the same problem; keep the one that says when it happened.
    const idle = timeline.findings.some((f) => f.kind === "idle-time");
    comparison.findings = [...comparison.findings.filter((f) => !(idle && f.kind === "low-active-time")), ...timeline.findings].sort(
      (x, y) => (gainOf(y) ?? -1) - (gainOf(x) ?? -1),
    );
  }

  // Defensives and consumables around each death. Names come from the report plus any benchmark lookups above.
  const abilityNames: Record<number, string> = {};
  for (const [id, a] of Object.entries(abilities)) abilityNames[Number(id)] = a.name;
  const commonForSpec = new Set(
    (comparison?.abilities ?? [])
      .filter((a) => a.benchmark.usedBy >= 0.5)
      .flatMap((a) => (abilityNames[a.abilityId] ? [abilityNames[a.abilityId]!] : [])),
  );
  const defensiveReviews: Record<number, DefensiveReview> = {};
  for (const d of analysis.deaths) {
    if (!deathStories[d.order]) continue;
    const selfHeals = (deathWindows[d.timestamp]?.heals ?? [])
      .filter((h) => h.sourceID === actorId && h.abilityGameID)
      .map((h) => ({ fightTimeMs: h.timestamp - fight.startTime, abilityId: h.abilityGameID! }));
    defensiveReviews[d.order] = reviewDefensives({
      classSlug: actor.subType,
      casts: perf.casts,
      windowHeals: selfHeals,
      names: abilityNames,
      deathFightTimeMs: d.fightTimeMs,
      windowMs: DEATH_WINDOW_MS,
      commonForSpec,
    });
  }

  // Boss tips for every ability that hit this player.
  const boss = getBoss(fight.encounterID);
  const tips: Record<number, AbilityTip> = {};
  for (const a of analysis.damageTaken) {
    const tip = getAbilityTip(fight.encounterID, abilities[a.abilityId]?.name);
    if (tip) tips[a.abilityId] = tip;
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
    defensiveReviews,
    consumables: countConsumables(
      perf.casts,
      abilityNames,
      Object.fromEntries(Object.entries(abilities).map(([id, a]) => [id, a.icon])),
    ),
    tips,
    bossGuide: boss?.guideUrl ? { name: boss.name, url: boss.guideUrl } : null,
    comparison,
    timeline,
    phases,
    fixes: rankFixes(analysis, comparison),
    benchmarkWeek: bench?.week ?? null,
    topPlayer: bench?.top ?? null,
    playerCasts: perf.casts,
    cooldownIds: [...dpsCooldowns.map((a) => a.abilityId), ...potionIds.slice(0, 1)],
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
