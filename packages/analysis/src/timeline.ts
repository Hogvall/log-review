import { type KeyedSummary, type Summary, summarize } from "./stats";

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

/** Activity per phase ID, merging repeats of the same phase. */
export function activityByPhase(spans: PhaseSpan[], casts: CastMark[], gaps: Gap[], untilMs: number): Map<number, Activity> {
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

export const activityCpm = (a: Activity) => (a.durationMs ? (a.casts * 60_000) / a.durationMs : 0);
export const activityIdleShare = (a: Activity) => (a.durationMs ? a.idleMs / a.durationMs : 0);

/** The key the combat potion is benchmarked under: players drink different ones. */
export const POTION_KEY = "potion";

/** One top player's timeline, as input to the spec's timeline benchmark. */
export interface TimelineMember {
  casts: CastMark[];
  precasts: number[];
  durationMs: number;
  /** Boss phases in their fight ([] if the boss has none). */
  phases: PhaseSpan[];
}

/** What top players of a spec do over time: medians of first uses, precasts and activity per phase. */
export interface TimelineBenchmark {
  sampleSize: number;
  /** Fight time of the first cast, among players who cast it; `usedBy` is the share who did. Keyed by ability ID or POTION_KEY. */
  firstUse: Record<string, KeyedSummary>;
  /** Share of top players with a precast, and the most common precast spell. */
  precast: { share: number; abilityId: number | null };
  /** Per phase ID (minute index for bosses without phases): casts per minute and idle share. */
  phases: Record<string, { cpm: Summary; idleShare: Summary }>;
  /** Idle share of the whole fight. */
  idleShare: Summary;
}

/** Below this many players with timelines, a timeline benchmark isn't worth comparing against. */
export const MIN_TIMELINE_SAMPLE = 3;

export function timelineBenchmark(members: TimelineMember[], cooldownIds: number[], potionIds: Set<number>): TimelineBenchmark | null {
  if (members.length < MIN_TIMELINE_SAMPLE) return null;
  const sortedMembers = members.map((m) => ({ ...m, casts: [...m.casts].sort((a, b) => a[0] - b[0]) }));

  const firstUse: Record<string, KeyedSummary> = {};
  const keys: [string, number[]][] = [...cooldownIds.filter((id) => !potionIds.has(id)).map((id) => [String(id), [id]] as [string, number[]])];
  if (potionIds.size) keys.push([POTION_KEY, [...potionIds]]);
  for (const [key, ids] of keys) {
    const times = sortedMembers.flatMap((m) => {
      const t = m.casts.find(([, a]) => ids.includes(a))?.[0];
      return t == null ? [] : [t];
    });
    if (times.length) firstUse[key] = { ...summarize(times), usedBy: times.length / members.length };
  }

  const precastCounts = new Map<number, number>();
  for (const m of members) for (const id of m.precasts) precastCounts.set(id, (precastCounts.get(id) ?? 0) + 1);
  const commonPrecast = [...precastCounts].sort((a, b) => b[1] - a[1])[0];

  const perPhase = new Map<number, { cpm: number[]; idle: number[] }>();
  const idle: number[] = [];
  for (const m of sortedMembers) {
    const gaps = castGaps(m.casts, m.durationMs);
    idle.push(gaps.reduce((sum, g) => sum + g.endMs - g.startMs, 0) / m.durationMs);
    const spans = m.phases.length ? m.phases : minuteSpans(m.durationMs);
    for (const [id, a] of activityByPhase(spans, m.casts, gaps, m.durationMs)) {
      const row = perPhase.get(id) ?? { cpm: [], idle: [] };
      row.cpm.push(activityCpm(a));
      row.idle.push(activityIdleShare(a));
      perPhase.set(id, row);
    }
  }
  const phases: TimelineBenchmark["phases"] = {};
  // A phase only some top players reached (e.g. a skipped intermission) still gets a row if enough did.
  for (const [id, row] of perPhase) if (row.cpm.length >= MIN_TIMELINE_SAMPLE) phases[id] = { cpm: summarize(row.cpm), idleShare: summarize(row.idle) };

  return {
    sampleSize: members.length,
    firstUse,
    precast: {
      share: members.filter((m) => m.precasts.length).length / members.length,
      abilityId: commonPrecast?.[0] ?? null,
    },
    phases,
    idleShare: summarize(idle),
  };
}

export interface PhaseActivity {
  id: number;
  name: string;
  intermission: boolean;
  /** null when the player was dead for the whole phase. */
  you: Activity | null;
  /** The #1 player; null when we couldn't read their phases. */
  top: Activity | null;
  /** Top players' medians, when the benchmark has this phase. */
  median: { cpm: Summary; idleShare: Summary } | null;
}

export interface FirstUse {
  abilityId: number;
  player: number | null;
  /** The #1 player's first use. */
  top: number | null;
  /** Top players' first use (among those who used it). */
  median: KeyedSummary | null;
}

/** What a timeline finding compares against: top players' median, or only the #1 player when there's no median yet. */
export type TimelineBasis = "median" | "top1";

export type TimelineFinding =
  | { kind: "late-cooldown"; abilityId: number; playerMs: number; topMs: number; basis: TimelineBasis }
  | { kind: "idle-time"; playerMs: number; topMs: number; basis: TimelineBasis; longest: Gap[]; estDpsGain: number | null };

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
  /** Top players' timeline medians, when the snapshot has them. */
  benchmark?: TimelineBenchmark | null;
  /** Abilities whose first use in the opener we compare (the spec's cooldowns). */
  cooldownIds: number[];
  /** Combat potions seen in either log; they count as one thing for first use. */
  potionIds?: number[];
}

