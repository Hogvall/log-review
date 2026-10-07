import type { ReactNode } from "react";
import { DeathStoryView } from "@/components/death-story";
import { ErrorPanel, NotFoundPanel } from "@/components/error-panel";
import { BuffTable, CooldownTimeline, PerfFindingCard, RotationTable, TargetTable } from "@/components/performance";
import { RememberCharacter } from "@/components/player-picker";
import { DeathTimeline } from "@/components/death-timeline";
import { Opener, PhaseActivityTable, PullStart } from "@/components/timeline";
import { AvoidabilityBadge, DeathDetails, DeathsSummary, FindingCard, RaidDeathsTable } from "@/components/report";
import { type Tab, Tabs } from "@/components/tabs";
import { Ability, Breadcrumbs, Section, linkClass } from "@/components/ui";
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

  const {
    report,
    fight,
    player,
    analysis,
    deathStories,
    defensiveReviews,
    consumables,
    tips,
    bossGuide,
    comparison,
    timeline,
    fixes,
    abilities,
    names,
    classes,
    snapshotWeek,
    benchmarkWeek,
    topPlayer,
    playerCasts,
    cooldownIds,
  } = result;
  const durationMs = fight.endTime - fight.startTime;
  const pull = report.fights.filter((f) => f.encounterID === fight.encounterID && f.difficulty === fight.difficulty && f.id <= fight.id).length;
  const spec = specLabel(player.specKey, player.classSlug);
  const boss = `${fight.name} ${difficultyName(fight.difficulty)}`;
  const relevantDeaths = analysis.deaths.filter((d) => d.category !== "after-wipe");
  const amount = comparison?.amount?.player ?? null;
  const perfCount = (kinds: string[]) => comparison?.findings.filter((f) => kinds.includes(f.kind)).length ?? 0;
  const badge = (n: number) => (n ? String(n) : undefined);
  const avoidabilityById = Object.fromEntries(analysis.damageTaken.map((a) => [a.abilityId, a.classification]));
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  const tabs: Tab[] = [
    {
      id: "deaths",
      label: "Deaths",
      badge: badge(analysis.deaths.filter((d) => d.category === "early" || d.category === "wipe-start").length),
      content: (
        <>
          <p className="mb-2 text-sm text-muted">
            {plural(analysis.raidDeaths.length, "raid death")} this pull
            {analysis.wipe
              ? `; the wipe was ${analysis.wipe.deaths} deaths between ${fightTime(analysis.wipe.startMs)} and ${fightTime(analysis.wipe.endMs)}.`
              : "."}
          </p>
          <DeathTimeline
            deaths={analysis.raidDeaths}
            wipe={analysis.wipe}
            durationMs={durationMs}
            playerId={player.id}
            names={names}
            classes={classes}
            abilityNames={Object.fromEntries(
              analysis.raidDeaths.flatMap((d) =>
                d.killingAbilityGameID && abilities[d.killingAbilityGameID]
                  ? [[d.killingAbilityGameID, abilities[d.killingAbilityGameID]!.name]]
                  : [],
              ),
            )}
          >
            <RaidDeathsTable
              deaths={analysis.raidDeaths}
              playerId={player.id}
              names={names}
              classes={classes}
              abilities={abilities}
              kill={!!fight.kill}
              wipe={analysis.wipe}
            />
          </DeathTimeline>
          <div className="mt-4">
            {relevantDeaths.length === 0 ? (
              <p className="border-t border-line py-3 text-sm text-heal">You didn't die.</p>
            ) : (
              relevantDeaths.map((d) =>
                deathStories[d.order] ? (
                  <DeathStoryView
                    key={d.order}
                    death={d}
                    story={deathStories[d.order]!}
                    abilities={abilities}
                    wipe={analysis.wipe}
                    kill={!!fight.kill}
                    actors={{ names, classes, selfId: player.id }}
                    review={defensiveReviews[d.order]}
                    tips={tips}
                    guide={bossGuide}
                  />
                ) : (
                  <DeathDetails key={d.order} death={d} abilities={abilities} wipe={analysis.wipe} kill={!!fight.kill} />
                ),
              )
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
          <p className="py-2 text-sm text-muted">No boss damage taken.</p>
        ) : (
          <>
            <p className="mb-2 text-sm text-muted">
              Labels compare with top players{snapshotWeek ? ` (${weekLabel(snapshotWeek)})` : ""}.
              {bossGuide && (
                <>
                  {" "}
                  Notes from the{" "}
                  <a href={bossGuide.url} target="_blank" rel="noreferrer" className={linkClass}>
                    Mythic Trap guide
                  </a>
                  .
                </>
              )}
            </p>
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="text-left text-[11px] uppercase tracking-[0.07em] text-faint">
                  <tr className="border-b border-line">
                    <th className="pb-1 pr-3 font-medium">Ability</th>
                    <th className="pb-1 pr-3 font-medium">Type</th>
                    <th className="pb-1 pr-3 text-right font-medium">Hits</th>
                    <th className="pb-1 pr-3 text-right font-medium">Damage</th>
                    <th className="pb-1 text-right font-medium">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.damageTaken.map((a) => (
                    <tr
                      key={a.abilityId}
                      className={`border-b border-line/40 ${a.classification === "avoidable" ? "shadow-[inset_2px_0_0_var(--color-dmg)]" : ""}`}
                    >
                      <td className="py-1.5 pr-3 pl-2">
                        <Ability id={a.abilityId} name={abilities[a.abilityId]?.name} icon={abilities[a.abilityId]?.icon} />
                        {tips[a.abilityId] && <span className="mt-0.5 block max-w-md text-xs text-muted">{tips[a.abilityId]!.tip}</span>}
                      </td>
                      <td className="py-1.5 pr-3">
                        <AvoidabilityBadge value={a.classification} zeroShare={a.zeroShare} />
                      </td>
                      <td className="num py-1.5 pr-3 text-right text-fg/85">{a.hits}</td>
                      <td className="num py-1.5 pr-3 text-right text-fg/85">{compact(a.total)}</td>
                      <td className="num py-1.5 text-right text-muted">{percent(a.share)}</td>
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
      content: comparison ? <RotationTable comparison={comparison} abilities={abilities} /> : <NoBenchmark />,
    },
    {
      id: "buffs",
      label: "Buffs",
      badge: badge(perfCount(["low-buff-uptime"])),
      content: comparison ? <BuffTable comparison={comparison} abilities={abilities} /> : <NoBenchmark />,
    },
    {
      id: "targets",
      label: "Targets",
      badge: badge(perfCount(["low-target-share"])),
      content: comparison ? <TargetTable comparison={comparison} /> : <NoBenchmark />,
    },
    {
      id: "timeline",
      label: "Timeline",
      badge: badge(perfCount(["late-cooldown", "idle-time"])),
      content: (
        <div className="space-y-6">
          {topPlayer ? (
            <p className="text-sm text-muted">
              {timeline.sampleSize ? (
                <>
                  Compared with the median of {timeline.sampleSize} top players of your spec, with{" "}
                  <span className="text-fg">{topPlayer.name}</span> (#1) shown for reference.
                </>
              ) : (
                <>
                  Compared with <span className="text-fg">{topPlayer.name}</span>, the #1 player of your spec on this boss. One kill can
                  differ in strategy, so read gaps as something to check rather than a rule.
                </>
              )}
            </p>
          ) : (
            <NoBenchmark />
          )}
          <PullStart timeline={timeline} abilities={abilities} />
          <Opener timeline={timeline} abilities={abilities} topName={topPlayer?.name ?? null} />
          <PhaseActivityTable timeline={timeline} />
          {comparison && topPlayer && (
            <div>
              <h3 className="mb-2 font-medium text-fg">DPS cooldowns over the fight</h3>
              <CooldownTimeline cooldownIds={cooldownIds} abilities={abilities} playerCasts={playerCasts} playerDurationMs={durationMs} top={topPlayer} />
            </div>
          )}
        </div>
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
          {plural(consumables.combatPotions, "combat potion")} · {plural(consumables.healthstones, "healthstone")} ·{" "}
          {plural(consumables.healthPotions, "health potion")}
          {consumables.manaPotions > 0 && ` · ${plural(consumables.manaPotions, "mana potion")}`}
          {consumables.combatPotions === 0 && <span className="text-warn"> · no combat potion (most raiders use 2)</span>}
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
                    <>
                      <span title={`Median of the ${comparison.amount.similar.n} top players whose kills were closest in length to this pull. Longer fights mean lower DPS for everyone.`}>
                        {percent(comparison.amount.ratio)} of {compact(comparison.amount.similar.median)}: top kills of{" "}
                        {comparison.amount.similar.minMs === comparison.amount.similar.maxMs
                          ? fightTime(comparison.amount.similar.minMs)
                          : `${fightTime(comparison.amount.similar.minMs)}–${fightTime(comparison.amount.similar.maxMs)}`}
                      </span>
                      <br />
                      <span className="text-faint">
                        {percent(comparison.amount.player / comparison.amount.median)} of all top {comparison.sampleSize} ({compact(comparison.amount.median)})
                      </span>
                    </>
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

      <Section title="Top issues" meta={fixes.length > 3 ? `${fixes.length - 3} more in the tabs` : undefined}>
        <div className="pb-2">
          <DeathsSummary deaths={relevantDeaths} wipe={analysis.wipe} kill={!!fight.kill} />
        </div>
        {fixes.length === 0 ? (
          <p className="pb-3 text-sm text-heal">
            Nothing to flag: no deaths{analysis.hasAvoidabilityData ? ", no avoidable damage" : ""}
            {comparison ? (comparison.amount ? ", on pace with top players" : ", casting in line with top players") : ""}.
          </p>
        ) : (
          <ol>
            {fixes.slice(0, 3).map((fix, i) =>
              fix.source === "report" ? (
                <FindingCard
                  key={i}
                  index={i + 1}
                  finding={fix.finding}
                  abilities={abilities}
                  wipe={analysis.wipe}
                  stories={deathStories}
                  avoidability={avoidabilityById}
                  reviews={defensiveReviews}
                  tips={tips}
                />
              ) : (
                <PerfFindingCard key={i} index={i + 1} finding={fix.finding} abilities={abilities} amount={amount} />
              ),
            )}
          </ol>
        )}
        {!analysis.hasAvoidabilityData && !comparison && (
          <p className="pb-3 text-xs text-faint">No top-player data for {boss} yet (updated weekly), so only deaths are analyzed.</p>
        )}
      </Section>

      <Tabs tabs={tabs} />

      <p className="border-t border-line pt-3 text-xs">
        <a
          className={linkClass}
          href={`https://www.warcraftlogs.com/reports/${code}#fight=${fight.id}&source=${player.id}`}
          target="_blank"
          rel="noreferrer"
        >
          Open on Warcraft Logs
        </a>
      </p>
    </div>
  );
}
