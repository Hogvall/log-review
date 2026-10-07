import type { AbilityComparison, Comparison, PerfFinding, Status } from "@log-review/analysis";
import { type AbilityInfo, IssueRow } from "./report";
import { Ability } from "./ui";
import { compact, fightTime, percent } from "@/lib/format";

const STATUS: Record<Status, { label: string; className: string }> = {
  low: { label: "low", className: "text-dmg" },
  missing: { label: "not used", className: "text-dmg" },
  ok: { label: "ok", className: "text-faint" },
  high: { label: "high", className: "text-shield" },
};

export function StatusBadge({ status }: { status: Status }) {
  const s = STATUS[status];
  return <span className={`text-xs font-medium ${s.className}`}>{s.label}</span>;
}

const perMin = (n: number) => `${n.toFixed(n < 2 ? 2 : 1)}/min`;

function Gain({ value, amount }: { value: number | null; amount: number | null }) {
  if (value == null) return null;
  return (
    <span className="num ml-2 text-sm font-normal text-warn" title="Estimated">
      ~+{compact(value)} dps{amount ? ` (+${percent(value / amount)})` : ""}
    </span>
  );
}

export function PerfFindingCard({
  index,
  finding,
  abilities,
  amount,
}: {
  index: number;
  finding: PerfFinding;
  abilities: AbilityInfo;
  amount: number | null;
}) {
  const card = (title: React.ReactNode, body: React.ReactNode, gain: number | null, advice: string) => (
    <IssueRow
      index={index}
      severity="medium"
      title={
        <>
          {title}
          <Gain value={gain} amount={amount} />
        </>
      }
    >
      <p className="text-fg/85">{body}</p>
      <p>{advice}</p>
    </IssueRow>
  );
  const ability = (id: number) => <Ability id={id} name={abilities[id]?.name} icon={abilities[id]?.icon} />;

  switch (finding.kind) {
    case "low-active-time":
      return card(
        "Too much time not casting",
        `Casting ${percent(finding.player)} of the time alive; top players ${percent(finding.median)}.`,
        finding.estDpsGain,
        "Cast while moving (instants, movement abilities) and pre-position for mechanics.",
      );
    case "low-casts": {
      const a = finding.ability;
      return card(
        <>More {ability(a.abilityId)} casts</>,
        `${perMin(a.playerCpm)} vs top ${perMin(a.benchmark.median)}.`,
        a.estDpsGain,
        a.benchmark.median <= 2
          ? "Cooldown: use it on cooldown unless you're holding it for a phase."
          : "Fit it into your rotation more often; check your priority.",
      );
    }
    case "missing-ability": {
      const a = finding.ability;
      return card(
        <>Never cast {ability(a.abilityId)}</>,
        `${percent(a.benchmark.usedBy)} of top players use it (${perMin(a.benchmark.median)}).`,
        a.estDpsGain,
        "Not talented? Compare talents with top players. Otherwise add it to your rotation.",
      );
    }
    case "low-buff-uptime": {
      const b = finding.buff;
      return card(
        <>Low {ability(b.abilityId)} uptime</>,
        `Uptime ${percent(b.player)} vs top ${percent(b.benchmark.median)}.`,
        null,
        "Use it more often and avoid wasting it during downtime.",
      );
    }
    case "late-cooldown": {
      const who = finding.basis === "median" ? "top players' median is" : "the #1 player pressed it at";
      return card(
        <>Late {ability(finding.abilityId)} in the opener</>,
        `First used at ${(finding.playerMs / 1000).toFixed(1)}s; ${who} ${(finding.topMs / 1000).toFixed(1)}s.`,
        null,
        "Use it in your opener unless you're holding it for something specific; a delayed first use can cost a whole cast over the fight.",
      );
    }
    case "idle-time":
      return card(
        "Long stretches without casting",
        `${Math.round(finding.playerMs / 1000)}s idle vs ${Math.round(finding.topMs / 1000)}s for ${finding.basis === "median" ? "top players (median)" : "#1"}; longest: ${finding.longest
          .map((g) => `${fightTime(g.startMs)} (${Math.round((g.endMs - g.startMs) / 1000)}s)`)
          .join(", ")}.`,
        finding.estDpsGain,
        "Check the Timeline tab for when it happened; keep casting through movement and mechanics where you can.",
      );
    case "low-target-share": {
      const t = finding.target;
      return card(
        `Low damage to ${t.target}`,
        `${percent(t.player)} of your damage vs top ${percent(t.benchmark.median)}.`,
        null,
        "Swap when it spawns; killing adds on time usually beats boss damage.",
      );
    }
  }
}

function RangeBar({ player, p25, median, p75, max }: { player: number; p25: number; median: number; p75: number; max: number }) {
  const at = (v: number) => `${Math.min(100, (v / (max || 1)) * 100)}%`;
  return (
    <div className="relative h-2.5 w-full min-w-24 bg-line" aria-hidden>
      <div className="absolute inset-y-0 bg-muted/30" style={{ left: at(p25), width: `calc(${at(p75)} - ${at(p25)})` }} />
      <div className="absolute -inset-y-0.5 w-px bg-muted" style={{ left: at(median) }} />
      <div className="absolute -inset-y-1 w-[3px] -translate-x-1/2 bg-fg" style={{ left: at(player) }} />
    </div>
  );
}

export function RangeLegend() {
  return (
    <div className="mb-2 flex flex-wrap gap-4 text-[11px] text-faint">
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-[3px] bg-fg" /> you
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-px bg-muted" /> top median
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-5 bg-muted/30" /> top middle 50%
      </span>
    </div>
  );
}

