import {
  type DpsCheck,
  type ListedDeath,
  type NightDeath,
  type NightDeaths,
  type NightPull,
  type PullDamageTaken,
  type RaidDamageTaken,
  type SpecBenchmark,
  bestPulls,
  countedPulls,
  dpsCheck,
  listNightDeaths,
  nightDeaths,
  pullDamageTaken,
  raidDamageTaken,
  roleOf,
  similarLengthAmount,
} from "@log-review/analysis";
import { type AbilityTip, getAbilityTip } from "@log-review/encounters";
import { benchmarks, fights as fightsTable, reportCache } from "@log-review/db";
import { ENEMY_SOURCES, type Fight, type ReportOverview, getEventsForFights, getFightEvents, getFightTable, getTableForFights } from "@log-review/wcl";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getAvoidability, getOverview, getPlayers } from "./data";
import { getDb, getWcl } from "./server";

/**
 * Which pulls a raid view covers. "all" and "wipes" skip resets (pulls under 30s); a single pull is shown
 * whatever its length.
 */
export type RaidScope = { kind: "all" } | { kind: "wipes" } | { kind: "kill" } | { kind: "pull"; fightId: number };

export function parseScope(param: string | undefined): RaidScope {
  if (param === "wipes" || param === "kill" || param === "all") return { kind: param };
  const id = Number(param);
  return Number.isInteger(id) && id > 0 ? { kind: "pull", fightId: id } : { kind: "all" };
}

export const scopeParam = (s: RaidScope) => (s.kind === "pull" ? String(s.fightId) : s.kind);

/** WCL's Deaths table stops at 200 entries, so pulls are fetched in batches below that. */
const DEATHS_PER_BATCH = 190;
/** Damage-taken events are fetched per pull, a few pulls at a time. */
const FETCH_CONCURRENCY = 4;

interface DeathsTableEntry {
  id: number;
  name: string;
  fight: number;
  timestamp: number;
  killingBlow?: { guid: number; name: string };
  damage?: { abilities?: { guid: number; name: string; total: number }[] };
}

interface DamageDoneEntry {
  id: number;
  name: string;
  /** Class, e.g. "Mage". */
  type: string;
  /** "<Class>-<Spec>". */
  icon: string;
  total: number;
  targets?: { name: string; total: number; type?: string }[];
}

/** One pull's damage done per player (1 query), cached per pull. */
interface PullDamageDone {
  pullId: number;
  durationMs: number;
  bossPercentage: number;
  players: { id: number; name: string; classSlug: string; specKey: string; total: number; bossDamage: number }[];
}

type Pull = Fight & { pull: number };

export interface RaidPlayerRow {
  id: number;
  name: string;
  classSlug: string;
  specKey: string | null;
  role: "tank" | "healer" | "dps" | null;
  /** DPS in the damage pull and vs top players of the spec with the closest kill lengths (null for healers or without a benchmark). */
  dps: number | null;
  ratio: number | null;
  reference: number | null;
  bossShare: number | null;
  deaths: number;
  deathsMattered: number;
  avoidable: number;
  avoidableHits: number;
  avoidablePerPull: number;
  damageTaken: number;
}

export interface RaidView {
  report: ReportOverview;
  encounterId: number;
  difficulty: number;
  name: string;
  scope: RaidScope;
  /** Every pull of the boss, numbered in order. */
  pulls: Pull[];
  /** The pulls this view covers. */
  scoped: Pull[];
  kill: Pull | null;
  resets: number;
  deaths: NightDeaths;
  deathList: ListedDeath[];
  damageTaken: RaidDamageTaken;
  /** The pulls DPS was measured on: the scope's pull, the kill, or the 3 furthest wipes. */
  damagePulls: Pull[];
  /** Is the damage enough? For wipes only. */
  check: DpsCheck | null;
  /** Kill times of raids that killed it, to compare a kill with. */
  referenceKills: number[];
  players: RaidPlayerRow[];
  abilities: Record<number, { name: string; icon: string }>;
  tips: Record<number, AbilityTip>;
  names: Record<number, string>;
  classes: Record<number, string>;
}

/** Runs `load` over items a few at a time. */
async function inBatches<T, R>(items: T[], size: number, load: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(load))));
  return out;
}

/** A report cache row, loading and storing it on a miss. */
async function cached<T>(code: string, key: string, load: () => Promise<T>): Promise<T> {
  const db = getDb();
  const [row] = await db
    .select({ data: reportCache.data })
    .from(reportCache)
    .where(and(eq(reportCache.reportCode, code), eq(reportCache.key, key)))
    .limit(1);
  if (row) return row.data as T;
  const data = await load();
  await db.insert(reportCache).values({ reportCode: code, key, data }).onConflictDoNothing();
  return data;
}

