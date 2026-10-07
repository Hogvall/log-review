import { EXECUTE_THRESHOLDS, type ExecuteThreshold } from "./defensives";

/** Fight time (ms) at which a boss first dropped to each execute threshold; null if it never did. */
export type ExecuteStarts = Record<`${ExecuteThreshold}`, number | null>;

/** One enemy's health over a fight from WCL's Resources graph: [report time, health %] points. */
export interface HealthSeries {
  name?: string;
  /** "Boss" for the encounter's bosses, "NPC" for adds. */
  type?: string;
  data?: [number, number][];
}

/**
 * When the execute window opened for each threshold: the first moment any boss was at or below it. With
 * several bosses (council fights) an execute works on whichever is low, so the earliest one counts. Adds
 * are ignored unless the log marks no enemy as a boss.
 */
export function executeStarts(series: HealthSeries[], fightStartTime: number, durationMs: number): ExecuteStarts {
  const bosses = series.filter((s) => s.type === "Boss");
  const tracked = bosses.length ? bosses : series;
  const out = {} as ExecuteStarts;
  for (const threshold of EXECUTE_THRESHOLDS) {
    let first: number | null = null;
    for (const s of tracked) {
      const hit = (s.data ?? []).find(([, pct]) => pct <= threshold);
      if (hit) first = Math.min(first ?? Number.POSITIVE_INFINITY, hit[0] - fightStartTime);
    }
    out[threshold] = first == null ? null : Math.max(0, Math.min(durationMs, first));
  }
  return out;
}

/** Casts of an execute while its window was open, per minute of that window. */
export function executeRate(castTimes: number[], startMs: number, untilMs: number): { casts: number; windowMs: number; perMin: number } {
  const windowMs = Math.max(0, untilMs - startMs);
  const casts = castTimes.filter((t) => t >= startMs && t <= untilMs).length;
  return { casts, windowMs, perMin: windowMs ? (casts * 60_000) / windowMs : 0 };
}
