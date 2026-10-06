/** Linear-interpolated quantile (q in 0..1) of an unsorted list. Returns NaN for an empty list. */
export function quantile(values: number[], q: number): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function median(values: number[]): number {
  return quantile(values, 0.5);
}

export interface Summary {
  median: number;
  p25: number;
  p75: number;
  n: number;
}

export function summarize(values: number[]): Summary {
  return { median: median(values), p25: quantile(values, 0.25), p75: quantile(values, 0.75), n: values.length };
}

export interface KeyedSummary extends Summary {
  /** Share of players that had a non-zero value for this key. */
  usedBy: number;
}

/**
 * Summarizes per-player maps (e.g. ability ID → casts per minute) into one summary per key.
 * Players without a key count as 0, so medians reflect the whole cohort. Keys used by fewer
 * than `minUsedBy` of the players are dropped as noise (trinkets, one-off talents).
 */
export function summarizeMaps(maps: Record<string, number>[], minUsedBy = 0.5): Record<string, KeyedSummary> {
  const keys = new Set(maps.flatMap((m) => Object.keys(m)));
  const out: Record<string, KeyedSummary> = {};
  for (const key of keys) {
    const values = maps.map((m) => m[key] ?? 0);
    const usedBy = values.filter((v) => v > 0).length / maps.length;
    if (usedBy < minUsedBy) continue;
    out[key] = { ...summarize(values), usedBy };
  }
  return out;
}
