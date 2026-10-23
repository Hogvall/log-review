import { roleOf } from "@log-review/analysis";
import { DeathStoryView } from "./death-story";
import { DeathTimeline } from "./death-timeline";
import { AvoidabilityBadge, DeathDetails, DeathsSummary, RaidDeathsTable } from "./report";
import { Ability, Section, linkClass } from "./ui";
import type { PlayerAnalysis } from "@/lib/data";
import { compact, fightTime, percent } from "@/lib/format";

const weekLabel = (week: string) => week.split("-test")[0];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One player's deaths in one pull: the raid's death timeline and a death story per death that mattered. */
export function PullDeaths({ result }: { result: PlayerAnalysis }) {
  const { fight, player, analysis, deathStories, defensiveReviews, tips, bossGuide, abilities, names, classes } = result;
  const durationMs = fight.endTime - fight.startTime;
  const relevantDeaths = analysis.deaths.filter((d) => d.category !== "after-wipe");
  return (
    <div className="space-y-3">
      <DeathsSummary deaths={relevantDeaths} wipe={analysis.wipe} kill={!!fight.kill} />
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
    </div>
  );
}

/** One player's damage taken in one pull, by ability, labeled by what top players take. */
export function PullDamageTaken({ result }: { result: PlayerAnalysis }) {
  const { player, analysis, tips, bossGuide, abilities, snapshotWeek } = result;
  const isTank = !!player.specKey && roleOf(player.specKey) === "tank";
  return analysis.damageTaken.length === 0 ? (
          <p className="py-2 text-sm text-muted">No boss damage taken.</p>
        ) : (
          <>
            <p className="mb-2 text-sm text-muted">
              Labels compare with top {isTank ? "tanks (boss melee and tank busters show as tank mechanics)" : "players"}
              {snapshotWeek ? ` (${weekLabel(snapshotWeek)})` : ""}.
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
                        <AvoidabilityBadge
                          value={a.classification}
                          zeroShare={a.zeroShare}
                          fightShare={a.fightShare}
                          raidBreadth={a.raidBreadth}
                          tank={isTank}
                        />
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
        );
}

export function PullSurvival({ result }: { result: PlayerAnalysis }) {
  return (
    <>
      <Section title="Deaths this pull">
        <PullDeaths result={result} />
      </Section>
      <Section title="Damage taken this pull">
        <PullDamageTaken result={result} />
      </Section>
    </>
  );
}
