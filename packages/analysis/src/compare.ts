import { type SpecBenchmark, isCooldownCpm } from "./benchmark";
import type { ExecuteThreshold } from "./defensives";
import { type ExecuteStarts, executeRate } from "./execute";
import { MIN_EXECUTE_WINDOW_MS } from "./timeline";
import { type KeyedSummary, summarize } from "./stats";
import type { TimelineFinding } from "./timeline";

/** Everything we measure about the viewer's own performance in one fight. */
export interface PlayerPerformance {
  /** DPS, or null when it isn't comparable (healers are ranked by HPS). */
  amount: number | null;
  durationMs: number;
  /** Time alive; casts and uptimes are judged against this so a death isn't counted twice. */
  aliveMs: number;
  itemLevel: number | null;
  activeTimeMs: number;
  /** Ability ID → number of casts. */
  casts: Record<string, number>;
  /** Ability ID → damage done (for damage-per-cast estimates). */
  damageByAbility: Record<string, number>;
  /** Aura ID → uptime share of the fight (0..1). */
  buffUptime: Record<string, number>;
  /** Target name → share of the player's damage (0..1). */
  targetShare: Record<string, number>;
  /** [fight time, ability ID] of each cast, for judging execute spells inside their window. */
  castTimes?: [number, number][];
  /** When bosses reached each execute threshold in this pull; null when not fetched. */
  executeStarts?: Partial<ExecuteStarts> | null;
}

/** "execute": depends on how long the boss spent at low health, so it isn't judged. */
export type Status = "low" | "ok" | "high" | "missing" | "execute";

/** What kind of spell a rotation row is, which decides how it's judged. */
export type AbilityRole = "damage" | "utility" | "execute";

export interface AbilityComparison {
  abilityId: number;
  /** Utility (movement, defensives, consumables) is shown but never a finding; executes aren't judged. */
  role: AbilityRole;
  playerCpm: number;
  /** Your casts this pull. */
  casts: number;
  benchmark: KeyedSummary;
  /**
   * Cooldowns only, when top players' timelines are known: how many casts their pace (first use, then one
   * every `everyMs`) fits in your time alive. Judged instead of casts per minute, which depends on fight length.
   */
  expected: { casts: number; firstMs: number; everyMs: number } | null;
  /**
   * Execute spells: your casts while the boss was in execute range vs what top players' rate in that
   * window fits. `windowMs` 0 means the boss never got there while you were alive, so it isn't judged.
   */
  executeWindow: { thresholdPct: number; startMs: number | null; windowMs: number; casts: number; expected: number; topPerMin: number } | null;
  status: Status;
  /** Rough DPS gained by casting as often as the median top player, when we can estimate it. */
  estDpsGain: number | null;
}

/** Your DPS next to the top players whose kills were closest in length to your pull. */
export interface SimilarLengthAmount {
  median: number;
  /** How many top players, and the range of their kill times. */
  n: number;
  minMs: number;
  maxMs: number;
}

/** Top players compared with when their kill length is close to yours (longer fights mean lower DPS). */
const SIMILAR_LENGTH_PLAYERS = 5;
/** Below this many top players, picking the closest few isn't meaningful. */
const MIN_POINTS_FOR_SIMILAR = 8;

export function similarLengthAmount(points: { amount: number; durationMs: number }[] | undefined, durationMs: number): SimilarLengthAmount | null {
  if (!points || points.length < MIN_POINTS_FOR_SIMILAR) return null;
  const closest = [...points].sort((a, b) => Math.abs(a.durationMs - durationMs) - Math.abs(b.durationMs - durationMs)).slice(0, SIMILAR_LENGTH_PLAYERS);
  return {
    median: summarize(closest.map((c) => c.amount)).median,
    n: closest.length,
    minMs: Math.min(...closest.map((c) => c.durationMs)),
    maxMs: Math.max(...closest.map((c) => c.durationMs)),
  };
}

export interface BuffComparison {
  abilityId: number;
  player: number;
  benchmark: KeyedSummary;
  status: Status;
  /** True for buffs from your own casts (cooldowns); procs and externals depend on luck and your group. */
  selfCast: boolean;
}

export interface TargetComparison {
  target: string;
  player: number;
  benchmark: KeyedSummary;
  status: Status;
}

export type PerfFinding =
  | { kind: "low-active-time"; player: number; median: number; estDpsGain: number | null }
  | { kind: "low-casts" | "missing-ability"; ability: AbilityComparison }
  | { kind: "low-buff-uptime"; buff: BuffComparison }
  | { kind: "low-target-share"; target: TargetComparison }
  | TimelineFinding;