/** Every death of the night with what hit them: 1 query plus 1 per ~190 deaths. */
async function fetchDeaths(code: string, pulls: Fight[]): Promise<NightDeath[]> {
  const wcl = getWcl();
  const deathEvents = await getEventsForFights(wcl, code, pulls, "Deaths");
  const perFight = new Map<number, number>();
  for (const e of deathEvents) perFight.set(e.fight, (perFight.get(e.fight) ?? 0) + 1);
  const batches: number[][] = [];
  let batch: number[] = [];
  let size = 0;
  for (const f of pulls) {
    const n = perFight.get(f.id) ?? 0;
    if (!n) continue;
    if (batch.length && size + n > DEATHS_PER_BATCH) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(f.id);
    size += n;
  }
  if (batch.length) batches.push(batch);

  const deaths: NightDeath[] = [];
  for (const ids of batches) {
    const table = await getTableForFights<{ entries?: DeathsTableEntry[] }>(wcl, code, ids, "Deaths");
    for (const e of table.entries ?? []) {
      deaths.push({
        fight: e.fight,
        timestamp: e.timestamp,
        playerId: e.id,
        name: e.name,
        killingBlow: e.killingBlow ? { id: e.killingBlow.guid, name: e.killingBlow.name } : null,
        window: (e.damage?.abilities ?? []).map((a) => ({ id: a.guid, name: a.name, total: a.total })),
      });
    }
  }
  return deaths;
}

/** One pull's damage taken from enemies by every player: ~2–3 queries for a Mythic pull, cached. */
function getPullDamageTaken(code: string, pull: Fight, playerIds: Set<number>): Promise<PullDamageTaken> {
  return cached(code, `dt:${pull.id}`, async () => {
    const events = await getFightEvents(getWcl(), code, pull, "DamageTaken", { filterExpression: ENEMY_SOURCES });
    return pullDamageTaken(
      pull.id,
      events.map((e) => ({ type: e.type, targetID: e.targetID, abilityGameID: e.abilityGameID, amount: e.amount as number, absorbed: e.absorbed as number })),
      playerIds,
    );
  });
}

/** One pull's damage done by every player: 1 query, cached. */
function getPullDamageDone(code: string, pull: Fight): Promise<PullDamageDone> {
  return cached(code, `dd:${pull.id}`, async () => {
    const table = await getFightTable<{ entries?: DamageDoneEntry[] }>(getWcl(), code, pull.id, "DamageDone");
    return {
      pullId: pull.id,
      durationMs: pull.endTime - pull.startTime,
      bossPercentage: pull.kill ? 0 : (pull.bossPercentage ?? 100),
      players: (table.entries ?? []).map((e) => ({
        id: e.id,
        name: e.name,
        classSlug: e.type,
        specKey: e.icon,
        total: e.total,
        bossDamage: (e.targets ?? []).filter((t) => t.type === "Boss").reduce((sum, t) => sum + t.total, 0),
      })),
    };
  });
}

/** Kill times of this boss from the kills the benchmark crawler downloaded (top players' fights). */
async function referenceKillTimes(encounterId: number, difficulty: number): Promise<number[]> {
  const rows = await getDb()
    .select({ durationMs: fightsTable.durationMs })
    .from(fightsTable)
    .where(and(eq(fightsTable.encounterId, encounterId), eq(fightsTable.difficulty, difficulty)));
  return rows.map((r) => r.durationMs);
}

/** The newest benchmark of every spec on this boss. */
async function specBenchmarks(encounterId: number, difficulty: number, specKeys: string[]): Promise<Map<string, SpecBenchmark>> {
  const out = new Map<string, SpecBenchmark>();
  if (!specKeys.length) return out;
  const rows = await getDb()
    .select({ specKey: benchmarks.specKey, data: benchmarks.data })
    .from(benchmarks)
    .where(and(eq(benchmarks.encounterId, encounterId), eq(benchmarks.difficulty, difficulty), inArray(benchmarks.specKey, specKeys)))
    .orderBy(desc(benchmarks.snapshotId));
  for (const r of rows) if (!out.has(r.specKey)) out.set(r.specKey, r.data as SpecBenchmark);
  return out;
}

const toNightPull = (p: Fight): NightPull => ({
  id: p.id,
  startTime: p.startTime,
  endTime: p.endTime,
  kill: !!p.kill,
  bossPercentage: p.bossPercentage,
  raidSize: p.friendlyPlayers?.length ?? 20,
});

function inScope(pulls: Pull[], scope: RaidScope): Pull[] {
  if (scope.kind === "pull") return pulls.filter((p) => p.id === scope.fightId);
  const counted = new Set(countedPulls(pulls.map(toNightPull)).map((p) => p.id));
  return pulls.filter((p) => counted.has(p.id) && (scope.kind === "all" || (scope.kind === "kill" ? p.kill : !p.kill)));
}

