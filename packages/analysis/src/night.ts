/**
 * A raid leader's view of a whole night on one boss: what people die to across all pulls, and, for a boss
 * the raid hasn't killed, whether its damage is enough to kill it.
 */
import { classifyDeaths } from "./deaths";
import { summarize } from "./stats";

/** Pulls shorter than this are resets, not attempts. */
export const MIN_PULL_MS = 30_000;

export interface NightPull {
  id: number;
  /** Report-relative. */
  startTime: number;
  endTime: number;
  kill: boolean;
  /** Boss health left when the pull ended (0 on kills). */
  bossPercentage: number | null;
  raidSize: number;
}

/** One death from WCL's Deaths table: who, when, and what hit them in the seconds before. */
export interface NightDeath {
  fight: number;
  /** Report-relative. */
  timestamp: number;
  playerId: number;
  name: string;
  killingBlow: { id: number; name: string } | null;
  /** Damage taken by ability over the death window (~6s), biggest first or not. */
  window: { id: number; name: string; total: number }[];
}

export interface DeathCause {
  abilityId: number;
  name: string;
  /** Deaths before the wipe or among its first deaths: the ones that matter. */
  mattered: number;
  /** All deaths to it, including during and after the wipe. */
  all: number;
  /** Pulls with at least one death that mattered. */
  pulls: number;
  /** Who died to it (deaths that mattered), most first. */
  players: { playerId: number; name: string; count: number; lastFight: number }[];
  /** The ability that most often did the second-most damage in these deaths, e.g. a paired mechanic. */
  often: { abilityId: number; name: string; count: number } | null;
  /** Deaths that mattered per pull in the first and second half of the night's pulls. */
  firstHalfRate: number;
  secondHalfRate: number;
}

export interface NightDeaths {
  pullsCounted: number;
  /** Pulls skipped as resets (under MIN_PULL_MS). */
  resets: number;
  mattered: number;
  total: number;
  causes: DeathCause[];
  /** Median fight time of the first death that mattered, over pulls that had one. */
  firstDeathMedianMs: number | null;
}

/**
 * What actually killed someone: the ability that did the most damage in their death window. The killing
 * blow is often a small tick after the real damage, so it's only the fallback.
 */
export function deathCause(d: NightDeath): { id: number; name: string } | null {
  // Add up abilities that share a name (several IDs) before picking the biggest.
  const byName = new Map<string, { id: number; name: string; total: number }>();
  for (const a of d.window) {
    const seen = byName.get(a.name);
    if (seen) seen.total += a.total;
    else byName.set(a.name, { ...a });
  }
  const top = [...byName.values()].sort((a, b) => b.total - a.total)[0];
  return top ? { id: top.id, name: top.name } : d.killingBlow;
}

export const countedPulls = (pulls: NightPull[]) => pulls.filter((p) => p.endTime - p.startTime >= MIN_PULL_MS);

export function nightDeaths(allPulls: NightPull[], deaths: NightDeath[]): NightDeaths {
  const pulls = countedPulls(allPulls).sort((a, b) => a.startTime - b.startTime);
  const half = Math.ceil(pulls.length / 2);
  const firstHalf = new Set(pulls.slice(0, half).map((p) => p.id));
  const secondHalfCount = pulls.length - half;

  // Keyed by name: some spells log under several IDs (e.g. Cultivated Burst), which would split one cause in two.
  const causes = new Map<string, DeathCause & { pullIds: Set<number>; firstHalfN: number; secondHalfN: number; oftenCounts: Map<number, { name: string; count: number }> }>();
  const firstDeaths: number[] = [];
  let mattered = 0;
  let total = 0;

  for (const pull of pulls) {
    const own = deaths.filter((d) => d.fight === pull.id);
    const { deaths: classified } = classifyDeaths(
      own.map((d) => ({ timestamp: d.timestamp, targetID: d.playerId })),
      { fightStartTime: pull.startTime, raidSize: pull.raidSize, kill: pull.kill },
    );
    let firstMattered: number | null = null;
    for (const c of classified) {
      const d = own.find((x) => x.timestamp === c.timestamp && x.playerId === c.targetID)!;
      const cause = deathCause(d);
      total++;
      if (!cause) continue;
      const matters = c.category === "early" || c.category === "wipe-start";
      const entry =
        causes.get(cause.name) ??
        { abilityId: cause.id, name: cause.name, mattered: 0, all: 0, pulls: 0, players: [] as DeathCause["players"], often: null, firstHalfRate: 0, secondHalfRate: 0, pullIds: new Set<number>(), firstHalfN: 0, secondHalfN: 0, oftenCounts: new Map() };
      entry.all++;
      if (matters) {
        mattered++;
        entry.mattered++;
        entry.pullIds.add(pull.id);
        if (firstHalf.has(pull.id)) entry.firstHalfN++;
        else entry.secondHalfN++;
        const p = entry.players.find((x) => x.playerId === d.playerId);
        if (p) {
          p.count++;
          p.lastFight = pull.id;
        } else entry.players.push({ playerId: d.playerId, name: d.name, count: 1, lastFight: pull.id });
        const second = [...d.window].sort((a, b) => b.total - a.total).find((a) => a.name !== cause.name);
        if (second) {
          const o = entry.oftenCounts.get(second.id) ?? { name: second.name, count: 0 };
          o.count++;
          entry.oftenCounts.set(second.id, o);
        }
        firstMattered ??= c.fightTimeMs;
      }
      causes.set(cause.name, entry);
    }
    if (firstMattered != null) firstDeaths.push(firstMattered);
  }

  const list = [...causes.values()]
    .map(({ pullIds, firstHalfN, secondHalfN, oftenCounts, ...c }) => {
      const often = [...oftenCounts].sort((a, b) => b[1].count - a[1].count)[0];
      return {
        ...c,
        pulls: pullIds.size,
        players: c.players.sort((a, b) => b.count - a.count),
        // Only call it a pairing when it shows up in at least a third of these deaths.
        often: often && often[1].count >= Math.max(2, c.mattered / 3) ? { abilityId: often[0], ...often[1] } : null,
        firstHalfRate: half ? firstHalfN / half : 0,
        secondHalfRate: secondHalfCount ? secondHalfN / secondHalfCount : 0,
      };
    })
    .sort((a, b) => b.mattered - a.mattered || b.all - a.all);

  return {
    pullsCounted: pulls.length,
    resets: allPulls.length - pulls.length,
    mattered,
    total,
    causes: list,
    firstDeathMedianMs: firstDeaths.length ? summarize(firstDeaths).median : null,
  };
}

