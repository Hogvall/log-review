/**
 * The fight over time instead of whole-fight averages: what the player hardcast before the pull, their
 * opener, and how active they were in each boss phase, compared with the #1 player of their spec.
 */

/** [fight time in ms, ability ID] for each completed cast. */
export type CastMark = [number, number];

/** A WCL Casts event reduced to what we need; `type` is "begincast" or "cast". */
export interface CastLogEvent {
  fightTimeMs: number;
  type: string;
  abilityId: number;
}

/** A cast landing this soon after the pull without a begincast was started before the pull. */
const PRECAST_WINDOW_MS = 1500;
/** Begincast-to-cast time that marks a spell with a real cast time (instants log both at once). */
const MIN_CAST_TIME_MS = 400;

/**
 * Spells hardcast before the pull. WCL logs nothing before the pull starts, so a precast shows up as a
 * cast in the first moment of the fight with no begincast, for a spell that has a cast time elsewhere.
 */
export function findPrecasts(events: CastLogEvent[]): number[] {
  const hasCastTime = new Set<number>();
  const begun = new Map<number, number>();
  for (const e of events) {
    if (e.type === "begincast") begun.set(e.abilityId, e.fightTimeMs);
    else if (e.type === "cast") {
      const start = begun.get(e.abilityId);
      if (start != null && e.fightTimeMs - start >= MIN_CAST_TIME_MS) hasCastTime.add(e.abilityId);
      begun.delete(e.abilityId);
    }
  }
  const precasts: number[] = [];
  const seenBegin = new Set<number>();
  for (const e of events) {
    if (e.fightTimeMs > PRECAST_WINDOW_MS) break;
    if (e.type === "begincast") seenBegin.add(e.abilityId);
    else if (e.type === "cast" && !seenBegin.has(e.abilityId) && hasCastTime.has(e.abilityId) && !precasts.includes(e.abilityId)) {
      precasts.push(e.abilityId);
    }
  }
  return precasts;
}

export interface PhaseSpan {
  /** Phase ID from the log; repeated phases share it. Minute windows use their index. */
  id: number;
  name: string;
  intermission: boolean;
  startMs: number;
  endMs: number;
}

/** Fight-relative phase spans from WCL's phase transitions, or [] when the boss has none. */
export function phaseSpans(
  transitions: { id: number; startTime: number }[] | null | undefined,
  fightStartTime: number,
  durationMs: number,
  names: { id: number; name: string; isIntermission?: boolean | null }[] = [],
): PhaseSpan[] {
  if (!transitions?.length) return [];
  const sorted = [...transitions].sort((a, b) => a.startTime - b.startTime);
  return sorted
    .map((t, i) => {
      const meta = names.find((n) => n.id === t.id);
      const next = sorted[i + 1];
      return {
        id: t.id,
        name: meta?.name ?? `Phase ${t.id}`,
        intermission: !!meta?.isIntermission,
        startMs: Math.max(0, t.startTime - fightStartTime),
        endMs: Math.min(durationMs, next ? next.startTime - fightStartTime : durationMs),
      };
    })
    .filter((s) => s.endMs > s.startMs);
}

/** One-minute windows, for bosses without phases. */
export function minuteSpans(durationMs: number): PhaseSpan[] {
  const spans: PhaseSpan[] = [];
  for (let start = 0, i = 0; start < durationMs; start += 60_000, i++) {
    spans.push({ id: i, name: `Minute ${i + 1}`, intermission: false, startMs: start, endMs: Math.min(durationMs, start + 60_000) });
  }
  return spans;
}

export interface Gap {
  startMs: number;
  endMs: number;
}

/** No cast for this long while alive counts as idle (long enough to cover any normal cast or channel). */
export const IDLE_GAP_MS = 4000;

/** Stretches of at least `minGapMs` without a completed cast, from the pull until `untilMs`. */
export function castGaps(casts: CastMark[], untilMs: number, minGapMs = IDLE_GAP_MS): Gap[] {
  const gaps: Gap[] = [];
  let prev = 0;
  for (const t of casts.map(([t]) => t).filter((t) => t <= untilMs).sort((a, b) => a - b)) {
    if (t - prev >= minGapMs) gaps.push({ startMs: prev, endMs: t });
    prev = t;
  }
  if (untilMs - prev >= minGapMs) gaps.push({ startMs: prev, endMs: untilMs });
  return gaps;
}

const overlap = (g: Gap, start: number, end: number) => Math.max(0, Math.min(g.endMs, end) - Math.max(g.startMs, start));

export interface Activity {
  /** Time in the phase (while alive, for the viewer). */
  durationMs: number;
  casts: number;
  idleMs: number;
}

export interface PhaseActivity {
  id: number;
  name: string;
  intermission: boolean;
  /** null when the player was dead for the whole phase. */
  you: Activity | null;
  /** null when we couldn't read the #1 player's phases. */
  top: Activity | null;
}

/** Activity per phase ID, merging repeats of the same phase. */
function activityByPhase(spans: PhaseSpan[], casts: CastMark[], gaps: Gap[], untilMs: number): Map<number, Activity> {
  const out = new Map<number, Activity>();
  for (const s of spans) {
    const end = Math.min(s.endMs, untilMs);
    if (end <= s.startMs) continue;
    const a = out.get(s.id) ?? { durationMs: 0, casts: 0, idleMs: 0 };
    a.durationMs += end - s.startMs;
    a.casts += casts.filter(([t]) => t >= s.startMs && t < end).length;
    a.idleMs += gaps.reduce((sum, g) => sum + overlap(g, s.startMs, end), 0);
    out.set(s.id, a);
  }
  return out;
}

