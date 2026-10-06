import type { DeathStory, PlayerDeath, StoryEntry, WipeEvent } from "@log-review/analysis";
import type { AbilityInfo } from "./report";
import { Ability, Badge, type Tone } from "./ui";
import { beforeDeath, compact, fightTime, fightTimePrecise, ordinal, percent } from "@/lib/format";

const CATEGORY: Record<PlayerDeath["category"], { label: string; tone: Tone }> = {
  early: { label: "Before the wipe", tone: "red" },
  "wipe-start": { label: "Start of the wipe", tone: "red" },
  wipe: { label: "During the wipe", tone: "slate" },
  "after-wipe": { label: "After the wipe", tone: "slate" },
};

function HealthGraph({ story }: { story: DeathStory }) {
  const W = 300;
  const H = 80;
  const x = (beforeDeathMs: number) => ((story.windowMs - beforeDeathMs) / story.windowMs) * W;
  const y = (hp: number) => (1 - hp) * (H - 4) + 2;
  const points = story.entries.filter((e) => e.hpAfter != null).map((e) => `${x(e.kind === "healing" ? e.endBeforeDeathMs : e.beforeDeathMs)},${y(e.hpAfter!)}`);
  const burstX = x(story.burst.beforeDeathMs);
  return (
    <div>
      <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-1 text-[10px] text-slate-500">
        <div className="flex flex-col justify-between py-0.5 text-right">
          <span>100%</span>
          <span>50%</span>
          <span>0%</span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-24 w-full rounded bg-ink" role="img" aria-label="Your health over the seconds before death">
          <line x1="0" x2={W} y1={y(0.5)} y2={y(0.5)} stroke="#1f2937" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          <rect x={burstX} y="0" width={W - burstX} height={H} fill="rgb(239 68 68 / 0.12)" />
          {points.length > 1 && (
            <polyline points={points.join(" ")} fill="none" stroke="#f5b041" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          )}
          {story.entries
            .filter((e): e is Extract<StoryEntry, { kind: "damage" }> => e.kind === "damage" && e.big && e.hpAfter != null)
            .map((e, i) => (
              <circle key={i} cx={x(e.beforeDeathMs)} cy={y(e.hpAfter!)} r="3.5" fill="#f87171" />
            ))}
        </svg>
      </div>
      <div className="ml-[2.75rem] mt-1 flex justify-between text-[10px] text-slate-500">
        <span>{beforeDeath(story.windowMs)}</span>
        <span className="text-red-300">the drop</span>
        <span>death</span>
      </div>
    </div>
  );
}

function HealthBar({ hp }: { hp: number | null }) {
  if (hp == null) return <span className="text-slate-600">–</span>;
  const color = hp > 0.5 ? "bg-emerald-400" : hp > 0.25 ? "bg-amber-400" : "bg-red-400";
  return (
    <span className="flex items-center justify-end gap-2">
      <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-line sm:block">
        <span className={`block h-full ${color}`} style={{ width: percent(hp) }} />
      </span>
      <span className="w-9 text-right tabular-nums">{percent(hp)}</span>
    </span>
  );
}

function EventRows({ entries, abilities, maxHp }: { entries: StoryEntry[]; abilities: AbilityInfo; maxHp: number | null }) {
  return (
    <>
      {entries.map((e, i) => (
        <tr key={i} className={e.kind === "damage" && e.big ? "bg-red-500/10" : ""}>
          <td className="py-1.5 pr-2 tabular-nums text-slate-400">{fightTimePrecise(e.fightTimeMs)}</td>
          <td className="hidden py-1.5 pr-2 tabular-nums text-slate-500 sm:table-cell">{beforeDeath(e.beforeDeathMs)}</td>
          <td className="py-1.5 pr-2">
            {e.kind === "damage" ? (
              <span className="flex flex-wrap items-center gap-x-2">
                <Ability id={e.abilityId} name={abilities[e.abilityId]?.name} icon={abilities[e.abilityId]?.icon} />
                {e.killingBlow && <span className="text-xs text-red-300">killing blow</span>}
                {e.big && maxHp && <span className="text-xs text-red-300">big hit ({percent(e.amount / maxHp)} of your health)</span>}
              </span>
            ) : (
              <span className="text-emerald-300/90">
                Healing{e.count > 1 ? ` (${e.count} heals)` : ""}
              </span>
            )}
          </td>
          <td className={`py-1.5 pr-2 text-right tabular-nums ${e.kind === "damage" ? "text-red-300" : "text-emerald-300"}`}>
            {e.kind === "damage" ? "−" : "+"}
            {compact(e.amount)}
          </td>
          <td className="py-1.5 text-right text-slate-300">
            <HealthBar hp={e.hpAfter} />
          </td>
        </tr>
      ))}
    </>
  );
}