export interface TimelineReview {
  precasts: number[];
  /** How many top players precast, and what. */
  topPrecast: TimelineBenchmark["precast"] | null;
  opener: { windowMs: number; you: CastMark[]; top: CastMark[] | null; firstUses: FirstUse[] };
  /** True when rows are the boss's phases, false for one-minute windows. */
  byPhase: boolean;
  phases: PhaseActivity[];
  /** The player's idle stretches, in order, with the phase each mostly falls in. */
  gaps: (Gap & { phase: string | null })[];
  idleMs: number;
  /** Idle time expected from the #1 player's idle share in each phase, over your time in that phase. */
  topIdleMs: number | null;
  /** Idle time expected from top players' median idle share in each phase, over your time in that phase. */
  medianIdleMs: number | null;
  /** Players in the timeline benchmark (0 when comparing with #1 only). */
  sampleSize: number;
  findings: TimelineFinding[];
}

export const OPENER_MS = 30_000;
/** How much later than top players a cooldown they press in the opener has to come before we call it out. */
const LATE_COOLDOWN_MS = 8_000;
/** Share of top players that must use a cooldown in the opener before a late one is a finding. */
const OPENER_USED_BY = 0.5;
/** Extra idle time over top players worth a finding: at least this long and this share of your time alive. */
const IDLE_EXTRA_MS = 10_000;
const IDLE_EXTRA_SHARE = 0.04;

/** The phase a stretch mostly falls in (a gap often starts just before a phase change). */
function dominantPhase(g: Gap, spans: PhaseSpan[]): string | null {
  const totals = new Map<string, number>();
  for (const s of spans) totals.set(s.name, (totals.get(s.name) ?? 0) + overlap(g, s.startMs, s.endMs));
  const best = [...totals].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : null;
}

const firstUse = (casts: CastMark[], ids: number[]) => casts.find(([, a]) => ids.includes(a))?.[0] ?? null;

