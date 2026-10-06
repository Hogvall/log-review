import type { DeathStory, DefensiveReview, HealSpell, PlayerDeath, StoryEntry, WipeEvent } from "@log-review/analysis";
import type { AbilityTip } from "@log-review/encounters";
import type { AbilityInfo } from "./report";
import { Ability, Badge, type Tone } from "./ui";
import { beforeDeath, classColor, compact, fightTime, fightTimePrecise, ordinal, percent } from "@/lib/format";

/** Names and classes of everyone in the report, to show who healed whom. */
export interface Actors {
  names: Record<number, string>;
  classes: Record<number, string>;
  /** The player whose death this is, so self-healing reads "You". */
  selfId: number;
}

function ActorName({ id, actors }: { id: number; actors: Actors }) {
  if (id === actors.selfId) return <span className="text-slate-200">You</span>;
  const name = actors.names[id];
  if (!name) return <span className="text-slate-400">Other (pet or NPC)</span>;
  return <span style={{ color: classColor(actors.classes[id] ?? "") }}>{name}</span>;
}

function SpellList({ spells, abilities, limit = 3 }: { spells: HealSpell[]; abilities: AbilityInfo; limit?: number }) {
  return (
    <>
      {spells.slice(0, limit).map((sp, i) => (
        <span key={`${sp.abilityId}${sp.shield}`}>
          {i > 0 && ", "}
          <Ability id={sp.abilityId} name={abilities[sp.abilityId]?.name} icon={abilities[sp.abilityId]?.icon} />{" "}
          <span className="text-emerald-300/80">{compact(sp.amount)}</span>
          {sp.shield && <span className="text-sky-300/80"> shield</span>}
        </span>
      ))}
      {spells.length > limit && <span className="text-slate-500"> +{spells.length - limit} more</span>}
    </>
  );
}

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

function EventRows({
  entries,
  abilities,
  maxHp,
  actors,
}: {
  entries: StoryEntry[];
  abilities: AbilityInfo;
  maxHp: number | null;
  actors: Actors;
}) {
  return (
    <>
      {entries.map((e, i) =>
        e.kind === "debuff" ? (
          <tr key={i}>
            <td className="py-1 pr-2 tabular-nums text-slate-500">{fightTimePrecise(e.fightTimeMs)}</td>
            <td className="hidden py-1 pr-2 tabular-nums text-slate-600 sm:table-cell">{beforeDeath(e.beforeDeathMs)}</td>
            <td colSpan={3} className="py-1 text-xs text-violet-300">
              <span className="mr-1 text-violet-400/70">Debuff</span>
              <Ability id={e.abilityId} name={abilities[e.abilityId]?.name} icon={abilities[e.abilityId]?.icon} />{" "}
              {e.change === "applied" ? "applied" : `→ ${e.stacks} stacks`}
            </td>
          </tr>
        ) : (
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
              <span>
                <span className="text-emerald-300/90">Healing{e.count > 1 ? ` (${e.count} heals)` : ""}</span>
                <span className="mt-0.5 block text-xs text-slate-400">
                  {e.sources.slice(0, 3).map((src, i) => (
                    <span key={src.sourceId}>
                      {i > 0 && " · "}
                      <ActorName id={src.sourceId} actors={actors} />:{" "}
                      {src.spells
                        .slice(0, 2)
                        .map((sp) => `${abilities[sp.abilityId]?.name ?? "Spell"}${sp.shield ? " (shield)" : ""} ${compact(sp.amount)}`)
                        .join(", ")}
                    </span>
                  ))}
                  {e.sources.length > 3 && ` · +${e.sources.length - 3} more`}
                </span>
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
        ),
      )}
    </>
  );
}

