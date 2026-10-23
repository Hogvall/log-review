import Link from "next/link";
import { ErrorPanel, NotFoundPanel } from "@/components/error-panel";
import { RaidHeader, scopeLabel } from "@/components/raid";
import { AvoidabilityBadge } from "@/components/report";
import { PullSurvival } from "@/components/survival";
import { Ability, Section } from "@/components/ui";
import { type PlayerAnalysis, getPlayerAnalysis } from "@/lib/data";
import { type RaidPlayerView, getRaidPlayer, parseScope } from "@/lib/raid";
import { classColor, compact, fightTime, percent, specLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

const th = "pb-1 pr-3 font-medium";
const theadClass = "text-left text-[11px] uppercase tracking-[0.07em] text-faint";

const CATEGORY: Record<string, { label: string; tone: string }> = {
  early: { label: "before the wipe", tone: "text-dmg" },
  "wipe-start": { label: "started the wipe", tone: "text-warn" },
  wipe: { label: "in the wipe", tone: "text-faint" },
  "after-wipe": { label: "after the wipe", tone: "text-faint" },
};

/** One player over a scope of pulls: their deaths, what hit them and how much of it was avoidable. */
export default async function RaidPlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string; boss: string; actor: string }>;
  searchParams: Promise<{ scope?: string }>;
}) {
  const { code, boss, actor } = await params;
  const { scope: scopeParamValue } = await searchParams;
  const [encounterId, difficulty] = boss.split("-").map(Number);
  if (!encounterId || !difficulty) return <NotFoundPanel what="Boss" />;
  const scope = parseScope(scopeParamValue);

  let data: RaidPlayerView | null;
  let pull: PlayerAnalysis | null = null;
  try {
    data = await getRaidPlayer(code, encounterId, difficulty, scope, Number(actor));
    // One pull: the full death stories and damage table from the pull's analysis.
    if (data && scope.kind === "pull") pull = await getPlayerAnalysis(code, scope.fightId, Number(actor));
  } catch (error) {
    return <ErrorPanel error={error} />;
  }
  if (!data) return <NotFoundPanel what="Player" />;
  const { view, player, deaths, abilities, perPull } = data;
  const several = view.scoped.length > 1;
  const base = `/r/${code}/raid/${boss}/players/${player.id}`;
  const mattered = deaths.filter((d) => d.mattered);
  const totalTaken = abilities.reduce((s, a) => s + a.total, 0);
  const maxAvoidable = Math.max(1, ...perPull.map((p) => p.avoidable));

  return (
    <div className="space-y-6">
      <RaidHeader view={view} code={code} page="players" actor={{ id: player.id, name: player.name }} />

      <div className="border-l-[3px] pl-3" style={{ borderColor: classColor(player.classSlug) }}>
        <p className="font-semibold" style={{ color: classColor(player.classSlug) }}>
          {player.name} <span className="text-sm font-normal text-muted">{specLabel(player.specKey, player.classSlug)}</span>
        </p>
        <p className="text-sm text-muted">
          <span className={mattered.length ? "text-dmg" : "text-heal"}>
            {mattered.length} {mattered.length === 1 ? "death" : "deaths"} that mattered
          </span>{" "}
          over {scopeLabel(view)} · <span className="num">{compact(player.avoidable)}</span> avoidable damage
          {several && (
            <>
              {" "}
              (<span className="num">{compact(player.avoidablePerPull)}</span> per pull)
            </>
          )}
          {player.ratio != null && (
            <>
              {" "}
              · DPS <span className={`num ${player.ratio < 0.8 ? "text-dmg" : ""}`}>{percent(player.ratio)}</span> of top players
            </>
          )}
        </p>
        {scope.kind === "pull" && (
          <p className="text-xs">
            <Link href={`/r/${code}/${scope.fightId}/${player.id}`} className="text-faint hover:text-fg">
              Opener, cooldowns, potions and rotation for this pull →
            </Link>
          </p>
        )}
      </div>

      {several && (
        <Section title="Pull by pull" meta="click a pull for the full death story">
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead className={theadClass}>
                <tr className="border-b border-line">
                  <th className={th}>Pull</th>
                  <th className={`${th} text-right`}>Result</th>
                  <th className={th}>Died</th>
                  <th className={`${th} w-44`}>Avoidable damage</th>
                </tr>
              </thead>
              <tbody>
                {[...perPull].reverse().map((p) => (
                  <tr key={p.pull.id} className="border-b border-line/40 hover:bg-panel">
                    <td className="py-1 pr-3">
                      <Link href={`${base}?scope=${p.pull.id}`} className="num text-fg hover:underline">
                        Pull {p.pull.pull}
                      </Link>
                    </td>
                    <td className="num py-1 pr-3 text-right">{p.pull.kill ? <span className="text-heal">kill</span> : <span className="text-muted">{p.pull.bossPercentage?.toFixed(1)}%</span>}</td>
                    <td className="py-1 pr-3 text-xs">
                      {p.deaths.length === 0 ? (
                        <span className="text-faint">–</span>
                      ) : (
                        p.deaths.map((d, i) => (
                          <span key={i} className={CATEGORY[d.category]!.tone}>
                            {i > 0 && ", "}
                            <span className="num">{fightTime(d.fightTimeMs)}</span> {d.cause?.name ?? "unknown"}
                          </span>
                        ))
                      )}
                    </td>
                    <td className="py-1 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="h-2 flex-1 bg-line">
                          <span className="block h-full bg-dmg" style={{ width: `${(p.avoidable / maxAvoidable) * 100}%` }} />
                        </span>
                        <span className="num w-12 text-right text-fg/85">{p.avoidable ? compact(p.avoidable) : "–"}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {several && (
        <Section title="Deaths" meta={`${deaths.length} in total`}>
          {deaths.length === 0 ? (
            <p className="py-2 text-sm text-heal">No deaths in {scopeLabel(view)}.</p>
          ) : (
            <ul className="max-w-2xl text-sm">
              {deaths.map((d, i) => {
                const p = view.pulls.find((x) => x.id === d.fight);
                const c = CATEGORY[d.category]!;
                return (
                  <li key={i} className="grid grid-cols-[4.5rem_4rem_minmax(0,1fr)_8rem] items-baseline gap-3 border-b border-line/40 py-1">
                    <Link href={`${base}?scope=${d.fight}`} className="num text-muted hover:text-fg">
                      Pull {p?.pull}
                    </Link>
                    <span className="num text-fg/85">{fightTime(d.fightTimeMs)}</span>
                    <span className="truncate">{d.cause ? <Ability id={d.cause.id} name={d.cause.name} icon={view.abilities[d.cause.id]?.icon} /> : "unknown"}</span>
                    <span className={`text-right text-xs ${c.tone}`}>{c.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      )}

      {pull ? (
        <PullSurvival result={pull} />
      ) : (
        <Section title="Damage taken" meta={several ? `over ${view.scoped.length} pulls` : undefined}>
          {abilities.length === 0 ? (
            <p className="py-2 text-sm text-muted">No boss damage taken.</p>
          ) : (
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[560px] text-sm">
                <thead className={theadClass}>
                  <tr className="border-b border-line">
                    <th className={th}>Ability</th>
                    <th className={th}>Type</th>
                    <th className={`${th} text-right`}>Hits</th>
                    <th className={`${th} text-right`}>Pulls</th>
                    <th className={`${th} text-right`}>Damage</th>
                    <th className="pb-1 text-right font-medium">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {abilities.slice(0, 25).map((a) => (
                    <tr key={a.abilityId} className={`border-b border-line/40 ${a.classification === "avoidable" ? "shadow-[inset_2px_0_0_var(--color-dmg)]" : ""}`}>
                      <td className="py-1.5 pr-3 pl-2">
                        <Ability id={a.abilityId} name={view.abilities[a.abilityId]?.name} icon={view.abilities[a.abilityId]?.icon} />
                        {view.tips[a.abilityId] && <span className="mt-0.5 block max-w-md text-xs text-muted">{view.tips[a.abilityId]!.tip}</span>}
                      </td>
                      <td className="py-1.5 pr-3">
                        <AvoidabilityBadge value={a.classification} tank={player.role === "tank"} />
                      </td>
                      <td className="num py-1.5 pr-3 text-right text-fg/85">{a.hits}</td>
                      <td className="num py-1.5 pr-3 text-right text-muted">{a.pulls}</td>
                      <td className="num py-1.5 pr-3 text-right text-fg/85">{compact(a.total)}</td>
                      <td className="num py-1.5 text-right text-muted">{percent(totalTaken ? a.total / totalTaken : 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