export interface Comparison {
  sampleSize: number;
  insufficient: boolean;
  /** `ratio` is against `similar` (top players with the closest kill lengths) when known, else the median. */
  amount: { player: number; median: number; p25: number; p75: number; similar: SimilarLengthAmount | null; ratio: number } | null;
  itemLevel: { player: number | null; median: number };
  durationMs: { player: number; median: number };
  /** Status is judged here (not from the findings), so it stays right when the idle-time finding replaces that finding. */
  activeTime: { player: number; median: number; p25: number; p75: number; status: Status };
  abilities: AbilityComparison[];
  buffs: BuffComparison[];
  targets: TargetComparison[];
  /** Biggest estimated gains first; findings without an estimate follow. */
  findings: PerfFinding[];
}

/** How far below the median before we call something out: under p25 AND at least this much lower. */
const LOW_CPM_RATIO = 0.85;
const LOW_ACTIVE_GAP = 0.03;
const LOW_UPTIME_GAP = 0.1;
const LOW_TARGET_GAP = 0.05;
/**
 * Below p25 but above LOW_CPM_RATIO still counts as low when the missed casts are worth this share of your
 * DPS: 10% fewer casts of your main nuke matters more than 30% fewer of a filler.
 */
const LOW_GAIN_SHARE = 0.02;
/** An ability most top players use that you never cast. */
const MISSING_USED_BY = 0.8;
/**
 * Cooldowns whose buff top players keep up at least this much of the fight (Combustion ~23%) matter for DPS.
 * Movement spells, defensives and potions sit lower, so they stay out of the findings.
 */
const IMPACTFUL_BUFF_UPTIME = 0.15;
/** Estimated gains below this share of your DPS are too small to be worth a finding. */
const MIN_FINDING_GAIN_SHARE = 0.005;

export interface CompareOptions {
  /** Movement, defensives, raid utility and consumables: shown in tables, never DPS findings. */
  utilityIds?: Set<number>;
  /** Left out of the tables entirely (e.g. Bloodlust, which one player casts for the raid). */
  hiddenIds?: Set<number>;
  /** Execute spells → health threshold: judged per minute of the time the boss spent below it, when known. */
  executeIds?: Map<number, ExecuteThreshold>;
}

/**
 * How many casts of a cooldown top players' pace fits in your time alive: the first at their median first
 * use, then one every median interval. Null when their timelines don't say (older snapshots, rare spells).
 */
function expectedCasts(b: SpecBenchmark, id: string, aliveMs: number): AbilityComparison["expected"] {
  const first = b.timeline?.firstUse[id];
  const every = b.timeline?.cadence?.[id];
  if (!first || !every || first.usedBy < 0.5 || every.median <= 0) return null;
  const casts = aliveMs < first.median ? 0 : 1 + Math.floor((aliveMs - first.median) / every.median);
  return { casts, firstMs: first.median, everyMs: every.median };
}

function status(player: number, b: KeyedSummary, minGap: (median: number) => boolean): Status {
  if (player === 0 && b.median > 0) return "missing";
  if (player < b.p25 && minGap(b.median)) return "low";
  if (player > b.p75) return "high";
  return "ok";
}