function Summary({ story, abilities }: { story: DeathStory; abilities: AbilityInfo }) {
  const { burst, killingBlow } = story;
  const seconds = (burst.beforeDeathMs / 1000).toFixed(1);
  const top = burst.damage.slice(0, 4);
  const name = (id: number) => abilities[id]?.name ?? `Spell ${id}`;
  const lowHealing = burst.healing < burst.totalDamage * 0.25;
  const debuffOf = (id: number) => story.debuffs?.find((d) => d.abilityId === id);
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
                {(debuffOf(a.abilityId)?.maxStacks ?? 0) > 1 && (
                  <span className="text-violet-300"> · {debuffOf(a.abilityId)!.maxStacks} stacks</span>
                )}
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

      {story.debuffs && story.debuffs.length > 0 && (
        <p className="mt-2 text-sm text-slate-300">
          Boss debuffs on you in the last {story.windowMs / 1000}s:{" "}
          {story.debuffs.slice(0, 5).map((d, i) => (
            <span key={d.abilityId}>
              {i > 0 && " · "}
              <Ability id={d.abilityId} name={abilities[d.abilityId]?.name} icon={abilities[d.abilityId]?.icon} />
              {d.maxStacks > 1 && (
                <span className="text-violet-300">
                  {" "}
                  {d.stacksAtDeath === d.maxStacks ? `${d.maxStacks} stacks` : `up to ${d.maxStacks} stacks`}
                </span>
              )}
            </span>
          ))}
          {story.debuffs.length > 5 && <span className="text-slate-500"> +{story.debuffs.length - 5} more</span>}
        </p>
      )}

      {story.repeated.length > 0 && (
        <p className="mt-2 text-sm text-slate-400">
          Hit you over and over in the last {story.windowMs / 1000} seconds:{" "}
          {story.repeated
            .slice(0, 3)
            .map((r) => `${name(r.abilityId)} ${r.hits} times`)
            .join(", ")}{" "}
          (each hit or damage tick counts once).
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

/** Boss-guide tips for the abilities that did the damage in the final drop. */
function HowToHandle({ story, abilities, tips, guide }: { story: DeathStory; abilities: AbilityInfo; tips: Record<number, AbilityTip>; guide: { name: string; url: string } | null }) {
  const withTips = story.burst.damage.filter((a) => tips[a.abilityId]).slice(0, 3);
  if (!withTips.length) return null;
  return (
    <div className="rounded-lg border border-line p-3">
      <h4 className="font-medium text-slate-200">How to handle it</h4>
      <ul className="mt-1.5 space-y-1.5 text-sm text-slate-300">
        {withTips.map((a) => (
          <li key={a.abilityId}>
            <Ability id={a.abilityId} name={abilities[a.abilityId]?.name} icon={abilities[a.abilityId]?.icon} />: {tips[a.abilityId]!.tip}
          </li>
        ))}
      </ul>
      {guide && (
        <a href={guide.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-accent hover:underline">
          Full {guide.name} guide on Mythic Trap ↗
        </a>
      )}
    </div>
  );
}

const ago = (ms: number) => `${(ms / 1000).toFixed(1)}s before death`;

/** Defensives and consumables: what you pressed, and what you still had. */
function Survival({ review, deathMs }: { review: DefensiveReview; deathMs: number }) {
  const ready = review.notUsed.filter((d) => d.likelyReady);
  const notReady = review.notUsed.filter((d) => !d.likelyReady);
  const consumable = (label: string, c: DefensiveReview["healthstone"]) => {
    const inWindow = c.usesMs.filter((t) => t >= deathMs - 15_000);
    if (inWindow.length) return <span className="text-emerald-300">{label}: used {ago(deathMs - inWindow.at(-1)!)}</span>;
    if (c.usesMs.length) return <span className="text-slate-300">{label}: used earlier at {fightTime(c.usesMs.at(-1)!)}</span>;
    return <span className="text-amber-300">{label}: not used this pull</span>;
  };
  return (
    <div className="rounded-lg border border-line p-3 text-sm">
      <h4 className="font-medium text-slate-200">What you did to survive</h4>
      <p className="mt-1.5">
        {review.usedInWindow.length ? (
          <span className="text-emerald-300">
            Defensives in the last 15s: {review.usedInWindow.map((u) => `${u.name} (${ago(u.beforeDeathMs)})`).join(", ")}
          </span>
        ) : (
          <span className="text-red-300">You used no personal defensive in the last 15 seconds.</span>
        )}
      </p>
      {ready.length > 0 && (
        <p className="mt-1 text-slate-300">
          Probably ready but not pressed:{" "}
          {ready
            .map((d) => `${d.name}${d.uses === 0 ? " (never used this pull" + (d.confirmed ? ")" : ", if you have it)") : ` (last used ${fightTime(d.lastUsedMs!)}, ~${Math.round(d.cooldownSec / 60) || 1} min cooldown)`}`)
            .join(" · ")}
        </p>
      )}
      {notReady.length > 0 && (
        <p className="mt-1 text-slate-500">
          Likely still on cooldown: {notReady.map((d) => `${d.name} (used ${fightTime(d.lastUsedMs!)})`).join(" · ")}
        </p>
      )}
      <p className="mt-1 flex flex-wrap gap-x-4">
        {consumable("Healthstone", review.healthstone)}
        {consumable("Health potion", review.healthPotion)}
      </p>
      <p className="mt-2 text-xs text-slate-500">Cooldowns are base values; talents can shorten them, so "ready" is an estimate.</p>
    </div>
  );
}

/** For healers: who healed or shielded this player, during the drop and over the whole window. */
function HealerBreakdown({ story, abilities, actors }: { story: DeathStory; abilities: AbilityInfo; actors: Actors }) {
  const seconds = (story.burst.beforeDeathMs / 1000).toFixed(1);
  return (
    <details open className="rounded-lg border border-line p-3">
      <summary className="cursor-pointer font-medium text-slate-200">Who was healing you</summary>
      {story.healers.length === 0 ? (
        <p className="mt-2 text-sm text-red-300">No healing or shields landed on you in the last {story.windowMs / 1000} seconds.</p>
      ) : (
        <div className="-mx-3 mt-2 overflow-x-auto px-3">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1.5 pr-2 font-medium">Healer</th>
                <th className="py-1.5 pr-2 text-right font-medium">Last {seconds}s</th>
                <th className="py-1.5 pr-2 text-right font-medium">Last {story.windowMs / 1000}s</th>
                <th className="py-1.5 font-medium">Spells</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {story.healers.map((h) => (
                <tr key={h.sourceId}>
                  <td className="py-1.5 pr-2">
                    <ActorName id={h.sourceId} actors={actors} />
                  </td>
                  <td className={`py-1.5 pr-2 text-right tabular-nums ${h.burstAmount ? "text-emerald-300" : "text-slate-600"}`}>
                    {h.burstAmount ? `+${compact(h.burstAmount)}` : "–"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-emerald-300/80">+{compact(h.windowAmount)}</td>
                  <td className="py-1.5 text-xs text-slate-400">
                    <SpellList spells={h.spells} abilities={abilities} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {story.healAbsorbed.window > 0 && (
        <p className="mt-2 text-sm text-amber-300/90">
          {compact(story.healAbsorbed.window)} of healing on you was eaten by heal-absorb effects
          {story.healAbsorbed.burst > 0 ? ` (${compact(story.healAbsorbed.burst)} during the drop)` : ""}, so it never restored any health.
        </p>
      )}
      <p className="mt-2 text-xs text-slate-500">
        "Last {seconds}s" is the final drop from {story.burst.startHp != null ? percent(story.burst.startHp) : "healthy"} to dead. Shields count as
        healing because they soaked damage.
      </p>
    </details>
  );
}

export function DeathStoryView({
  death,
  story,
  abilities,
  wipe,
  kill,
  actors,
  review,
  tips = {},
  guide = null,
}: {
  death: PlayerDeath;
  story: DeathStory;
  abilities: AbilityInfo;
  wipe: WipeEvent | null;
  kill: boolean;
  actors: Actors;
  review?: DefensiveReview;
  tips?: Record<number, AbilityTip>;
  guide?: { name: string; url: string } | null;
}) {
  const category =
    death.category === "early" && !wipe ? { label: kill ? "Before the kill" : "During the pull", tone: "red" as Tone } : CATEGORY[death.category];
  // Debuffs falling off aren't useful to read, so only applications and stack increases are shown.
  const shown = story.entries.filter((e) => !(e.kind === "debuff" && e.change === "removed"));
  const before = shown.filter((e) => !e.inBurst);
  const during = shown.filter((e) => e.inBurst);
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
      <div className="grid gap-3 lg:grid-cols-2">
        {review && <Survival review={review} deathMs={death.fightTimeMs} />}
        <HowToHandle story={story} abilities={abilities} tips={tips} guide={guide} />
      </div>
      <HealthGraph story={story} />

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[420px] text-sm">
          {header}
          <tbody className="divide-y divide-line/60">
            <EventRows entries={during} abilities={abilities} maxHp={story.maxHp} actors={actors} />
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
                <EventRows entries={before} abilities={abilities} maxHp={story.maxHp} actors={actors} />
              </tbody>
            </table>
          </div>
        </details>
      )}
      <HealerBreakdown story={story} abilities={abilities} actors={actors} />
    </div>
  );
}
