import type { PlayerMetrics } from "./fight-metrics";
import { type KeyedSummary, type Summary, summarize, summarizeMaps } from "./stats";

/** One ranked player with their fight metrics, as input to a spec benchmark. */
export interface CohortMember {
  amount: number;
  itemLevel: number | null;
  metrics: PlayerMetrics;
  buffUptime: Record<string, number> | null;
}

export interface SpecBenchmark {
  sampleSize: number;
  /** True when there are too few players to compare against meaningfully. */
  insufficient: boolean;
  amount: Summary;
  durationMs: Summary;
  itemLevel: Summary;
  activeTimePct: Summary;
  cpm: Record<string, KeyedSummary>;
  buffUptime: Record<string, KeyedSummary>;
  dtps: Record<string, KeyedSummary>;
  targetShare: Record<string, KeyedSummary>;
  /** Share of the cohort that died at least once. */
  deathRate: number;
}

export const MIN_SAMPLE = 5;

/** Median-based benchmark for one spec on one boss and difficulty. */
export function specBenchmark(cohort: CohortMember[], minSample = MIN_SAMPLE): SpecBenchmark {
  const withBuffs = cohort.filter((c) => c.buffUptime);
  return {
    sampleSize: cohort.length,
    insufficient: cohort.length < minSample,
    amount: summarize(cohort.map((c) => c.amount)),
    durationMs: summarize(cohort.map((c) => c.metrics.durationMs)),
    itemLevel: summarize(cohort.flatMap((c) => (c.itemLevel ? [c.itemLevel] : []))),
    activeTimePct: summarize(cohort.map((c) => c.metrics.activeTimePct)),
    cpm: summarizeMaps(cohort.map((c) => c.metrics.cpm)),
    buffUptime: summarizeMaps(withBuffs.map((c) => c.buffUptime!)),
    // Damage taken keeps rarer abilities: one player eating a mechanic is exactly what we want to see.
    dtps: summarizeMaps(cohort.map((c) => c.metrics.dtps), 0),
    targetShare: summarizeMaps(cohort.map((c) => c.metrics.targetShare)),
    deathRate: cohort.length ? cohort.filter((c) => c.metrics.deaths > 0).length / cohort.length : 0,
  };
}

export type Avoidability = "avoidable" | "situational" | "unavoidable";

export interface AbilityAvoidability {
  /** Share of players that took no damage from this ability. */
  zeroShare: number;
  /** Median damage per second among the players that did take it. */
  medianDtpsWhenHit: number;
  sampleSize: number;
  classification: Avoidability;
}

export const AVOIDABLE_ZERO_SHARE = 0.85;
export const UNAVOIDABLE_ZERO_SHARE = 0.1;

export function classifyAvoidability(zeroShare: number): Avoidability {
  if (zeroShare >= AVOIDABLE_ZERO_SHARE) return "avoidable";
  if (zeroShare <= UNAVOIDABLE_ZERO_SHARE) return "unavoidable";
  return "situational";
}

/**
 * Data-driven avoidability for every boss ability, from many players' damage taken.
 * Pass non-tank players only: tanks take hits on purpose.
 */
export function encounterAvoidability(players: PlayerMetrics[]): Record<string, AbilityAvoidability> {
  const abilities = new Set(players.flatMap((p) => Object.keys(p.dtps)));
  const out: Record<string, AbilityAvoidability> = {};
  for (const id of abilities) {
    const hit = players.map((p) => p.dtps[id] ?? 0).filter((v) => v > 0);
    if (!hit.length) continue; // only zero-damage events (immunes, misses): nothing to avoid
    const zeroShare = 1 - hit.length / players.length;
    out[id] = {
      zeroShare,
      medianDtpsWhenHit: summarize(hit).median,
      sampleSize: players.length,
      classification: classifyAvoidability(zeroShare),
    };
  }
  return out;
}