/**
 * One row per spell name: some spells log under two IDs (e.g. Alter Time and its return), which would
 * otherwise show as duplicate rows. Keeps the ID top players use most.
 */
function onePerName<T extends { abilityId: number; benchmark: { median: number } }>(rows: T[], abilities: AbilityInfo): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    const key = abilities[r.abilityId]?.name ?? `#${r.abilityId}`;
    const seen = best.get(key);
    if (!seen || r.benchmark.median > seen.benchmark.median) best.set(key, r);
  }
  return rows.filter((r) => best.get(abilities[r.abilityId]?.name ?? `#${r.abilityId}`) === r);
}

export function RotationTable({ comparison, abilities }: { comparison: Comparison; abilities: AbilityInfo }) {
  const rows: AbilityComparison[] = onePerName(comparison.abilities, abilities);
  return (
    <div>
      <RangeLegend />
      <div className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-faint">
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
              <td className="px-4 py-2 text-fg sm:pl-0">Time spent casting</td>
              <td className="px-2 py-2 text-right">{percent(comparison.activeTime.player)}</td>
              <td className="px-2 py-2 text-right text-muted">{percent(comparison.activeTime.median)}</td>
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
                  <td className="px-2 py-2 text-right text-muted">{perMin(a.benchmark.median)}</td>
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
      <p className="mt-3 text-xs text-faint">
        Casts per minute while you were alive. Only abilities that at least half of the top players use are shown.
      </p>
    </div>
  );
}

export function BuffTable({ comparison, abilities }: { comparison: Comparison; abilities: AbilityInfo }) {
  const groups = [
    { title: "Your cooldowns and buffs", rows: onePerName(comparison.buffs.filter((b) => b.selfCast), abilities) },
    { title: "Procs and buffs from others", rows: onePerName(comparison.buffs.filter((b) => !b.selfCast), abilities), note: "These depend on luck and your group, so they're shown for context only." },
  ];
  return (
    <div className="space-y-6">
      <RangeLegend />
      {groups.map((g, gi) =>
        g.rows.length ? (
          <div key={g.title}>
            <h3 className="font-medium text-fg">{g.title}</h3>
            {g.note && <p className="text-xs text-faint">{g.note}</p>}
            <ul className="mt-2 divide-y divide-line">
              {g.rows.map((b) => (
                <li key={b.abilityId} className="grid grid-cols-[minmax(0,1fr)_4rem_8rem] items-center gap-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_4rem_4rem_10rem_5rem]">
                  <span className="truncate">
                    <Ability id={b.abilityId} name={abilities[b.abilityId]?.name} icon={abilities[b.abilityId]?.icon} />
                  </span>
                  <span className="text-right">{percent(b.player)}</span>
                  <span className="hidden text-right text-muted sm:block">{percent(b.benchmark.median)}</span>
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
  if (!comparison.targets.length) return <p className="text-sm text-muted">No target data for this boss yet.</p>;
  return (
    <div>
      <RangeLegend />
      <ul className="divide-y divide-line">
        {comparison.targets.map((t, i) => (
          <li key={t.target} className="grid grid-cols-[minmax(0,1fr)_4rem_8rem] items-center gap-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_4rem_4rem_10rem_5rem]">
            <span className="truncate text-fg">
              {t.target} {i === 0 && <span className="text-xs text-faint">(main target)</span>}
            </span>
            <span className="text-right">{percent(t.player)}</span>
            <span className="hidden text-right text-muted sm:block">{percent(t.benchmark.median)}</span>
            <RangeBar player={t.player} p25={t.benchmark.p25} median={t.benchmark.median} p75={t.benchmark.p75} max={1} />
            <span className="hidden sm:block">
              <StatusBadge status={t.status} />
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-faint">
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
  if (!cooldowns.length) return <p className="text-sm text-muted">No major cooldowns found for this spec.</p>;
  const span = Math.max(playerDurationMs, top.durationMs);
  const at = (ms: number) => `${(ms / span) * 100}%`;
  const row = (casts: [number, number][], id: number, duration: number, tone: string) => (
    <div className="relative h-4 bg-line/60">
      <div className="absolute inset-y-0 bg-line" style={{ width: at(duration) }} />
      {casts
        .filter(([, a]) => a === id)
        .map(([t], i) => (
          <span key={i} title={fightTime(t)} className={`absolute top-1/2 h-3 w-1.5 -translate-x-1/2 -translate-y-1/2 ${tone}`} style={{ left: at(t) }} />
        ))}
    </div>
  );
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Each mark is one cast. Compare your timing with <span className="text-fg">{top.name}</span>, the #1 player of your spec on this boss.
        Gaps where you have no marks are cooldowns sitting unused.
      </p>
      {cooldowns.map((a) => (
        <div key={a.abilityId}>
          <div className="mb-1 text-sm">
            <Ability id={a.abilityId} name={abilities[a.abilityId]?.name} icon={abilities[a.abilityId]?.icon} />
          </div>
          <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span>You</span>
            {row(playerCasts, a.abilityId, playerDurationMs, "bg-fg")}
            <span className="truncate">#1</span>
            {row(top.timeline, a.abilityId, top.durationMs, "bg-muted")}
          </div>
        </div>
      ))}
      <div className="flex justify-between text-xs text-faint">
        <span>0:00</span>
        <span>{fightTime(span)}</span>
      </div>
    </div>
  );
}
