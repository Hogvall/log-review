import {
  type AvoidabilityMap,
  type DamageTakenEvent,
  type PlayerReport,
  type RaidDeath,
  buildPlayerReport,
} from "@log-review/analysis";
import { encounterAbilities, playerFightCache, snapshots } from "@log-review/db";
import {
  ENEMY_SOURCES,
  type Fight,
  type PlayerDetails,
  type ReportOverview,
  getFightEvents,
  getPlayerDetails,
  getReportOverview,
} from "@log-review/wcl";
import { and, desc, eq } from "drizzle-orm";
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

interface CachedPlayerData {
  deaths: RaidDeath[];
  damageTaken: DamageTakenEvent[];
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
  if (cached) return cached.data as CachedPlayerData;

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

export interface PlayerAnalysis {
  report: ReportOverview;
  fight: Fight;
  player: { id: number; name: string; classSlug: string; specKey: string | null };
  analysis: PlayerReport;
  snapshotWeek: string | null;
  abilities: Record<number, { name: string; icon: string }>;
  names: Record<number, string>;
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

  const analysis = buildPlayerReport({
    playerId: actorId,
    fightStartTime: fight.startTime,
    raidSize: fight.friendlyPlayers?.length ?? 20,
    kill: !!fight.kill,
    raidDeaths: data.deaths,
    damageTaken: data.damageTaken,
    avoidability: avoidability.map,
  });

  const abilities: PlayerAnalysis["abilities"] = {};
  for (const a of report.abilities) abilities[a.gameID] = { name: a.name, icon: a.icon };
  const names: Record<number, string> = {};
  for (const p of report.players) names[p.id] = p.name;

  return {
    report,
    fight,
    player: { id: actorId, name: actor.name, classSlug: actor.subType, specKey: detail?.icon ?? null },
    analysis,
    snapshotWeek: avoidability.week,
    abilities,
    names,
  };
}