export function reviewTimeline(input: TimelineInput): TimelineReview {
  const { casts, aliveMs, top } = input;
  const bench = input.benchmark ?? null;
  const sorted = [...casts].sort((a, b) => a[0] - b[0]);
  const topSorted = top ? [...top.casts].sort((a, b) => a[0] - b[0]) : null;
  const potions = input.potionIds ?? [];

  const firstUses: FirstUse[] = [];
  const counted = new Set<number>();
  for (const id of input.cooldownIds) {
    if (counted.has(id)) continue;
    const isPotion = potions.includes(id);
    const group = isPotion ? potions : [id];
    for (const g of group) counted.add(g);
    firstUses.push({
      abilityId: id,
      player: firstUse(sorted, group),
      top: topSorted ? firstUse(topSorted, group) : null,
      median: bench?.firstUse[isPotion ? POTION_KEY : String(id)] ?? null,
    });
  }

  const gaps = castGaps(sorted, aliveMs);
  const idleMs = gaps.reduce((s, g) => s + g.endMs - g.startMs, 0);
  const topGaps = topSorted && top ? castGaps(topSorted, top.durationMs) : null;
  const topIdleRaw = topGaps?.reduce((s, g) => s + g.endMs - g.startMs, 0) ?? null;
  const topIdleShare = topIdleRaw != null && top ? topIdleRaw / top.durationMs : null;

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
    phases.push({
      id: s.id,
      name: s.name,
      intermission: s.intermission,
      you: yours.get(s.id) ?? null,
      top: theirs.get(s.id) ?? null,
      median: bench?.phases[s.id] ?? null,
    });
  }

  // Expected idle time, phase by phase: almost all idle time is in intermissions, so a pull with more
  // intermission than the reference kill should expect more of it. Phases without a reference use the
  // reference's whole-fight share.
  const expectedIdle = (share: (p: PhaseActivity) => number | null, whole: number) =>
    phases.reduce((sum, p) => sum + (p.you ? p.you.durationMs * (share(p) ?? whole) : 0), 0);
  const medianIdleMs = bench ? expectedIdle((p) => p.median?.idleShare.median ?? null, bench.idleShare.median) : null;
  const topIdleMs =
    topIdleShare != null ? expectedIdle((p) => (p.top && p.top.durationMs ? activityIdleShare(p.top) : null), topIdleShare) : null;

  const findings: TimelineFinding[] = [];
  for (const f of firstUses) {
    if (f.player == null) continue;
    // Prefer the median: one player's kill can follow a different plan.
    if (f.median) {
      if (f.median.usedBy < OPENER_USED_BY || f.median.median > OPENER_MS || f.median.median >= aliveMs) continue;
      if (f.player > f.median.p75 && f.player - f.median.median >= LATE_COOLDOWN_MS) {
        findings.push({ kind: "late-cooldown", abilityId: f.abilityId, playerMs: f.player, topMs: f.median.median, basis: "median" });
      }
    } else if (!bench && f.top != null && f.top <= OPENER_MS && f.top < aliveMs && f.player - f.top >= LATE_COOLDOWN_MS) {
      findings.push({ kind: "late-cooldown", abilityId: f.abilityId, playerMs: f.player, topMs: f.top, basis: "top1" });
    }
  }
  const idleRef: [number, TimelineBasis] | null =
    medianIdleMs != null ? [medianIdleMs, "median"] : topIdleMs != null ? [topIdleMs, "top1"] : null;
  if (idleRef) {
    const extra = idleMs - idleRef[0];
    if (extra >= IDLE_EXTRA_MS && extra >= aliveMs * IDLE_EXTRA_SHARE) {
      const busyMs = aliveMs - idleMs;
      findings.push({
        kind: "idle-time",
        playerMs: idleMs,
        topMs: idleRef[0],
        basis: idleRef[1],
        longest: [...gaps].sort((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs)).slice(0, 3),
        estDpsGain: input.amount && busyMs > 0 ? (input.amount * extra) / busyMs : null,
      });
    }
  }

  return {
    precasts: input.precasts,
    topPrecast: bench?.precast ?? null,
    opener: {
      windowMs: OPENER_MS,
      you: sorted.filter(([t]) => t <= OPENER_MS),
      top: topSorted ? topSorted.filter(([t]) => t <= OPENER_MS) : null,
      firstUses,
    },
    byPhase,
    phases,
    gaps: gaps.map((g) => ({ ...g, phase: byPhase ? dominantPhase(g, spans) : null })),
    idleMs,
    topIdleMs,
    medianIdleMs,
    sampleSize: bench?.sampleSize ?? 0,
    findings,
  };
}
