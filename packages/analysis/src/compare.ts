import type { SpecBenchmark } from "./benchmark";
import type { KeyedSummary } from "./stats";
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
}

export type Status = "low" | "ok" | "high" | "missing";

export interface AbilityComparison {
  abilityId: number;
  playerCpm: number;
  benchmark: KeyedSummary;
  status: Status;
  /** Rough DPS gained by casting as often as the median top player, when we can estimate it. */
  estDpsGain: number | null;
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
  amount: { player: number; median: number; p25: number; p75: number; ratio: number } | null;
  itemLevel: { player: number | null; median: number };
  durationMs: { player: number; median: number };
  activeTime: { player: number; median: number; p25: number };
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

function status(player: number, b: KeyedSummary, minGap: (median: number) => boolean): Status {
  if (player === 0 && b.median > 0) return "missing";
  if (player < b.p25 && minGap(b.median)) return "low";
  if (player > b.p75) return "high";
  return "ok";
}

export function compareToBenchmark(p: PlayerPerformance, b: SpecBenchmark): Comparison {
  const aliveMin = p.aliveMs / 60_000;
  const durationSec = p.durationMs / 1000;
  const activeTime = p.aliveMs ? p.activeTimeMs / p.aliveMs : 0;

  const abilities: AbilityComparison[] = Object.entries(b.cpm)
    .map(([id, bench]) => {
      const casts = p.casts[id] ?? 0;
      const playerCpm = aliveMin ? casts / aliveMin : 0;
      const damagePerCast = casts ? (p.damageByAbility[id] ?? 0) / casts : 0;
      const missedCasts = Math.max(0, (bench.median - playerCpm) * aliveMin);
      const gain = damagePerCast > 0 ? (missedCasts * damagePerCast) / durationSec : 0;
      const bigGain = !!p.amount && gain >= p.amount * LOW_GAIN_SHARE;
      let s = status(playerCpm, bench, () => playerCpm < bench.median * LOW_CPM_RATIO || bigGain);
      if (s === "missing" && bench.usedBy < MISSING_USED_BY) s = "low";
      const estDpsGain = (s === "low" || s === "missing") && gain > 0 ? gain : null;
      return { abilityId: Number(id), playerCpm, benchmark: bench, status: s, estDpsGain };
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
  const impactful = (a: AbilityComparison) =>
    a.estDpsGain != null || (b.buffUptime[a.abilityId]?.median ?? 0) >= IMPACTFUL_BUFF_UPTIME;

  const findings: PerfFinding[] = [];
  if (activeTime < b.activeTimePct.p25 && b.activeTimePct.median - activeTime >= LOW_ACTIVE_GAP) {
    const estDpsGain = p.amount && activeTime > 0 ? p.amount * (b.activeTimePct.median / activeTime - 1) : null;
    findings.push({ kind: "low-active-time", player: activeTime, median: b.activeTimePct.median, estDpsGain });
  }
  for (const ability of abilities) {
    if (!impactful(ability)) continue;
    if (ability.status === "missing") findings.push({ kind: "missing-ability", ability });
    else if (ability.status === "low") findings.push({ kind: "low-casts", ability });
  }
  for (const buff of buffs) if (buff.selfCast && buff.status === "low") findings.push({ kind: "low-buff-uptime", buff });
  for (const target of targets) if (target.status === "low" || target.status === "missing") findings.push({ kind: "low-target-share", target });
  findings.sort((x, y) => (gainOf(y) ?? -1) - (gainOf(x) ?? -1));

  return {
    sampleSize: b.sampleSize,
    insufficient: b.insufficient,
    amount:
      p.amount != null
        ? { player: p.amount, median: b.amount.median, p25: b.amount.p25, p75: b.amount.p75, ratio: p.amount / b.amount.median }
        : null,
    itemLevel: { player: p.itemLevel, median: b.itemLevel.median },
    durationMs: { player: p.durationMs, median: b.durationMs.median },
    activeTime: { player: activeTime, median: b.activeTimePct.median, p25: b.activeTimePct.p25 },
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
