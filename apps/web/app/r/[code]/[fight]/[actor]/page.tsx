import { ErrorPanel, NotFoundPanel } from "@/components/error-panel";
import { RememberCharacter } from "@/components/player-picker";
import { AvoidabilityBadge, DeathDetails, DeathTimeline, FindingCard } from "@/components/report";
import { Ability, Badge, Breadcrumbs, Panel, SectionTitle } from "@/components/ui";
import { type PlayerAnalysis, getPlayerAnalysis } from "@/lib/data";
import { classColor, compact, difficultyName, fightTime, percent, specLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PlayerPage({ params }: { params: Promise<{ code: string; fight: string; actor: string }> }) {
  const { code, fight: fightParam, actor: actorParam } = await params;

  let result: PlayerAnalysis | null;
  try {
    result = await getPlayerAnalysis(code, Number(fightParam), Number(actorParam));
  } catch (error) {
    return <ErrorPanel error={error} />;
  }
  if (!result) return <NotFoundPanel what="Player or pull" />;

  const { report, fight, player, analysis, abilities, names, snapshotWeek } = result;
  const durationMs = fight.endTime - fight.startTime;
  const pull = report.fights.filter((f) => f.encounterID === fight.encounterID && f.difficulty === fight.difficulty && f.id <= fight.id).length;
  const top = analysis.findings.slice(0, 3);
  const relevantDeaths = analysis.deaths.filter((d) => d.category !== "after-wipe");

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
          <span>{specLabel(player.specKey, player.classSlug)}</span>
          <span className="text-slate-600">·</span>
          <span>
            {fight.name} {difficultyName(fight.difficulty)}
          </span>
          {fight.kill ? <Badge tone="green">Kill</Badge> : <Badge tone="amber">Wipe at {fight.bossPercentage?.toFixed(1)}%</Badge>}
          <span className="text-sm text-slate-400">
            Pull {pull} · {fightTime(durationMs)}
          </span>
        </div>
      </header>

      <section>
        <SectionTitle hint="The most important things from this pull, most important first.">Fix these first</SectionTitle>
        {top.length === 0 ? (
          <Panel>
            <p className="font-medium text-emerald-300">Clean pull!</p>
            <p className="mt-1 text-sm text-slate-300">
              You didn't die{analysis.hasAvoidabilityData ? " and took no avoidable damage" : ""}.
            </p>
          </Panel>
        ) : (
          <div className="grid gap-3">
            {top.map((f, i) => (
              <FindingCard key={i} finding={f} abilities={abilities} wipe={analysis.wipe} />
            ))}
          </div>
        )}
        {!analysis.hasAvoidabilityData && (
          <p className="mt-3 rounded-lg border border-line bg-panel/50 p-3 text-sm text-slate-400">
            We don't have top-player data for {fight.name} {difficultyName(fight.difficulty)} yet, so we can't say which abilities were
            avoidable. It's rebuilt every week from the top 15 players of each spec.
          </p>
        )}
      </section>

      <Panel>
        <SectionTitle
          hint={
            analysis.wipe
              ? `${analysis.wipe.deaths} players died between ${fightTime(analysis.wipe.startMs)} and ${fightTime(analysis.wipe.endMs)}. Deaths before that matter most.`
              : `${analysis.raidDeaths.length} deaths in this pull.`
          }
        >
          Deaths
        </SectionTitle>
        <DeathTimeline
          deaths={analysis.raidDeaths}
          wipe={analysis.wipe}
          durationMs={durationMs}
          playerId={player.id}
          names={names}
        />
        <div className="mt-5 space-y-3">
          {relevantDeaths.length === 0 ? (
            <p className="text-sm text-emerald-300">You didn't die in this pull.</p>
          ) : (
            relevantDeaths.map((d) => (
              <DeathDetails key={d.order} death={d} abilities={abilities} wipe={analysis.wipe} kill={!!fight.kill} />
            ))
          )}
        </div>
      </Panel>

      <Panel>
        <SectionTitle
          hint={`Boss damage you took, compared with what top players take${snapshotWeek ? ` (data from ${snapshotWeek.split("-test")[0]})` : ""}. Hover a label for details.`}
        >
          Damage taken
        </SectionTitle>
        {analysis.damageTaken.length === 0 ? (
          <p className="text-sm text-slate-400">No boss damage taken.</p>
        ) : (
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
                {analysis.damageTaken.map((a) => {
                  const info = abilities[a.abilityId];
                  return (
                    <tr key={a.abilityId} className={a.classification === "avoidable" ? "bg-red-500/5" : ""}>
                      <td className="px-4 py-2 sm:pl-0">
                        <Ability id={a.abilityId} name={info?.name} icon={info?.icon} />
                      </td>
                      <td className="px-2 py-2">
                        <AvoidabilityBadge value={a.classification} zeroShare={a.zeroShare} />
                      </td>
                      <td className="px-2 py-2 text-right text-slate-300">{a.hits}</td>
                      <td className="px-2 py-2 text-right text-slate-300">{compact(a.total)}</td>
                      <td className="px-4 py-2 text-right text-slate-400 sm:pr-0">{percent(a.share)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
