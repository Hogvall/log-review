import Link from "next/link";
import type { TopTimeline } from "@log-review/analysis";
import { ErrorPanel, NotFoundPanel } from "@/components/error-panel";
import { BuffTable, PerfFindingCard, RotationTable, TargetTable } from "@/components/performance";
import {
  AvailabilityView,
  CastListView,
  CooldownTable,
  EventTrackView,
  Hero,
  IconLanesView,
  NextPulls,
  OpenerTable,
  PotionLanes,
  SideBySideView,
  SpellLanes,
  type TrackPin,
  summarizeFinding,
} from "@/components/personal";
import { RememberCharacter } from "@/components/player-picker";
import { FirstUseTable, PhaseActivityTable, PullStart } from "@/components/timeline";
import { TimelineSwitch } from "@/components/timeline-switch";
import { type Tab, Tabs } from "@/components/tabs";
import { Breadcrumbs, Section, linkClass } from "@/components/ui";
import { type PlayerAnalysis, getPlayerAnalysis } from "@/lib/data";
import { classColor, compact, difficultyName, fightTime, percent, specLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

const weekLabel = (week: string) => week.split("-test")[0];

function NoBenchmark() {
  return <p className="py-2 text-sm text-muted">No top-player data for this spec and boss yet. It updates weekly.</p>;
}

/** "More Phoenix Flames" reads as "more Phoenix Flames" mid-sentence; spell names keep their capitals. */
const midSentence = (title: string) => (/^(More|Use|Keep|Cast|Fewer)\b/.test(title) ? title[0]!.toLowerCase() + title.slice(1) : title);

export default async function PlayerPage({ params }: { params: Promise<{ code: string; fight: string; actor: string }> }) {
  const { code, fight: fightParam, actor: actorParam } = await params;

  let result: PlayerAnalysis | null;
  try {
    result = await getPlayerAnalysis(code, Number(fightParam), Number(actorParam));
  } catch (error) {
    return <ErrorPanel error={error} />;
  }
  if (!result) return <NotFoundPanel what="Player or pull" />;

  const { report, fight, player, analysis, comparison, timeline, abilities, benchmarkWeek, topPlayer, tops, playerCasts, cooldownIds, potions } = result;
  const durationMs = fight.endTime - fight.startTime;
  const pull = report.fights.filter((f) => f.encounterID === fight.encounterID && f.difficulty === fight.difficulty && f.id <= fight.id).length;
  const spec = specLabel(player.specKey, player.classSlug);
  const boss = `${fight.name} ${difficultyName(fight.difficulty)}`;
  const amount = comparison?.amount?.player ?? null;
  const findings = comparison?.findings ?? [];
  const summaries = findings.map((f) => summarizeFinding(f, abilities, amount));
  const count = (kinds: string[]) => findings.filter((f) => kinds.includes(f.kind)).length;
  const badge = (n: number) => (n ? String(n) : undefined);
  const raidHref = fight.difficulty ? `/r/${code}/raid/${fight.encounterID}-${fight.difficulty}/players/${player.id}?scope=${fight.id}` : `/r/${code}?view=raid`;
  const myDeaths = analysis.deaths.filter((d) => d.category === "early" || d.category === "wipe-start");
  // The #1 player to compare cast by cast with: the first stored top timeline, or the benchmark's #1.
  const top1: TopTimeline | null = tops[0] ?? (topPlayer ? { rank: 1, name: topPlayer.name, durationMs: topPlayer.durationMs, casts: topPlayer.timeline } : null);
  const span = Math.max(durationMs, top1?.durationMs ?? 0);

  // The verdict: the two findings worth the most.
  const worth = summaries.filter((s) => s.gainShare != null).slice(0, 2);
  const worthTotal = worth.reduce((sum, s) => sum + s.gainShare!, 0);
  const verdict = !comparison ? (
    <>No top-player data for {boss} yet, so there&apos;s nothing to compare your casts with. It updates weekly.</>
  ) : summaries.length === 0 ? (
    <>Nothing to flag: {comparison.amount ? "on pace with top players" : "casting in line with top players"}.</>
  ) : worth.length ? (
    <>
      {worth.length === 2 ? <strong className="text-gold">Two things</strong> : <strong className="text-gold">One thing</strong>} {worth.length === 2 ? "are" : "is"} worth about{" "}
      {(worthTotal * 100).toFixed(1)}% damage: {worth.map((s) => midSentence(s.title)).join(", and ")}.
    </>
  ) : (
    <>
      Start with <strong className="text-gold">{midSentence(summaries[0]!.title)}</strong>.
    </>
  );

  const ratio = comparison?.amount?.ratio ?? null;
  const meters = comparison
    ? [
        ...(comparison.amount ? [{ label: "DPS vs top", value: percent(comparison.amount.ratio), share: comparison.amount.ratio, color: comparison.amount.ratio < 0.85 ? "var(--color-dmg)" : "var(--color-heal)" }] : []),
        { label: "Casting", value: `${percent(comparison.activeTime.player)} / ${percent(comparison.activeTime.median)}`, share: comparison.activeTime.player, color: "var(--color-gold)" },
        ...(potions.top ? [{ label: "Potions", value: `${potions.yours.length} / 2`, share: potions.yours.length / 2, color: "var(--color-debuff)" }] : []),
        ...(comparison.itemLevel.player
          ? [{ label: "Item level", value: `${comparison.itemLevel.player} / ${Math.round(comparison.itemLevel.median)}`, share: comparison.itemLevel.player / comparison.itemLevel.median, color: "var(--color-heal)" }]
          : []),
      ]
    : [];

  // D: only the moments that matter. Cooldown uses (the first one flagged when late), potions, a missing
  // second potion, the longest idle stretches and deaths.
  const late = new Set(timeline.findings.flatMap((f) => (f.kind === "late-cooldown" ? [f.abilityId] : [])));
  const pins: TrackPin[] = [
    ...result.cooldownLanes.flatMap((l) =>
      l.used.map(([t], i) => ({
        ms: t,
        label: `${abilities[l.abilityId]?.name ?? "Cooldown"}${i === 0 && late.has(l.abilityId) ? " (late)" : ""}`,
        tone: (i === 0 && late.has(l.abilityId) ? "bad" : "cooldown") as TrackPin["tone"],
      })),
    ),
    ...potions.yours.map(([t]) => ({ ms: t, label: "Potion", tone: "cooldown" as const })),
    ...(potions.top && potions.top.usedTwo >= 0.5 && potions.yours.length < 2 && potions.top.second
      ? [{ ms: potions.top.second.median, label: "No 2nd potion", tone: "bad" as const }]
      : []),
    ...[...timeline.gaps]
      .sort((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs))
      .slice(0, 2)
      .map((g) => ({ ms: g.startMs, label: `Idle ${Math.round((g.endMs - g.startMs) / 1000)}s`, tone: "bad" as const })),
    ...myDeaths.map((d) => ({ ms: d.fightTimeMs, label: "Died", tone: "bad" as const })),
  ];
  const activeMs = Object.fromEntries(result.cooldownLanes.map((l) => [l.abilityId, l.used[0] ? l.used[0][1] - l.used[0][0] : 0]));

  const tabs: Tab[] = [
    {
      id: "opener",
      label: "Opener",
      badge: badge(count(["late-cooldown"]) + result.openerSteps.filter((s) => s.match === false).length),
      content: (
        <div className="space-y-6">
          <PullStart timeline={timeline} abilities={abilities} />
          <OpenerTable steps={result.openerSteps} abilities={abilities} topName={top1?.name ?? null} cooldownIds={cooldownIds} />
          <FirstUseTable timeline={timeline} abilities={abilities} />
        </div>
      ),
    },
    {
      id: "cooldowns",
      label: "Cooldowns",
      badge: badge(findings.filter((f) => f.kind === "low-casts" && f.ability.benchmark.median <= 2).length),
      content: <CooldownTable cooldownIds={cooldownIds} you={playerCasts} top={top1} comparison={comparison} abilities={abilities} />,
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
            <h3 className="mb-2 font-bold text-fg">Buff uptime</h3>
            <BuffTable comparison={comparison} abilities={abilities} />
          </div>
          <div>
            <h3 className="mb-2 font-bold text-fg">Targets</h3>
            <TargetTable comparison={comparison} />
          </div>
        </div>
      ) : (
        <NoBenchmark />
      ),
    },
    {
      id: "casts",
      label: "Every spell",
      content: <SpellLanes you={playerCasts} top={top1} durationMs={durationMs} cooldownIds={cooldownIds} utilityIds={result.utilityIds} abilities={abilities} />,
    },
  ];

  return (
    <div className="space-y-5">
      <RememberCharacter name={player.name} />
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: report.title, href: `/r/${code}?view=personal` },
          { label: `${fight.name} pull ${pull}`, href: `/r/${code}/${fight.id}` },
          { label: player.name },
        ]}
      />

      <Hero
        name={player.name}
        color={classColor(player.classSlug)}
        subtitle={`${spec}${comparison?.itemLevel.player ? ` · ${comparison.itemLevel.player} ilvl` : ""}`}
        facts={
          <>
            Pull {pull} — {boss} — {fight.kill ? <span className="text-heal">kill</span> : <span className="text-warn">wipe {fight.bossPercentage?.toFixed(1)}%</span>} — {fightTime(durationMs)}
            {comparison?.amount && <> — {compact(comparison.amount.player)} dps</>}
          </>
        }
        ratio={ratio}
        verdict={verdict}
        meters={meters}
      />

      {myDeaths.length > 0 && (
        <p className="border border-dmg/40 bg-panel px-4 py-2.5 text-sm">
          <span className="text-dmg">You died at {myDeaths.map((d) => fightTime(d.fightTimeMs)).join(", ")}.</span>{" "}
          <Link href={raidHref} className={linkClass}>
            See why in the raid view
          </Link>
        </p>
      )}

      <NextPulls items={summaries.slice(0, 3)} abilities={abilities} />

      {findings.length > 3 && (
        <Section title="More rotation mistakes" meta={`${findings.length - 3} more, biggest gain first`}>
          <details>
            <summary className="cursor-pointer pb-2 text-sm text-muted hover:text-fg">Show them</summary>
            <ol>
              {findings.slice(3).map((f, i) => (
                <PerfFindingCard key={i} index={i + 4} finding={f} abilities={abilities} amount={amount} />
              ))}
            </ol>
          </details>
        </Section>
      )}

      <TimelineSwitch
        views={{
          list: <CastListView you={playerCasts} top={top1} abilities={abilities} />,
          lanes: <IconLanesView you={playerCasts} tops={tops} cooldownIds={cooldownIds} activeMs={activeMs} abilities={abilities} />,
          spine: <SideBySideView steps={result.openerSteps.slice(0, 12)} abilities={abilities} players={tops.length} />,
          availability: <AvailabilityView lanes={result.cooldownLanes} spanMs={span} abilities={abilities} topName={top1?.name ?? null} />,
          events: <EventTrackView phases={result.phases} pins={pins} spanMs={durationMs} />,
        }}
      />

      <PotionLanes potions={potions} durationMs={durationMs} abilities={abilities} />

      <Section title="Details">
        <Tabs tabs={tabs} />
      </Section>

      <p className="text-xs text-muted">
        {comparison && (
          <>
            Compared with the top {comparison.sampleSize} {spec} on {boss}
            {benchmarkWeek ? `, ${weekLabel(benchmarkWeek)}` : ""}. Top players have better gear and shorter kills; read gaps as direction.
            {comparison.insufficient && " Small sample."}{" "}
          </>
        )}
        <a className={linkClass} href={`https://www.warcraftlogs.com/reports/${code}#fight=${fight.id}&source=${player.id}`} target="_blank" rel="noreferrer">
          Open on Warcraft Logs
        </a>
      </p>
    </div>
  );
}