export function compareToBenchmark(p: PlayerPerformance, b: SpecBenchmark, opts: CompareOptions = {}): Comparison {
  const utility = opts.utilityIds ?? new Set<number>();
  const hidden = opts.hiddenIds ?? new Set<number>();
  const executes = opts.executeIds ?? new Map<number, ExecuteThreshold>();
  const aliveMin = p.aliveMs / 60_000;
  const durationSec = p.durationMs / 1000;
  const activeTime = p.aliveMs ? p.activeTimeMs / p.aliveMs : 0;

  function judgeExecute(id: number): AbilityComparison["executeWindow"] {
    const top = b.timeline?.execute?.[id];
    const thresholdPct = executes.get(id);
    if (!top || !thresholdPct || !p.executeStarts || !p.castTimes) return null;
    const startMs = p.executeStarts[thresholdPct] ?? null;
    const rate = startMs == null ? { casts: 0, windowMs: 0 } : executeRate(p.castTimes.filter(([, a]) => a === id).map(([t]) => t), startMs, p.aliveMs);
    return {
      thresholdPct,
      startMs,
      windowMs: rate.windowMs,
      casts: rate.casts,
      expected: (top.perMin.median * rate.windowMs) / 60_000,
      topPerMin: top.perMin.median,
    };
  }

  const abilities: AbilityComparison[] = Object.entries(b.cpm)
    .filter(([id]) => !hidden.has(Number(id)))
    .map(([id, bench]) => {
      const casts = p.casts[id] ?? 0;
      const playerCpm = aliveMin ? casts / aliveMin : 0;
      const damagePerCast = casts ? (p.damageByAbility[id] ?? 0) / casts : 0;
      const role: AbilityRole = executes.has(Number(id)) ? "execute" : utility.has(Number(id)) ? "utility" : "damage";
      const expected = isCooldownCpm(bench) ? expectedCasts(b, id, p.aliveMs) : null;

      let s: Status;
      let missedCasts: number;
      if (expected) {
        // Cooldowns: judged by count against what top players' pace fits in your time alive.
        missedCasts = Math.max(0, expected.casts - casts);
        const gain = damagePerCast > 0 ? (missedCasts * damagePerCast) / durationSec : 0;
        const bigGain = !!p.amount && gain >= p.amount * LOW_GAIN_SHARE;
        s =
          casts === 0 && expected.casts > 0
            ? "missing"
            : missedCasts >= 1 && (casts < expected.casts * LOW_CPM_RATIO || bigGain)
              ? "low"
              : casts > expected.casts + 1
                ? "high"
                : "ok";
      } else {
        missedCasts = Math.max(0, (bench.median - playerCpm) * aliveMin);
        const gain = damagePerCast > 0 ? (missedCasts * damagePerCast) / durationSec : 0;
        const bigGain = !!p.amount && gain >= p.amount * LOW_GAIN_SHARE;
        s = status(playerCpm, bench, () => playerCpm < bench.median * LOW_CPM_RATIO || bigGain);
      }
      // Executes: judged only inside the execute window, against top players' rate in theirs.
      const executeWindow = role === "execute" ? judgeExecute(Number(id)) : null;
      if (role === "execute") {
        s = "execute";
        if (executeWindow && executeWindow.windowMs >= MIN_EXECUTE_WINDOW_MS) {
          missedCasts = Math.max(0, executeWindow.expected - executeWindow.casts);
          const gain = damagePerCast > 0 ? (missedCasts * damagePerCast) / durationSec : 0;
          const bigGain = !!p.amount && gain >= p.amount * LOW_GAIN_SHARE;
          s =
            missedCasts >= 1 && (executeWindow.casts < executeWindow.expected * LOW_CPM_RATIO || bigGain)
              ? executeWindow.casts === 0 ? "missing" : "low"
              : executeWindow.casts > executeWindow.expected + 1
                ? "high"
                : "ok";
        } else missedCasts = 0;
      }
      if (s === "missing" && bench.usedBy < MISSING_USED_BY) s = "low";
      const gain = damagePerCast > 0 ? (missedCasts * damagePerCast) / durationSec : 0;
      const estDpsGain = (s === "low" || s === "missing") && gain > 0 ? gain : null;
      return { abilityId: Number(id), role, playerCpm, casts, benchmark: bench, expected, executeWindow, status: s, estDpsGain };
    })
    .sort((x, y) => y.benchmark.median - x.benchmark.median);

  const castIds = new Set([...Object.keys(b.cpm), ...Object.keys(p.casts)]);
  const buffs: BuffComparison[] = Object.entries(b.buffUptime)
    .filter(([, bench]) => bench.median >= 0.1)
    .map(([id, bench]) => {
      const player = p.buffUptime[id] ?? 0;
      return {
        abilityId: Number(id),
        player,
        benchmark: bench,
        status: status(player, bench, (median) => median - player >= LOW_UPTIME_GAP),
        selfCast: castIds.has(id),
      };
    })
    .sort((x, y) => Number(y.selfCast) - Number(x.selfCast) || y.benchmark.median - x.benchmark.median);

  // The target top players hit most is the boss; the interesting ones are the adds.
  const mainTarget = Object.entries(b.targetShare).sort((x, y) => y[1].median - x[1].median)[0]?.[0];
  const targets: TargetComparison[] = Object.entries(b.targetShare)
    .map(([target, bench]) => {
      const player = p.targetShare[target] ?? 0;
      const s = target === mainTarget ? "ok" : status(player, bench, (median) => median - player >= LOW_TARGET_GAP);
      return { target, player, benchmark: bench, status: s };
    })
    .sort((x, y) => y.benchmark.median - x.benchmark.median);

  // Only abilities that clearly affect output become findings; the rest is still shown in the tables.
  const impactful = (a: AbilityComparison) => {
    // Utility never; executes only when judged inside their window (otherwise their status is "execute").
    if (a.role === "utility") return false;
    // Cooldowns whose buff matters count even when the cast itself does little damage.
    if ((b.buffUptime[a.abilityId]?.median ?? 0) >= IMPACTFUL_BUFF_UPTIME) return true;
    return a.estDpsGain != null && (!p.amount || a.estDpsGain >= p.amount * MIN_FINDING_GAIN_SHARE);
  };

  const findings: PerfFinding[] = [];
  const lowActive = activeTime < b.activeTimePct.p25 && b.activeTimePct.median - activeTime >= LOW_ACTIVE_GAP;
  if (lowActive) {
    const estDpsGain = p.amount && activeTime > 0 ? p.amount * (b.activeTimePct.median / activeTime - 1) : null;
    findings.push({ kind: "low-active-time", player: activeTime, median: b.activeTimePct.median, estDpsGain });
  }
  for (const ability of abilities) {
    if (!impactful(ability)) continue;
    if (ability.status === "missing") findings.push({ kind: "missing-ability", ability });
    else if (ability.status === "low") findings.push({ kind: "low-casts", ability });
  }
  for (const buff of buffs) if (buff.selfCast && buff.status === "low" && !utility.has(buff.abilityId)) findings.push({ kind: "low-buff-uptime", buff });
  for (const target of targets) if (target.status === "low" || target.status === "missing") findings.push({ kind: "low-target-share", target });
  findings.sort((x, y) => (gainOf(y) ?? -1) - (gainOf(x) ?? -1));

  return {
    sampleSize: b.sampleSize,
    insufficient: b.insufficient,
    amount:
      p.amount != null
        ? (() => {
            const similar = similarLengthAmount(b.amountPoints, p.durationMs);
            // The ratio uses the closest kill lengths when we can: longer fights mean lower DPS for everyone.
            return { player: p.amount, median: b.amount.median, p25: b.amount.p25, p75: b.amount.p75, similar, ratio: p.amount / (similar?.median ?? b.amount.median) };
          })()
        : null,
    itemLevel: { player: p.itemLevel, median: b.itemLevel.median },
    durationMs: { player: p.durationMs, median: b.durationMs.median },
    activeTime: {
      player: activeTime,
      median: b.activeTimePct.median,
      p25: b.activeTimePct.p25,
      p75: b.activeTimePct.p75,
      // Casting more than top players isn't a thing to flag, so this is only ever low or in line.
      status: lowActive ? "low" : "ok",
    },
    abilities,
    buffs,
    targets,
    findings,
  };
}