export interface FirstUse {
  abilityId: number;
  player: number | null;
  top: number | null;
}

export type TimelineFinding =
  | { kind: "late-cooldown"; abilityId: number; playerMs: number; topMs: number }
  | { kind: "idle-time"; playerMs: number; topMs: number; longest: Gap[]; estDpsGain: number | null };

export interface TimelineInput {
  casts: CastMark[];
  precasts: number[];
  durationMs: number;
  /** Until the player's death, if they died. */
  aliveMs: number;
  /** DPS, or null for healers. */
  amount: number | null;
  phases: PhaseSpan[];
  top: { casts: CastMark[]; durationMs: number; phases: PhaseSpan[] } | null;
  /** Abilities whose first use in the opener we compare (the spec's cooldowns). */
  cooldownIds: number[];
  /** Abilities that count as the same thing for first use, e.g. different combat potions. */
  equivalent?: number[][];
}

export interface TimelineReview {
  precasts: number[];
  opener: { windowMs: number; you: CastMark[]; top: CastMark[] | null; firstUses: FirstUse[] };
  /** True when rows are the boss's phases, false for one-minute windows. */
  byPhase: boolean;
  phases: PhaseActivity[];
  /** The player's idle stretches, in order. */
  gaps: Gap[];
  idleMs: number;
  /** The #1 player's idle time, scaled to your time alive so different kill lengths compare. */
  topIdleMs: number | null;
  findings: TimelineFinding[];
}

export const OPENER_MS = 30_000;
/** How much later than #1 a cooldown they press in the opener has to come before we call it out. */
const LATE_COOLDOWN_MS = 8_000;
/** Extra idle time over #1 worth a finding: at least this long and this share of your time alive. */
const IDLE_EXTRA_MS = 10_000;
const IDLE_EXTRA_SHARE = 0.04;

const firstUse = (casts: CastMark[], ids: number[]) => casts.find(([, a]) => ids.includes(a))?.[0] ?? null;

export function reviewTimeline(input: TimelineInput): TimelineReview {
  const { casts, aliveMs, top } = input;
  const sorted = [...casts].sort((a, b) => a[0] - b[0]);
  const topSorted = top ? [...top.casts].sort((a, b) => a[0] - b[0]) : null;

  const firstUses: FirstUse[] = [];
  const counted = new Set<number>();
  for (const id of input.cooldownIds) {
    if (counted.has(id)) continue;
    const group = input.equivalent?.find((g) => g.includes(id)) ?? [id];
    for (const g of group) counted.add(g);
    firstUses.push({ abilityId: id, player: firstUse(sorted, group), top: topSorted ? firstUse(topSorted, group) : null });
  }

  const gaps = castGaps(sorted, aliveMs);
  const idleMs = gaps.reduce((s, g) => s + g.endMs - g.startMs, 0);
  const topGaps = topSorted && top ? castGaps(topSorted, top.durationMs) : null;
  const topIdleRaw = topGaps?.reduce((s, g) => s + g.endMs - g.startMs, 0) ?? null;
  const topIdleMs = topIdleRaw != null && top ? (topIdleRaw * aliveMs) / top.durationMs : null;

  // Phases when the boss has them (both fights are the same boss); otherwise minute windows for both.
  const byPhase = input.phases.length > 0;
  const spans = byPhase ? input.phases : minuteSpans(input.durationMs);
  const topSpans = top ? (byPhase ? top.phases : minuteSpans(top.durationMs)) : [];
  const yours = activityByPhase(spans, sorted, gaps, aliveMs);
  const theirs = topSorted && topGaps && top ? activityByPhase(topSpans, topSorted, topGaps, top.durationMs) : new Map<number, Activity>();
  const seen = new Set<number>();
  const phases: PhaseActivity[] = [];
  for (const s of spans) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    phases.push({ id: s.id, name: s.name, intermission: s.intermission, you: yours.get(s.id) ?? null, top: theirs.get(s.id) ?? null });
  }

  const findings: TimelineFinding[] = [];
  for (const f of firstUses) {
    if (f.top == null || f.player == null || f.top > OPENER_MS) continue;
    if (f.player - f.top >= LATE_COOLDOWN_MS && f.top < aliveMs) {
      findings.push({ kind: "late-cooldown", abilityId: f.abilityId, playerMs: f.player, topMs: f.top });
    }
  }
  if (topIdleMs != null) {
    const extra = idleMs - topIdleMs;
    if (extra >= IDLE_EXTRA_MS && extra >= aliveMs * IDLE_EXTRA_SHARE) {
      const busyMs = aliveMs - idleMs;
      findings.push({
        kind: "idle-time",
        playerMs: idleMs,
        topMs: topIdleMs,
        longest: [...gaps].sort((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs)).slice(0, 3),
        estDpsGain: input.amount && busyMs > 0 ? (input.amount * extra) / busyMs : null,
      });
    }
  }

  return {
    precasts: input.precasts,
    opener: {
      windowMs: OPENER_MS,
      you: sorted.filter(([t]) => t <= OPENER_MS),
      top: topSorted ? topSorted.filter(([t]) => t <= OPENER_MS) : null,
      firstUses,
    },
    byPhase,
    phases,
    gaps,
    idleMs,
    topIdleMs,
    findings,
  };
}
