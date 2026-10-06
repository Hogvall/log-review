import type { ReactNode } from "react";
import { ErrorPanel, NotFoundPanel } from "@/components/error-panel";
import { BuffTable, CooldownTimeline, PerfFindingCard, RotationTable, TargetTable } from "@/components/performance";
import { RememberCharacter } from "@/components/player-picker";
import { AvoidabilityBadge, DeathDetails, DeathTimeline, FindingCard } from "@/components/report";
import { type Tab, Tabs } from "@/components/tabs";
import { Ability, Badge, Breadcrumbs, Panel } from "@/components/ui";
import { type PlayerAnalysis, getPlayerAnalysis } from "@/lib/data";
import { classColor, compact, difficultyName, fightTime, percent, specLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

const weekLabel = (week: string) => week.split("-test")[0];

function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-xl font-semibold ${tone === "bad" ? "text-red-300" : tone === "good" ? "text-emerald-300" : "text-white"}`}>{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function NoBenchmark({ spec, boss }: { spec: string; boss: string }) {
  return (
    <p className="text-sm text-slate-400">
      We don't have top-player data for {spec} on {boss} yet. It's rebuilt every week from the top 15 players of each spec, so check back
      after the next update.
    </p>
  );
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

  const { report, fight, player, analysis, comparison, fixes, abilities, names, snapshotWeek, benchmarkWeek, topPlayer, playerCasts } = result;
  const durationMs = fight.endTime - fight.startTime;
  const pull = report.fights.filter((f) => f.encounterID === fight.encounterID && f.difficulty === fight.difficulty && f.id <= fight.id).length;
  const spec = specLabel(player.specKey, player.classSlug);
  const boss = `${fight.name} ${difficultyName(fight.difficulty)}`;
  const relevantDeaths = analysis.deaths.filter((d) => d.category !== "after-wipe");
  const amount = comparison?.amount?.player ?? null;
  const perfCount = (kinds: string[]) => comparison?.findings.filter((f) => kinds.includes(f.kind)).length ?? 0;
  const badge = (n: number) => (n ? String(n) : undefined);

  const tabs: Tab[] = [
    {
      id: "deaths",
      label: "Deaths",
      badge: badge(analysis.deaths.filter((d) => d.category === "early" || d.category === "wipe-start").length),
      content: (
        <>
          <p className="mb-3 text-sm text-slate-400">
            {analysis.wipe
              ? `${analysis.wipe.deaths} players died between ${fightTime(analysis.wipe.startMs)} and ${fightTime(analysis.wipe.endMs)}. Deaths before that matter most.`
              : `${analysis.raidDeaths.length} deaths in this pull.`}
          </p>
          <DeathTimeline deaths={analysis.raidDeaths} wipe={analysis.wipe} durationMs={durationMs} playerId={player.id} names={names} />
          <div className="mt-5 space-y-3">
            {relevantDeaths.length === 0 ? (
              <p className="text-sm text-emerald-300">You didn't die in this pull.</p>
            ) : (
              relevantDeaths.map((d) => <DeathDetails key={d.order} death={d} abilities={abilities} wipe={analysis.wipe} kill={!!fight.kill} />)
            )}
          </div>
        </>
      ),
    },
    {
      id: "damage-taken",
      label: "Damage taken",
      badge: badge(analysis.damageTaken.filter((a) => a.classification === "avoidable").length),
      content:
        analysis.damageTaken.length === 0 ? (
          <p className="text-sm text-slate-400">No boss damage taken.</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-slate-400">
              Boss damage you took, compared with what top players take
              {snapshotWeek ? ` (data from ${weekLabel(snapshotWeek)})` : ""}. Hover a label for details.
            </p>
            <div className="-mx-4 overflow-x-auto sm:mx-0">
              <table className="w-full min-w-[480px] text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium sm:pl-0">Ability</th>
                    <th className="px-2 py-2 font-medium">Type</th>
                    <th className="px-2 py-2 text-right font-medium">Hits</th>
                    <th className="px-2 py-2 text-right font-medium">Damage</th>
                    <th className="px-4 py-2 text-right font-medium sm:pr-0">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {analysis.damageTaken.map((a) => (
                    <tr key={a.abilityId} className={a.classification === "avoidable" ? "bg-red-500/5" : ""}>
                      <td className="px-4 py-2 sm:pl-0">
                        <Ability id={a.abilityId} name={abilities[a.abilityId]?.name} icon={abilities[a.abilityId]?.icon} />
                      </td>
                      <td className="px-2 py-2">
                        <AvoidabilityBadge value={a.classification} zeroShare={a.zeroShare} />
                      </td>
                      <td className="px-2 py-2 text-right text-slate-300">{a.hits}</td>
                      <td className="px-2 py-2 text-right text-slate-300">{compact(a.total)}</td>
                      <td className="px-4 py-2 text-right text-slate-400 sm:pr-0">{percent(a.share)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ),
    },
    {
      id: "rotation",
      label: "Rotation",
      badge: badge(perfCount(["low-casts", "missing-ability", "low-active-time"])),
      content: comparison ? <RotationTable comparison={comparison} abilities={abilities} /> : <NoBenchmark spec={spec} boss={boss} />,
    },
    {
      id: "buffs",
      label: "Buffs",
      badge: badge(perfCount(["low-buff-uptime"])),
      content: comparison ? <BuffTable comparison={comparison} abilities={abilities} /> : <NoBenchmark spec={spec} boss={boss} />,
    },
    {
      id: "targets",
      label: "Targets",
      badge: badge(perfCount(["low-target-share"])),
      content: comparison ? <TargetTable comparison={comparison} /> : <NoBenchmark spec={spec} boss={boss} />,
    },
    {
      id: "cooldowns",
      label: "Cooldowns",
      content:
        comparison && topPlayer ? (
          <CooldownTimeline comparison={comparison} abilities={abilities} playerCasts={playerCasts} playerDurationMs={durationMs} top={topPlayer} />
        ) : (
          <NoBenchmark spec={spec} boss={boss} />
        ),
    },
  ];

  return (
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

      <header>
        <h1 className="text-2xl font-bold sm:text-3xl" style={{ color: classColor(player.classSlug) }}>
          {player.name}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-slate-300">
          <span>{spec}</span>
          <span className="text-slate-600">·</span>
          <span>{boss}</span>
          {fight.kill ? <Badge tone="green">Kill</Badge> : <Badge tone="amber">Wipe at {fight.bossPercentage?.toFixed(1)}%</Badge>}
          <span className="text-sm text-slate-400">
            Pull {pull} · {fightTime(durationMs)}
          </span>
        </div>
      </header>

      {comparison && (
        <section>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {comparison.amount && (
              <Stat
                label="Your DPS"
                value={compact(comparison.amount.player)}
                sub={`${percent(comparison.amount.ratio)} of top median (${compact(comparison.amount.median)})`}
                tone={comparison.amount.ratio < 0.85 ? "bad" : comparison.amount.ratio >= 1 ? "good" : undefined}
              />
            )}
            <Stat
              label="Casting"
              value={percent(comparison.activeTime.player)}
              sub={`Top players: ${percent(comparison.activeTime.median)}`}
              tone={comparison.activeTime.player < comparison.activeTime.p25 ? "bad" : undefined}
            />
            <Stat
              label="Item level"
              value={comparison.itemLevel.player ?? "?"}
              sub={`Top players: ${Math.round(comparison.itemLevel.median)}`}
            />
            <Stat label="Fight length" value={fightTime(comparison.durationMs.player)} sub={`Top kills: ${fightTime(comparison.durationMs.median)}`} />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Compared with the top {comparison.sampleSize} {spec} players on {boss}
            {benchmarkWeek ? ` (${weekLabel(benchmarkWeek)})` : ""}. They usually have better gear and shorter kills, so use the gaps
            as direction, not exact targets.
            {comparison.insufficient && " Only a few top players were found, so these comparisons are rough."}
            {comparison.amount === null && " Healers are ranked by healing, so DPS isn't compared."}
          </p>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold text-white">Fix these first</h2>
        <p className="mb-3 text-sm text-slate-400">The most important things from this pull. Estimated gains are rough.</p>
        {fixes.length === 0 ? (
          <Panel>
            <p className="font-medium text-emerald-300">Clean pull!</p>
            <p className="mt-1 text-sm text-slate-300">
              You didn't die{analysis.hasAvoidabilityData ? ", took no avoidable damage" : ""}
              {comparison ? (comparison.amount ? ", and kept up with top players" : ", and your casting looks in line with top players") : ""}.
            </p>
          </Panel>
        ) : (
          <div className="grid gap-3">
            {fixes.slice(0, 3).map((fix, i) =>
              fix.source === "report" ? (
                <FindingCard key={i} finding={fix.finding} abilities={abilities} wipe={analysis.wipe} />
              ) : (
                <PerfFindingCard key={i} finding={fix.finding} abilities={abilities} amount={amount} />
              ),
            )}
          </div>
        )}
        {fixes.length > 3 && <p className="mt-2 text-sm text-slate-400">{fixes.length - 3} more in the tabs below.</p>}
        {!analysis.hasAvoidabilityData && !comparison && (
          <p className="mt-3 rounded-lg border border-line bg-panel/50 p-3 text-sm text-slate-400">
            We don't have top-player data for {boss} yet, so we can only show deaths. It's rebuilt every week from the top 15 players of
            each spec.
          </p>
        )}
      </section>

      <Panel>
        <Tabs tabs={tabs} />
      </Panel>

      <p className="text-sm text-slate-500">
        <a
          className="hover:text-slate-300 hover:underline"
          href={`https://www.warcraftlogs.com/reports/${code}#fight=${fight.id}&source=${player.id}`}
          target="_blank"
          rel="noreferrer"
        >
          Open this pull on Warcraft Logs ↗
        </a>
      </p>
    </div>
  );
}
