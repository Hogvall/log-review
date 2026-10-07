import {
  type DpsCheck,
  type NightDeath,
  type NightDeaths,
  type SpecBenchmark,
  bestPulls,
  countedPulls,
  dpsCheck,
  nightDeaths,
  roleOf,
  similarLengthAmount,
} from "@log-review/analysis";
import { type AbilityTip, getAbilityTip } from "@log-review/encounters";
import { benchmarks, fights as fightsTable, reportCache } from "@log-review/db";
import { type Fight, type ReportOverview, getEventsForFights, getFightTable, getTableForFights } from "@log-review/wcl";
import { and, desc, eq } from "drizzle-orm";
import { getOverview } from "./data";
import { getDb, getWcl } from "./server";

/** WCL's Deaths table stops at 200 entries, so pulls are fetched in batches below that. */
const DEATHS_PER_BATCH = 190;

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

interface CachedPullDamage {
  pullId: number;
  durationMs: number;
  bossPercentage: number;
  players: { id: number; name: string; classSlug: string; specKey: string; total: number; bossDamage: number }[];
}

/** What a raid night costs to fetch, cached per report: deaths (1 + ~1 per 8 pulls) and the best pulls' damage. */
interface CachedNight {
  deaths: NightDeath[];
  damage: CachedPullDamage[];
}

export interface NightPlayer {
  id: number;
  name: string;
  classSlug: string;
  specKey: string;
  dps: number;
  /** Share of their damage that went to the bosses. */
  bossShare: number;
  /** DPS vs top players of the spec with the closest kill lengths; null for healers or without a benchmark. */
  ratio: number | null;
  reference: number | null;
}

export interface RaidNight {
  report: ReportOverview;
  encounterId: number;
  difficulty: number;
  name: string;
  pulls: (Fight & { pull: number })[];
  /** First kill of the night, if any: then the DPS check doesn't apply. */
  kill: (Fight & { pull: number }) | null;
  deaths: NightDeaths;
  /** Only for bosses not killed in this report. */
  check: DpsCheck | null;
  /** The furthest pull, whose players are listed. */
  bestPull: (Fight & { pull: number }) | null;
  players: NightPlayer[];
  abilities: Record<number, { name: string; icon: string }>;
  tips: Record<number, AbilityTip>;
}

async function fetchNight(code: string, pulls: Fight[], checkDamage: boolean): Promise<CachedNight> {
  const wcl = getWcl();
  const counted = countedPulls(pulls.map((p) => ({ ...p, kill: !!p.kill, raidSize: p.friendlyPlayers?.length ?? 20 })));
  const fights = pulls.filter((p) => counted.some((c) => c.id === p.id));

  // One query for every death of the night, to split the Deaths tables into batches under their 200 cap.
  const deathEvents = await getEventsForFights(wcl, code, fights, "Deaths");
  const perFight = new Map<number, number>();
  for (const e of deathEvents) perFight.set(e.fight, (perFight.get(e.fight) ?? 0) + 1);
  const batches: number[][] = [];
  let batch: number[] = [];
  let size = 0;
  for (const f of fights) {
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

  const damage: CachedPullDamage[] = [];
  if (checkDamage) {
    for (const p of bestPulls(counted)) {
      const table = await getFightTable<{ entries?: DamageDoneEntry[] }>(wcl, code, p.id, "DamageDone");
      damage.push({
        pullId: p.id,
        durationMs: p.endTime - p.startTime,
        bossPercentage: p.bossPercentage ?? 100,
        players: (table.entries ?? []).map((e) => ({
          id: e.id,
          name: e.name,
          classSlug: e.type,
          specKey: e.icon,
          total: e.total,
          bossDamage: (e.targets ?? []).filter((t) => t.type === "Boss").reduce((sum, t) => sum + t.total, 0),
        })),
      });
    }
  }
  return { deaths, damage };
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
async function specBenchmarks(encounterId: number, difficulty: number): Promise<Map<string, SpecBenchmark>> {
  const rows = await getDb()
    .select({ specKey: benchmarks.specKey, data: benchmarks.data })
    .from(benchmarks)
    .where(and(eq(benchmarks.encounterId, encounterId), eq(benchmarks.difficulty, difficulty)))
    .orderBy(desc(benchmarks.snapshotId));
  const out = new Map<string, SpecBenchmark>();
  for (const r of rows) if (!out.has(r.specKey)) out.set(r.specKey, r.data as SpecBenchmark);
  return out;
}

export async function getRaidNight(code: string, encounterId: number, difficulty: number): Promise<RaidNight | null> {
  const report = await getOverview(code);
  const all = report.fights.filter((f) => f.encounterID === encounterId && f.difficulty === difficulty);
  if (!all.length) return null;
  const pulls = all.map((f, i) => ({ ...f, pull: i + 1 }));
  const kill = pulls.find((p) => p.kill) ?? null;

  // Live logs gain pulls, so the cache key includes the last one.
  const key = `night:${encounterId}:${difficulty}:${pulls.at(-1)!.id}`;
  const db = getDb();
  const where = and(eq(reportCache.reportCode, code), eq(reportCache.key, key));
  const [cached] = await db.select({ data: reportCache.data }).from(reportCache).where(where).limit(1);
  let data = cached?.data as CachedNight | undefined;
  if (!data) {
    data = await fetchNight(code, all, !kill);
    await db.insert(reportCache).values({ reportCode: code, key, data }).onConflictDoNothing();
  }

  const nightPulls = all.map((p) => ({
    id: p.id,
    startTime: p.startTime,
    endTime: p.endTime,
    kill: !!p.kill,
    bossPercentage: p.bossPercentage,
    raidSize: p.friendlyPlayers?.length ?? 20,
  }));
  const deaths = nightDeaths(nightPulls, data.deaths);

  let check: DpsCheck | null = null;
  let players: NightPlayer[] = [];
  let bestPull: RaidNight["bestPull"] = null;
  if (!kill && data.damage.length) {
    check = dpsCheck(
      data.damage.map((d) => ({
        pullId: d.pullId,
        durationMs: d.durationMs,
        bossPercentage: d.bossPercentage,
        bossDamage: d.players.reduce((sum, p) => sum + p.bossDamage, 0),
      })),
      await referenceKillTimes(encounterId, difficulty),
    );
    const best = data.damage[0]!;
    bestPull = pulls.find((p) => p.id === best.pullId) ?? null;
    const specs = await specBenchmarks(encounterId, difficulty);
    players = best.players
      .map((p) => {
        const dps = (p.total * 1000) / best.durationMs;
        const bench = specs.get(p.specKey);
        // Healers are ranked by healing, so their DPS isn't compared.
        const reference =
          bench && roleOf(p.specKey) !== "healer" ? (similarLengthAmount(bench.amountPoints, best.durationMs)?.median ?? bench.amount.median) : null;
        return {
          id: p.id,
          name: p.name,
          classSlug: p.classSlug,
          specKey: p.specKey,
          dps,
          bossShare: p.total ? p.bossDamage / p.total : 0,
          ratio: reference ? dps / reference : null,
          reference,
        };
      })
      .sort((a, b) => b.dps - a.dps);
  }

  const abilities: RaidNight["abilities"] = {};
  for (const a of report.abilities) abilities[a.gameID] = { name: a.name, icon: a.icon };
  const tips: Record<number, AbilityTip> = {};
  for (const c of deaths.causes) {
    const tip = getAbilityTip(encounterId, c.name);
    if (tip) tips[c.abilityId] = tip;
  }

  return { report, encounterId, difficulty, name: all[0]!.name, pulls, kill, deaths, check, bestPull, players, abilities, tips };
}
