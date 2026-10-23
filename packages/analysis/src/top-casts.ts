/**
 * Your casts next to several top players' casts: the opener step by step, and when and how often
 * combat potions are drunk.
 */
import { type Summary, summarize } from "./stats";
import type { CastMark } from "./timeline";

/** One top player's whole-fight casts. */
export interface TopTimeline {
  rank: number;
  name: string;
  durationMs: number;
  casts: CastMark[];
}

export interface OpenerStep {
  /** 1-based position among the counted casts. */
  step: number;
  you: CastMark | null;
  /** The ability top players most often cast at this step, and the share of them who did. */
  common: { abilityId: number; share: number } | null;
  top1: CastMark | null;
  /** Your cast is the common one (or one at least a quarter of top players cast here). */
  match: boolean | null;
}

/** Below this share, a top player's choice at a step is a variation, not "the" opener. */
const ALSO_FINE_SHARE = 0.25;

/**
 * The opener as a sequence: the first `steps` casts within `windowMs`, skipping `ignore` (movement,
 * defensives, utility), lined up by position with what top players cast at the same position.
 */
export function openerSteps(
  you: CastMark[],
  tops: TopTimeline[],
  opts: { windowMs: number; steps: number; ignore: Set<number> },
): OpenerStep[] {
  const seq = (casts: CastMark[]) =>
    [...casts]
      .sort((a, b) => a[0] - b[0])
      .filter(([t, id]) => t <= opts.windowMs && !opts.ignore.has(id))
      .slice(0, opts.steps);
  const mine = seq(you);
  const theirs = tops.map((t) => seq(t.casts));
  const top1 = theirs[0] ?? [];
  const length = Math.max(mine.length, ...theirs.map((s) => s.length), 0);
  const out: OpenerStep[] = [];
  for (let i = 0; i < length; i++) {
    const counts = new Map<number, number>();
    let n = 0;
    for (const s of theirs) {
      const c = s[i];
      if (!c) continue;
      n++;
      counts.set(c[1], (counts.get(c[1]) ?? 0) + 1);
    }
    const best = [...counts].sort((a, b) => b[1] - a[1])[0];
    const common = best && n ? { abilityId: best[0], share: best[1] / tops.length } : null;
    const yours = mine[i] ?? null;
    const shareOf = (id: number) => (tops.length ? (counts.get(id) ?? 0) / tops.length : 0);
    out.push({
      step: i + 1,
      you: yours,
      common,
      top1: top1[i] ?? null,
      match: yours && common ? yours[1] === common.abilityId || shareOf(yours[1]) >= ALSO_FINE_SHARE : null,
    });
  }
  return out;
}

export interface TopPotionUse {
  /** Top players compared (those with a cast timeline). */
  players: number;
  /** Share who drank at least one / at least two combat potions. */
  usedAny: number;
  usedTwo: number;
  /** Fight time of the first and second potion, among those who drank them. */
  first: Summary | null;
  second: Summary | null;
  /** The potion most top players drank, and the share of top players who drank it. */
  mostCommon: { abilityId: number; share: number } | null;
  /** Each top player's potions, best rank first. */
  rows: { rank: number; name: string; durationMs: number; uses: CastMark[] }[];
}

export const potionUses = (casts: CastMark[], potionIds: Set<number>): CastMark[] =>
  [...casts].filter(([, id]) => potionIds.has(id)).sort((a, b) => a[0] - b[0]);

/** How top players use combat potions: how many, which and when. */
export function topPotionUse(tops: TopTimeline[], potionIds: Set<number>): TopPotionUse {
  const rows = [...tops].sort((a, b) => a.rank - b.rank).map((t) => ({ rank: t.rank, name: t.name, durationMs: t.durationMs, uses: potionUses(t.casts, potionIds) }));
  const firsts = rows.flatMap((r) => (r.uses[0] ? [r.uses[0][0]] : []));
  const seconds = rows.flatMap((r) => (r.uses[1] ? [r.uses[1][0]] : []));
  const drank = new Map<number, number>();
  for (const r of rows) for (const id of new Set(r.uses.map(([, id]) => id))) drank.set(id, (drank.get(id) ?? 0) + 1);
  const best = [...drank].sort((a, b) => b[1] - a[1])[0];
  const n = rows.length;
  return {
    players: n,
    usedAny: n ? firsts.length / n : 0,
    usedTwo: n ? seconds.length / n : 0,
    first: firsts.length ? summarize(firsts) : null,
    second: seconds.length ? summarize(seconds) : null,
    mostCommon: best && n ? { abilityId: best[0], share: best[1] / n } : null,
    rows,
  };
}
