import type { AbilityComparison, Comparison, PerfFinding, Status } from "@log-review/analysis";
import { type AbilityInfo } from "./report";
import { Ability, Badge, type Tone } from "./ui";
import { compact, fightTime, percent } from "@/lib/format";

const STATUS: Record<Status, { label: string; tone: Tone }> = {
  low: { label: "Low", tone: "red" },
  missing: { label: "Not used", tone: "red" },
  ok: { label: "OK", tone: "green" },
  high: { label: "High", tone: "blue" },
};

export function StatusBadge({ status }: { status: Status }) {
  const s = STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const perMin = (n: number) => `${n.toFixed(n < 2 ? 2 : 1)}/min`;

function Gain({ value, amount }: { value: number | null; amount: number | null }) {
  if (value == null) return null;
  return (
    <span className="text-sm text-amber-300">
      ≈ +{compact(value)} DPS{amount ? ` (+${percent(value / amount)})` : ""} estimated
    </span>
  );
}

export function PerfFindingCard({
  finding,
  abilities,
  amount,
}: {
  finding: PerfFinding;
  abilities: AbilityInfo;
  amount: number | null;
}) {
  const card = (title: React.ReactNode, body: React.ReactNode, gain: number | null, advice: string) => (
    <div className="rounded-xl border border-amber-500/40 bg-panel p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-white">{title}</span>
        <Gain value={gain} amount={amount} />
      </div>
      <p className="mt-2 text-sm text-slate-300">{body}</p>
      <p className="mt-1 text-sm text-slate-400">{advice}</p>
    </div>
  );
  const ability = (id: number) => <Ability id={id} name={abilities[id]?.name} icon={abilities[id]?.icon} />;

  switch (finding.kind) {
    case "low-active-time":
      return card(
        "You spent too much time not casting",
        `You were casting ${percent(finding.player)} of the time you were alive. Top players cast ${percent(finding.median)} of the time.`,
        finding.estDpsGain,
        "Keep casting while you move: use instant casts and movement abilities, and pre-position for mechanics so you lose less time.",
      );
    case "low-casts": {
      const a = finding.ability;
      return card(
        <>Cast {ability(a.abilityId)} more often</>,
        `You cast it ${perMin(a.playerCpm)}. Top players cast it ${perMin(a.benchmark.median)}.`,
        a.estDpsGain,
        a.benchmark.median <= 2
          ? "This is a cooldown: use it as soon as it's ready unless you're saving it for a specific phase."
          : "Fit it into your rotation more often, and check your priority list.",
      );
    }
    case "missing-ability": {
      const a = finding.ability;
      return card(
        <>You never cast {ability(a.abilityId)}</>,
        `${percent(a.benchmark.usedBy)} of top players use it, ${perMin(a.benchmark.median)}.`,
        a.estDpsGain,
        "If you didn't have it talented, compare your talents with top players. Otherwise, add it to your rotation.",
      );
    }
    case "low-buff-uptime": {
      const b = finding.buff;
      return card(
        <>Keep {ability(b.abilityId)} up longer</>,
        `It was active ${percent(b.player)} of the fight. Top players keep it up ${percent(b.benchmark.median)} of the time.`,
        null,
        "Use it more often, or line it up so it isn't wasted during downtime.",
      );
    }
    case "low-target-share": {
      const t = finding.target;
      return card(
        `Hit ${t.target} more`,
        `${percent(t.player)} of your damage went to ${t.target}. Top players put ${percent(t.benchmark.median)} into it.`,
        null,
        "Swap to it when it spawns. Killing adds on time is often worth more than raw boss damage.",
      );
    }
  }
}

function RangeBar({ player, p25, median, p75, max }: { player: number; p25: number; median: number; p75: number; max: number }) {
  const at = (v: number) => `${Math.min(100, (v / (max || 1)) * 100)}%`;
  return (
    <div className="relative h-3 w-full min-w-24 rounded-full bg-line" aria-hidden>
      <div className="absolute inset-y-0 rounded-full bg-slate-500/40" style={{ left: at(p25), width: `calc(${at(p75)} - ${at(p25)})` }} />
      <div className="absolute inset-y-0 w-0.5 bg-slate-300" style={{ left: at(median) }} />
      <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-ink" style={{ left: at(player) }} />
    </div>
  );
}

export function RangeLegend() {
  return (
    <div className="mb-3 flex flex-wrap gap-4 text-xs text-slate-400">
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-full bg-accent" /> You
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-0.5 bg-slate-300" /> Top players' median
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-5 rounded-full bg-slate-500/40" /> Middle half of top players
      </span>
    </div>
  );
}

export function RotationTable({ comparison, abilities }: { comparison: Comparison; abilities: AbilityInfo }) {
  const rows: AbilityComparison[] = comparison.abilities;
  return (
    <div>
      <RangeLegend />
      <div className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium sm:pl-0">Ability</th>
              <th className="px-2 py-2 text-right font-medium">You</th>
              <th className="px-2 py-2 text-right font-medium">Top</th>
              <th className="w-40 px-2 py-2 font-medium" />
              <th className="px-4 py-2 font-medium sm:pr-0">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            <tr>
              <td className="px-4 py-2 text-slate-200 sm:pl-0">Time spent casting</td>
              <td className="px-2 py-2 text-right">{percent(comparison.activeTime.player)}</td>
              <td className="px-2 py-2 text-right text-slate-400">{percent(comparison.activeTime.median)}</td>
              <td className="px-2 py-2">
                <RangeBar player={comparison.activeTime.player} p25={comparison.activeTime.p25} median={comparison.activeTime.median} p75={comparison.activeTime.median} max={1} />
              </td>
              <td className="px-4 py-2 sm:pr-0">
                <StatusBadge status={comparison.findings.some((f) => f.kind === "low-active-time") ? "low" : "ok"} />
              </td>
            </tr>
            {rows.map((a) => {
              const max = Math.max(a.playerCpm, a.benchmark.p75) * 1.15;
              return (
                <tr key={a.abilityId}>
                  <td className="px-4 py-2 sm:pl-0">
                    <Ability id={a.abilityId} name={abilities[a.abilityId]?.name} icon={abilities[a.abilityId]?.icon} />
                  </td>
                  <td className="px-2 py-2 text-right">{perMin(a.playerCpm)}</td>
                  <td className="px-2 py-2 text-right text-slate-400">{perMin(a.benchmark.median)}</td>
                  <td className="px-2 py-2">
                    <RangeBar player={a.playerCpm} p25={a.benchmark.p25} median={a.benchmark.median} p75={a.benchmark.p75} max={max} />
                  </td>
                  <td className="px-4 py-2 sm:pr-0">
                    <StatusBadge status={a.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Casts per minute while you were alive. Only abilities that at least half of the top players use are shown.
      </p>
    </div>
  );
}

export function BuffTable({ comparison, abilities }: { comparison: Comparison; abilities: AbilityInfo }) {
  const groups = [
    { title: "Your cooldowns and buffs", rows: comparison.buffs.filter((b) => b.selfCast) },
    { title: "Procs and buffs from others", rows: comparison.buffs.filter((b) => !b.selfCast), note: "These depend on luck and your group, so they're shown for context only." },
  ];
  return (
    <div className="space-y-6">
      <RangeLegend />
      {groups.map((g, gi) =>
        g.rows.length ? (
          <div key={g.title}>
            <h3 className="font-medium text-slate-200">{g.title}</h3>
            {g.note && <p className="text-xs text-slate-500">{g.note}</p>}
            <ul className="mt-2 divide-y divide-line">
              {g.rows.map((b) => (
                <li key={b.abilityId} className="grid grid-cols-[minmax(0,1fr)_4rem_8rem] items-center gap-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_4rem_4rem_10rem_5rem]">
                  <span className="truncate">
                    <Ability id={b.abilityId} name={abilities[b.abilityId]?.name} icon={abilities[b.abilityId]?.icon} />
                  </span>
                  <span className="text-right">{percent(b.player)}</span>
                  <span className="hidden text-right text-slate-400 sm:block">{percent(b.benchmark.median)}</span>
                  <RangeBar player={b.player} p25={b.benchmark.p25} median={b.benchmark.median} p75={b.benchmark.p75} max={1} />
                  <span className="hidden sm:block">{gi === 0 && <StatusBadge status={b.status} />}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  );
}

export function TargetTable({ comparison }: { comparison: Comparison }) {
  if (!comparison.targets.length) return <p className="text-sm text-slate-400">No target data for this boss yet.</p>;
  return (
    <div>
      <RangeLegend />
      <ul className="divide-y divide-line">
        {comparison.targets.map((t, i) => (
          <li key={t.target} className="grid grid-cols-[minmax(0,1fr)_4rem_8rem] items-center gap-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_4rem_4rem_10rem_5rem]">
            <span className="truncate text-slate-200">
              {t.target} {i === 0 && <span className="text-xs text-slate-500">(main target)</span>}
            </span>
            <span className="text-right">{percent(t.player)}</span>
            <span className="hidden text-right text-slate-400 sm:block">{percent(t.benchmark.median)}</span>
            <RangeBar player={t.player} p25={t.benchmark.p25} median={t.benchmark.median} p75={t.benchmark.p75} max={1} />
            <span className="hidden sm:block">
              <StatusBadge status={t.status} />
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-slate-500">
        Share of your damage that went to each target. Names come from the log, so logs recorded in another game language may not match.
      </p>
    </div>
  );
}

/** Your cooldown casts vs the #1 player's, on a shared time axis. */
export function CooldownTimeline({
  comparison,
  abilities,
  playerCasts,
  playerDurationMs,
  top,
}: {
  comparison: Comparison;
  abilities: AbilityInfo;
  playerCasts: [number, number][];
  playerDurationMs: number;
  top: { name: string; durationMs: number; timeline: [number, number][] };
}) {
  // Cooldowns: abilities top players cast at most ~2 times a minute.
  const cooldowns = comparison.abilities.filter((a) => a.benchmark.median > 0 && a.benchmark.median <= 2).slice(0, 8);
  if (!cooldowns.length) return <p className="text-sm text-slate-400">No major cooldowns found for this spec.</p>;
  const span = Math.max(playerDurationMs, top.durationMs);
  const at = (ms: number) => `${(ms / span) * 100}%`;
  const row = (casts: [number, number][], id: number, duration: number, tone: string) => (
    <div className="relative h-4 rounded bg-line/60">
      <div className="absolute inset-y-0 rounded bg-line" style={{ width: at(duration) }} />
      {casts
        .filter(([, a]) => a === id)
        .map(([t], i) => (
          <span key={i} title={fightTime(t)} className={`absolute top-1/2 h-3 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm ${tone}`} style={{ left: at(t) }} />
        ))}
    </div>
  );
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Each mark is one cast. Compare your timing with <span className="text-slate-200">{top.name}</span>, the #1 player of your spec on this boss.
        Gaps where you have no marks are cooldowns sitting unused.
      </p>
      {cooldowns.map((a) => (
        <div key={a.abilityId}>
          <div className="mb-1 text-sm">
            <Ability id={a.abilityId} name={abilities[a.abilityId]?.name} icon={abilities[a.abilityId]?.icon} />
          </div>
          <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 text-xs text-slate-400">
            <span>You</span>
            {row(playerCasts, a.abilityId, playerDurationMs, "bg-accent")}
            <span className="truncate">#1</span>
            {row(top.timeline, a.abilityId, top.durationMs, "bg-slate-300")}
          </div>
        </div>
      ))}
      <div className="flex justify-between text-xs text-slate-500">
        <span>0:00</span>
        <span>{fightTime(span)}</span>
      </div>
    </div>
  );
}