export function gainOf(f: PerfFinding): number | null {
  if (f.kind === "low-active-time") return f.estDpsGain;
  if (f.kind === "low-casts" || f.kind === "missing-ability") return f.ability.estDpsGain;
  if (f.kind === "idle-time") return f.estDpsGain;
  return null;
}

/** Time alive in the fight: until the last death, if the player died (battle resses can't be timed precisely). */
export function aliveTime(durationMs: number, deathTimesMs: number[]): number {
  return deathTimesMs.length ? Math.min(durationMs, Math.max(...deathTimesMs)) : durationMs;
}

export type Fix =
  | { source: "report"; finding: import("./player-report").Finding }
  | { source: "perf"; finding: PerfFinding };

/** A DPS finding worth putting near the top: at least this share of your DPS. */
const BIG_GAIN_SHARE = 0.03;

/**
 * One ranked list across survival and DPS:
 * deaths that mattered → big DPS gains → repeated avoidable damage → other DPS findings → the rest.
 */
export function rankFixes(
  report: import("./player-report").PlayerReport,
  comparison: Comparison | null,
): Fix[] {
  const tiers: Fix[][] = [[], [], [], [], []];
  for (const finding of report.findings) {
    const tier = finding.kind === "death" ? (finding.severity === "high" ? 0 : 4) : finding.severity === "medium" ? 2 : 4;
    tiers[tier]!.push({ source: "report", finding });
  }
  const amount = comparison?.amount?.player ?? 0;
  for (const finding of comparison?.findings ?? []) {
    const gain = gainOf(finding);
    tiers[gain != null && amount > 0 && gain / amount >= BIG_GAIN_SHARE ? 1 : 3]!.push({ source: "perf", finding });
  }
  return tiers.flat();
}