function Summary({ story, abilities }: { story: DeathStory; abilities: AbilityInfo }) {
  const { burst, killingBlow } = story;
  const seconds = (burst.beforeDeathMs / 1000).toFixed(1);
  const top = burst.damage.slice(0, 4);
  const name = (id: number) => abilities[id]?.name ?? `Spell ${id}`;
  const lowHealing = burst.healing < burst.totalDamage * 0.25;
  return (
    <div className="rounded-lg border-l-4 border-red-400 bg-ink/60 p-4">
      <p className="text-lg font-semibold text-white">
        {story.lowWholeWindow
          ? `You were below 75% health for the whole ${story.windowMs / 1000} seconds before dying`
          : `${burst.startHp != null ? percent(burst.startHp) : "Healthy"} → dead in ${seconds} seconds`}
      </p>

      {top.length > 0 && (
        <div className="mt-2 text-sm text-slate-300">
          <span>{story.lowWholeWindow ? "What hit you:" : `What hit you in those ${seconds}s:`}</span>
          <ul className="mt-1.5 flex flex-wrap gap-2">
            {top.map((a) => (
              <li key={a.abilityId} className="rounded-md bg-panel px-2 py-1">
                <Ability id={a.abilityId} name={abilities[a.abilityId]?.name} icon={abilities[a.abilityId]?.icon} />{" "}
                <span className="text-red-300">−{compact(a.total)}</span>
                {a.hits > 1 && <span className="text-slate-500"> ({a.hits} hits)</span>}
              </li>
            ))}
          </ul>
          <p className="mt-2">
            Total <span className="text-red-300">−{compact(burst.totalDamage)}</span>
            {story.maxHp ? ` (${percent(burst.totalDamage / story.maxHp)} of your health)` : ""}, healing received{" "}
            <span className="text-emerald-300">+{compact(burst.healing)}</span>.
          </p>
        </div>
      )}

      {killingBlow && killingBlow.shareOfBurst < 0.25 && top.length > 1 && (
        <p className="mt-2 text-sm text-slate-300">
          The killing blow, {name(killingBlow.abilityId)} ({compact(killingBlow.amount)}), was just the last hit. The damage above is
          what actually brought you down.
        </p>
      )}

      {story.repeated.length > 0 && (
        <p className="mt-2 text-sm text-slate-400">
          Kept hitting you throughout: {story.repeated.slice(0, 3).map((r) => `${name(r.abilityId)} (${r.hits}×)`).join(", ")}.
        </p>
      )}

      <p className="mt-2 text-sm text-slate-400">
        {story.lowWholeWindow
          ? "The trouble started earlier: you needed healing, a defensive or a healthstone well before the final hits."
          : lowHealing
            ? "Very little healing landed during the drop. A personal defensive or healthstone right after the first big hit could have saved you."
            : "Healing was coming in but couldn't keep up. A defensive during the drop, or avoiding hits that are marked avoidable, would have bought time."}
      </p>
    </div>
  );
}

export function DeathStoryView({
  death,
  story,
  abilities,
  wipe,
  kill,
}: {
  death: PlayerDeath;
  story: DeathStory;
  abilities: AbilityInfo;
  wipe: WipeEvent | null;
  kill: boolean;
}) {
  const category =
    death.category === "early" && !wipe ? { label: kill ? "Before the kill" : "During the pull", tone: "red" as Tone } : CATEGORY[death.category];
  const before = story.entries.filter((e) => !e.inBurst);
  const during = story.entries.filter((e) => e.inBurst);
  const header = (
    <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
      <tr>
        <th className="py-1.5 pr-2 font-medium">Time</th>
        <th className="hidden py-1.5 pr-2 font-medium sm:table-cell">Before death</th>
        <th className="py-1.5 pr-2 font-medium">What happened</th>
        <th className="py-1.5 pr-2 text-right font-medium">Amount</th>
        <th className="py-1.5 text-right font-medium">Health after</th>
      </tr>
    </thead>
  );

  return (
    <div id={`death-${death.order}`} className="scroll-mt-6 space-y-4 rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-white">Died at {fightTime(death.fightTimeMs)}</span>
        <Badge tone={category.tone}>{category.label}</Badge>
        <span className="text-sm text-slate-400">{ordinal(death.order)} death in the raid</span>
      </div>

      <Summary story={story} abilities={abilities} />
      <HealthGraph story={story} />

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[420px] text-sm">
          {header}
          <tbody className="divide-y divide-line/60">
            <EventRows entries={during} abilities={abilities} maxHp={story.maxHp} />
          </tbody>
        </table>
      </div>
      {before.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-slate-400 hover:text-slate-200">
            Show the {((story.windowMs - story.burst.beforeDeathMs) / 1000).toFixed(0)} seconds before that ({before.length} events)
          </summary>
          <div className="-mx-4 mt-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[420px] text-sm">
              {header}
              <tbody className="divide-y divide-line/60">
                <EventRows entries={before} abilities={abilities} maxHp={story.maxHp} />
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