/**
 * What a raid leader needs for one boss over a scope of pulls. The first view of a pull costs ~3–4 WCL queries
 * (damage taken and done); deaths cost 1 query plus 1 per ~190 deaths for the whole night. All cached per report.
 */
export async function getRaidView(code: string, encounterId: number, difficulty: number, scope: RaidScope): Promise<RaidView | null> {
  const report = await getOverview(code);
  const all = report.fights.filter((f) => f.encounterID === encounterId && f.difficulty === difficulty);
  if (!all.length) return null;
  const pulls: Pull[] = all.map((f, i) => ({ ...f, pull: i + 1 }));
  const kill = pulls.find((p) => p.kill) ?? null;
  const scoped = inScope(pulls, scope);
  const playerIds = new Set(report.players.map((p) => p.id));

  // Live logs gain pulls, so the deaths cache key includes the last one.
  const allDeaths = await cached(code, `deaths:${encounterId}:${difficulty}:${pulls.at(-1)!.id}`, () =>
    fetchDeaths(code, countedPulls(all.map(toNightPull)).map((p) => all.find((f) => f.id === p.id)!)),
  );
  const scopedIds = new Set(scoped.map((p) => p.id));
  // A single short pull isn't in the night's deaths (resets are skipped there); fetch it on its own.
  const deathsInScope =
    scope.kind === "pull" && scoped[0] && scoped[0].endTime - scoped[0].startTime < 30_000
      ? await cached(code, `deaths-pull:${scoped[0].id}`, () => fetchDeaths(code, [scoped[0]!]))
      : allDeaths.filter((d) => scopedIds.has(d.fight));
  const nightPulls = scoped.map((p) => ({ ...toNightPull(p), endTime: Math.max(p.endTime, p.startTime + 30_000) }));
  const deaths = nightDeaths(nightPulls, deathsInScope);
  const deathList = listNightDeaths(nightPulls, deathsInScope);

  // Damage is measured on the scope's pull, the kill, or the furthest wipes.
  const wipes = scoped.filter((p) => !p.kill);
  const damagePulls =
    scope.kind === "pull" || scope.kind === "kill"
      ? scoped.slice(0, 1)
      : scope.kind === "all" && kill && scopedIds.has(kill.id)
        ? [kill]
        : bestPulls(wipes.map(toNightPull)).map((b) => scoped.find((p) => p.id === b.id)!);

  const tankPull = damagePulls[0] ?? scoped.at(-1);
  const [taken, done, avoidability, details, referenceKills] = await Promise.all([
    inBatches(scoped, FETCH_CONCURRENCY, (p) => getPullDamageTaken(code, p, playerIds)),
    inBatches(damagePulls, FETCH_CONCURRENCY, (p) => getPullDamageDone(code, p)),
    getAvoidability(encounterId, difficulty),
    tankPull ? getPlayers(code, tankPull.id) : Promise.resolve(null),
    referenceKillTimes(encounterId, difficulty),
  ]);
  const tankIds = new Set((details?.tanks ?? []).map((t) => t.id));
  const roles = new Map<number, RaidPlayerRow["role"]>();
  const specs = new Map<number, string>();
  for (const [role, list] of [["tank", details?.tanks], ["healer", details?.healers], ["dps", details?.dps]] as const) {
    for (const p of list ?? []) {
      roles.set(p.id, role);
      if (p.icon) specs.set(p.id, p.icon);
    }
  }
  const damageTaken = raidDamageTaken(taken, avoidability.map, avoidability.tankMap, tankIds);

  const check =
    done.length && done.every((d) => d.bossPercentage > 0)
      ? dpsCheck(
          done.map((d) => ({ pullId: d.pullId, durationMs: d.durationMs, bossPercentage: d.bossPercentage, bossDamage: d.players.reduce((s, p) => s + p.bossDamage, 0) })),
          referenceKills,
        )
      : null;

  // Players: everyone in the scope's pulls, with DPS from the first damage pull.
  const dmg = done[0];
  for (const p of dmg?.players ?? []) if (!specs.has(p.id)) specs.set(p.id, p.specKey);
  const benches = await specBenchmarks(encounterId, difficulty, [...new Set(specs.values())]);
  const inPulls = new Set([...damageTaken.players.map((p) => p.playerId), ...(dmg?.players ?? []).map((p) => p.id), ...deathList.map((d) => d.playerId)]);
  const players: RaidPlayerRow[] = report.players
    .filter((p) => inPulls.has(p.id))
    .map((p) => {
      const specKey = specs.get(p.id) ?? null;
      const role = roles.get(p.id) ?? (specKey ? roleOf(specKey) : null);
      const d = dmg?.players.find((x) => x.id === p.id);
      const dps = d && dmg ? (d.total * 1000) / dmg.durationMs : null;
      const bench = specKey ? benches.get(specKey) : undefined;
      // Healers are ranked by healing, so their DPS isn't compared.
      const reference =
        bench && dmg && role !== "healer" ? (similarLengthAmount(bench.amountPoints, dmg.durationMs)?.median ?? bench.amount.median) : null;
      const taken = damageTaken.players.find((x) => x.playerId === p.id);
      const own = deathList.filter((x) => x.playerId === p.id);
      return {
        id: p.id,
        name: p.name,
        classSlug: p.subType,
        specKey,
        role,
        dps,
        ratio: reference && dps != null ? dps / reference : null,
        reference,
        bossShare: d && d.total ? d.bossDamage / d.total : null,
        deaths: own.length,
        deathsMattered: own.filter((x) => x.mattered).length,
        avoidable: taken?.avoidable ?? 0,
        avoidableHits: taken?.avoidableHits ?? 0,
        avoidablePerPull: taken?.avoidablePerPull ?? 0,
        damageTaken: taken?.total ?? 0,
      };
    })
    .sort((a, b) => (b.dps ?? -1) - (a.dps ?? -1));

  const abilities: RaidView["abilities"] = {};
  for (const a of report.abilities) abilities[a.gameID] = { name: a.name, icon: a.icon };
  const tips: Record<number, AbilityTip> = {};
  for (const id of [...deaths.causes.map((c) => c.abilityId), ...damageTaken.abilities.map((a) => a.abilityId)]) {
    const tip = getAbilityTip(encounterId, abilities[id]?.name ?? deaths.causes.find((c) => c.abilityId === id)?.name);
    if (tip) tips[id] = tip;
  }
  const names: Record<number, string> = {};
  const classes: Record<number, string> = {};
  for (const p of report.players) {
    names[p.id] = p.name;
    classes[p.id] = p.subType;
  }

  return {
    report,
    encounterId,
    difficulty,
    name: all[0]!.name,
    scope,
    pulls,
    scoped,
    kill,
    resets: pulls.length - countedPulls(pulls.map(toNightPull)).length,
    deaths,
    deathList,
    damageTaken,
    damagePulls,
    check,
    referenceKills,
    players,
    abilities,
    tips,
    names,
    classes,
  };
}

