import type { ReactNode } from "react";
import Link from "next/link";
import { OPENER_MS, type TopTimeline } from "@log-review/analysis";
import { DisplayModeProvider, DisplaySwitch } from "@/components/display-mode";
import { ErrorPanel, NotFoundPanel } from "@/components/error-panel";
import { BuffTable, PerfFindingCard, RotationTable, TargetTable } from "@/components/performance";
import { CastLog, CooldownCompare, OpenerCompare, PotionCompare } from "@/components/personal";
import { RememberCharacter } from "@/components/player-picker";
import { FirstUseTable, PhaseActivityTable, PullStart } from "@/components/timeline";
import { type Tab, Tabs } from "@/components/tabs";
import { Breadcrumbs, Section, linkClass } from "@/components/ui";
import { ViewNav } from "@/components/view-nav";
import { type PlayerAnalysis, getPlayerAnalysis } from "@/lib/data";
import { classColor, compact, difficultyName, fightTime, percent, specLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

const weekLabel = (week: string) => week.split("-test")[0];

function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "bad" }) {
  return (
    <div className="border-l border-line px-4 py-2 first:border-l-0 first:pl-0">
      <div className="text-[11px] uppercase tracking-[0.07em] text-faint">{label}</div>
      <div className={`num text-xl ${tone === "bad" ? "text-dmg" : tone === "good" ? "text-heal" : "text-fg"}`}>{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

function NoBenchmark() {
  return <p className="py-2 text-sm text-muted">No top-player data for this spec and boss yet. It updates weekly.</p>;
}

export default async function PlayerPage({ params }: { params: Promise<{ code: string; fight: string; actor: string }> }) {
  const { code, fight: fightParam, actor: actorParam } = await params;

  let result: PlayerAnalysis | null;
  try {
    result = await getPlayerAnalysis(code, Number(fightParam), Number(actorParam));
  } catch (error) {
    return <ErrorPanel error={error} />;
  }
  if (!result) return <NotFoundPanel what="Player or pull" />;

  const { report, fight, player, analysis, consumables, comparison, timeline, abilities, benchmarkWeek, topPlayer, tops, playerCasts, cooldownIds } = result;
  const durationMs = fight.endTime - fight.startTime;
  const pull = report.fights.filter((f) => f.encounterID === fight.encounterID && f.difficulty === fight.difficulty && f.id <= fight.id).length;
  const spec = specLabel(player.specKey, player.classSlug);
  const boss = `${fight.name} ${difficultyName(fight.difficulty)}`;
  const amount = comparison?.amount?.player ?? null;
  const findings = comparison?.findings ?? [];
  const count = (kinds: string[]) => findings.filter((f) => kinds.includes(f.kind)).length;
  const badge = (n: number) => (n ? String(n) : undefined);
  const raidHref = fight.difficulty
    ? `/r/${code}/raid/${fight.encounterID}-${fight.difficulty}/players/${player.id}?scope=${fight.id}`
    : `/r/${code}?view=raid`;
  const myDeaths = analysis.deaths.filter((d) => d.category === "early" || d.category === "wipe-start");
  // The #1 player to compare cast by cast with: the first stored top timeline, or the benchmark's #1.
  const top1: TopTimeline | null = tops[0] ?? (topPlayer ? { rank: 1, name: topPlayer.name, durationMs: topPlayer.durationMs, casts: topPlayer.timeline } : null);

  const tabs: Tab[] = [
    {
      id: "opener",
      label: "Opener",
      badge: badge(count(["late-cooldown"]) + result.openerSteps.filter((s) => s.match === false).length),
      content: (
        <div className="space-y-6">
          <PullStart timeline={timeline} abilities={abilities} />
          {tops.length ? (
            <OpenerCompare steps={result.openerSteps} you={playerCasts} tops={tops} cooldownIds={cooldownIds} abilities={abilities} windowMs={OPENER_MS} />
          ) : (
            <NoBenchmark />
          )}
          <FirstUseTable timeline={timeline} abilities={abilities} />
        </div>
      ),
    },
    {
      id: "cooldowns",
      label: "Cooldowns",
      badge: badge(findings.filter((f) => f.kind === "low-casts" && f.ability.benchmark.median <= 2).length),
      content: <CooldownCompare cooldownIds={cooldownIds} you={playerCasts} durationMs={durationMs} top={top1} comparison={comparison} abilities={abilities} />,
    },
    {
      id: "potions",
      label: "Potions",
      badge: badge(result.potions.top && result.potions.top.usedTwo >= 0.5 && result.potions.yours.length < 2 ? 1 : 0),
      content: <PotionCompare potions={result.potions} durationMs={durationMs} abilities={abilities} />,
    },
    {
      id: "rotation",
      label: "Rotation",
      badge: badge(count(["low-casts", "missing-ability", "low-active-time", "low-buff-uptime", "low-target-share", "idle-time"])),
      content: comparison ? (
        <div className="space-y-8">
          <RotationTable comparison={comparison} abilities={abilities} />
          <PhaseActivityTable timeline={timeline} />
          <div>
            <h3 className="mb-2 font-medium text-fg">Buff uptime</h3>
            <BuffTable comparison={comparison} abilities={abilities} />
          </div>
          <div>
            <h3 className="mb-2 font-medium text-fg">Targets</h3>
            <TargetTable comparison={comparison} />
          </div>
        </div>
      ) : (
        <NoBenchmark />
      ),
    },
    {
      id: "casts",
      label: "Every cast",
      content: <CastLog you={playerCasts} top={top1} durationMs={durationMs} cooldownIds={cooldownIds} utilityIds={result.utilityIds} abilities={abilities} />,
    },
  ];

  return (
    <DisplayModeProvider>
      <div className="space-y-6">
        <RememberCharacter name={player.name} />
        <Breadcrumbs
          items={[
            { label: "Home", href: "/" },
            { label: report.title, href: `/r/${code}` },
            { label: `${fight.name} pull ${pull}`, href: `/r/${code}/${fight.id}` },
            { label: player.name },
          ]}
        />
        <ViewNav active="personal" personalHref={`/r/${code}/${fight.id}/${player.id}`} raidHref={raidHref} />

        <header className="border-l-[3px] pl-3" style={{ borderColor: classColor(player.classSlug) }}>
          <h1 className="text-2xl font-semibold leading-tight" style={{ color: classColor(player.classSlug) }}>
            {player.name}
          </h1>
          <p className="text-sm text-muted">
            {spec} · {boss} · pull {pull} ·{" "}
            {fight.kill ? <span className="text-heal">kill</span> : <span className="text-warn">wipe {fight.bossPercentage?.toFixed(1)}%</span>} ·{" "}
            <span className="num">{fightTime(durationMs)}</span>
          </p>
          <p className="text-xs text-faint">
            {consumables.combatPotions} combat {consumables.combatPotions === 1 ? "potion" : "potions"}
            {myDeaths.length > 0 && (
              <>
                {" "}
                ·{" "}
                <Link href={raidHref} className="text-dmg hover:underline">
                  died at {myDeaths.map((d) => fightTime(d.fightTimeMs)).join(", ")}: see why in the raid view
                </Link>
              </>
            )}
          </p>
        </header>

        {comparison && (
          <section>
            <div className="flex flex-wrap border-y border-line py-2">
              {comparison.amount && (
                <Stat
                  label="DPS"
                  value={compact(comparison.amount.player)}
                  sub={
                    comparison.amount.similar ? (
                      <span title={`Median of the ${comparison.amount.similar.n} top players whose kills were closest in length to this pull. Longer fights mean lower DPS for everyone.`}>
                        {percent(comparison.amount.ratio)} of {compact(comparison.amount.similar.median)}: top kills of{" "}
                        {comparison.amount.similar.minMs === comparison.amount.similar.maxMs
                          ? fightTime(comparison.amount.similar.minMs)
                          : `${fightTime(comparison.amount.similar.minMs)}–${fightTime(comparison.amount.similar.maxMs)}`}
                      </span>
                    ) : (
                      `${percent(comparison.amount.ratio)} of top median ${compact(comparison.amount.median)}`
                    )
                  }
                  tone={comparison.amount.ratio < 0.85 ? "bad" : comparison.amount.ratio >= 1 ? "good" : undefined}
                />
              )}
              <Stat
                label="Casting"
                value={percent(comparison.activeTime.player)}
                sub={`top ${percent(comparison.activeTime.median)}`}
                tone={comparison.activeTime.status === "low" ? "bad" : undefined}
              />
              <Stat label="Item level" value={comparison.itemLevel.player ?? "–"} sub={`top ${Math.round(comparison.itemLevel.median)}`} />
              <Stat label="Length" value={fightTime(comparison.durationMs.player)} sub={`top kills ${fightTime(comparison.durationMs.median)}`} />
            </div>
            <p className="mt-1.5 text-xs text-faint">
              vs top {comparison.sampleSize} {spec} on {boss}
              {benchmarkWeek ? `, ${weekLabel(benchmarkWeek)}` : ""}. Top players have better gear and shorter kills; read gaps as direction.
              {comparison.insufficient && " Small sample."}
              {comparison.amount === null && " Healers: DPS not compared."}
            </p>
          </section>
        )}

        <Section title="Rotation mistakes" meta={findings.length ? `${findings.length} found, biggest gain first` : undefined}>
          {!comparison ? (
            <p className="pb-3 text-sm text-muted">No top-player data for {boss} yet (updated weekly), so there's nothing to compare your casts with.</p>
          ) : findings.length === 0 ? (
            <p className="pb-3 text-sm text-heal">Nothing to flag: {comparison.amount ? "on pace with top players" : "casting in line with top players"}.</p>
          ) : (
            <ol>
              {findings.map((f, i) => (
                <PerfFindingCard key={i} index={i + 1} finding={f} abilities={abilities} amount={amount} />
              ))}
            </ol>
          )}
        </Section>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <span className="text-xs text-faint">Show casts as</span>
          <DisplaySwitch />
        </div>
        <Tabs tabs={tabs} />

        <p className="border-t border-line pt-3 text-xs">
          <a className={linkClass} href={`https://www.warcraftlogs.com/reports/${code}#fight=${fight.id}&source=${player.id}`} target="_blank" rel="noreferrer">
            Open on Warcraft Logs
          </a>
        </p>
      </div>
    </DisplayModeProvider>
  );
}