/** Damage in one pull, from WCL's all-players DamageDone table. */
export interface PullDamage {
  pullId: number;
  durationMs: number;
  bossPercentage: number;
  /** All players' damage to enemies the log marks as bosses (adds excluded). */
  bossDamage: number;
}

export type DpsVerdict = "enough" | "close" | "short" | "unknown";

export interface DpsCheck {
  /** Estimated boss health (all bosses together on council fights). */
  bossHealth: number | null;
  pulls: (PullDamage & { bossDps: number; projectedKillMs: number | null })[];
  /** Median projected kill time over the pulls checked. */
  projectedKillMs: number | null;
  /** Kill times of raids that killed it (from the kills we've downloaded). */
  reference: { median: number; p75: number; n: number } | null;
  verdict: DpsVerdict;
  /** How much more boss damage per second a kill at the reference pace needs (0.13 = 13%), when short. */
  neededIncrease: number | null;
}

/** Below this many reference kills, the kill-time bar isn't trustworthy. */
const MIN_REFERENCE_KILLS = 10;
/** Projected within this much of the bar counts as "close". */
const CLOSE_MARGIN = 0.1;

/**
 * Is the raid's damage enough? Estimates the boss's health from how much damage took off how much health,
 * projects when each checked pull would have killed it at its damage rate, and compares that with how long
 * kills of this boss take. The bar is the slower quarter of kills (75th percentile): what raids that kill
 * it manage, not the world's fastest.
 */
export function dpsCheck(pulls: PullDamage[], referenceKillMs: number[]): DpsCheck {
  const healthEstimates = pulls
    .filter((p) => p.bossPercentage < 95 && p.bossDamage > 0)
    .map((p) => p.bossDamage / ((100 - p.bossPercentage) / 100));
  const bossHealth = healthEstimates.length ? summarize(healthEstimates).median : null;
  const rows = pulls.map((p) => {
    const bossDps = p.durationMs ? (p.bossDamage * 1000) / p.durationMs : 0;
    return { ...p, bossDps, projectedKillMs: bossHealth && bossDps ? (bossHealth / bossDps) * 1000 : null };
  });
  const projections = rows.flatMap((r) => (r.projectedKillMs ? [r.projectedKillMs] : []));
  const projectedKillMs = projections.length ? summarize(projections).median : null;
  const ref = referenceKillMs.length >= MIN_REFERENCE_KILLS ? summarize(referenceKillMs) : null;
  const reference = ref ? { median: ref.median, p75: ref.p75, n: ref.n } : null;

  let verdict: DpsVerdict = "unknown";
  let neededIncrease: number | null = null;
  if (projectedKillMs && reference) {
    if (projectedKillMs <= reference.p75) verdict = "enough";
    else {
      neededIncrease = projectedKillMs / reference.p75 - 1;
      verdict = neededIncrease <= CLOSE_MARGIN ? "close" : "short";
    }
  }
  return { bossHealth, pulls: rows, projectedKillMs, reference, verdict, neededIncrease };
}

/** The pulls to check damage on: the furthest ones (lowest boss health), skipping resets. */
export function bestPulls(pulls: NightPull[], n = 3): NightPull[] {
  return countedPulls(pulls)
    .filter((p) => p.bossPercentage != null)
    .sort((a, b) => (a.bossPercentage ?? 100) - (b.bossPercentage ?? 100))
    .slice(0, n);
}