/** Per pull, for one player: deaths and avoidable damage. */
export interface RaidPlayerPull {
  pull: Pull;
  deaths: ListedDeath[];
  avoidable: number;
  damageTaken: number;
}

export interface RaidPlayerView {
  view: RaidView;
  player: RaidPlayerRow;
  deaths: ListedDeath[];
  /** Damage taken by ability over the scope, with avoidability. */
  abilities: { abilityId: number; classification: RaidDamageTaken["abilities"][number]["classification"]; total: number; hits: number; pulls: number }[];
  perPull: RaidPlayerPull[];
}

export async function getRaidPlayer(code: string, encounterId: number, difficulty: number, scope: RaidScope, actorId: number): Promise<RaidPlayerView | null> {
  const view = await getRaidView(code, encounterId, difficulty, scope);
  const player = view?.players.find((p) => p.id === actorId);
  if (!view || !player) return null;
  // Already cached by the raid view (for every player); keep only this player's hits.
  const playerIds = new Set(view.report.players.map((p) => p.id));
  const taken = (await inBatches(view.scoped, FETCH_CONCURRENCY, (p) => getPullDamageTaken(code, p, playerIds))).map((t) => ({
    pullId: t.pullId,
    byPlayer: t.byPlayer[actorId] ? { [actorId]: t.byPlayer[actorId]! } : {},
  }));
  const tank = player.role === "tank";
  const avoidability = await getAvoidability(encounterId, difficulty);
  const mine = raidDamageTaken(taken, avoidability.map, avoidability.tankMap, tank ? new Set([actorId]) : new Set());
  const lookup = tank ? avoidability.tankMap : avoidability.map;
  const deaths = view.deathList.filter((d) => d.playerId === actorId);
  return {
    view,
    player,
    deaths,
    abilities: mine.abilities.map((a) => ({ abilityId: a.abilityId, classification: lookup[a.abilityId]?.classification ?? null, total: a.total, hits: a.hits, pulls: a.pulls })),
    perPull: view.scoped.map((pull) => {
      const byAbility = taken.find((t) => t.pullId === pull.id)?.byPlayer[actorId] ?? {};
      let avoidable = 0;
      let damageTaken = 0;
      for (const [id, d] of Object.entries(byAbility)) {
        damageTaken += d.total;
        if (lookup[Number(id)]?.classification === "avoidable") avoidable += d.total;
      }
      return { pull, deaths: deaths.filter((d) => d.fight === pull.id), avoidable, damageTaken };
    }),
  };
}
