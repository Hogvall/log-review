import type { ReactNode } from "react";
import type { DeathStory, DefensiveReview, HealSpell, PlayerDeath, StoryEntry, WipeEvent } from "@log-review/analysis";
import type { AbilityTip } from "@log-review/encounters";
import { type AbilityInfo, categoryLabel, toneText } from "./report";
import { Ability, linkClass } from "./ui";
import { beforeDeath, classColor, compact, fightTime, fightTimePrecise, ordinal, percent } from "@/lib/format";

/** Names and classes of everyone in the report, to show who healed whom. */
export interface Actors {
  names: Record<number, string>;
  classes: Record<number, string>;
  /** The player whose death this is, so self-healing reads "You". */
  selfId: number;
}

function ActorName({ id, actors }: { id: number; actors: Actors }) {
  if (id === actors.selfId) return <span className="text-fg">You</span>;
  const name = actors.names[id];
  if (!name) return <span className="text-faint">Pet/NPC</span>;
  return <span style={{ color: classColor(actors.classes[id] ?? "") }}>{name}</span>;
}

function SubHeader({ children }: { children: ReactNode }) {
  return <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">{children}</h4>;
}

function SpellList({ spells, abilities, limit = 3 }: { spells: HealSpell[]; abilities: AbilityInfo; limit?: number }) {
  return (
    <>
      {spells.slice(0, limit).map((sp, i) => (
        <span key={`${sp.abilityId}${sp.shield}`}>
          {i > 0 && ", "}
          <Ability id={sp.abilityId} name={abilities[sp.abilityId]?.name} icon={abilities[sp.abilityId]?.icon} />{" "}
          <span className={`num ${sp.shield ? "text-shield" : "text-heal/80"}`}>
            {compact(sp.amount)}
            {sp.shield && " shield"}
          </span>
        </span>
      ))}
      {spells.length > limit && <span className="text-faint"> +{spells.length - limit}</span>}
    </>
  );
}

function HealthGraph({ story }: { story: DeathStory }) {
  const W = 300;
  const H = 70;
  const x = (beforeDeathMs: number) => ((story.windowMs - beforeDeathMs) / story.windowMs) * W;
  const y = (hp: number) => (1 - hp) * (H - 4) + 2;
  const points = story.entries
    .filter((e) => e.hpAfter != null)
    .map((e) => `${x(e.kind === "healing" ? e.endBeforeDeathMs : e.beforeDeathMs)},${y(e.hpAfter!)}`);
  const burstX = x(story.burst.beforeDeathMs);
  return (
    <div>
      <div className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-1.5">
        <div className="num flex flex-col justify-between text-right text-[10px] text-faint">
          <span>100</span>
          <span>50</span>
          <span>0</span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-20 w-full border border-line bg-raised" role="img" aria-label="Health over the seconds before death">
          <line x1="0" x2={W} y1={y(0.5)} y2={y(0.5)} stroke="#2a2a2f" vectorEffect="non-scaling-stroke" />
          <rect x={burstX} y="0" width={W - burstX} height={H} fill="rgb(229 115 95 / 0.1)" />
          {points.length > 1 && (
            <polyline points={points.join(" ")} fill="none" stroke="#e4e0d8" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          )}
          {story.entries
            .filter((e): e is Extract<StoryEntry, { kind: "damage" }> => e.kind === "damage" && e.big && e.hpAfter != null)
            .map((e, i) => (
              <rect key={i} x={x(e.beforeDeathMs) - 2} y={y(e.hpAfter!) - 2} width="4" height="4" fill="#e5735f" />
            ))}
        </svg>
      </div>
      <div className="num ml-[2.625rem] mt-1 flex justify-between text-[10px] text-faint">
        <span>{beforeDeath(story.windowMs)}</span>
        <span>health %, shaded = final drop</span>
        <span>0.0s</span>
      </div>
    </div>
  );
}

function HealthCell({ hp }: { hp: number | null }) {
  if (hp == null) return <span className="text-faint">–</span>;
  const color = hp > 0.5 ? "bg-heal" : hp > 0.25 ? "bg-warn" : "bg-dmg";
  return (
    <span className="flex items-center justify-end gap-2">
      <span className="hidden h-1 w-14 bg-line sm:block">
        <span className={`block h-full ${color}`} style={{ width: percent(hp) }} />
      </span>
      <span className="num w-9 text-right">{percent(hp)}</span>
    </span>
  );
}

function EventRows({ entries, abilities, maxHp, actors }: { entries: StoryEntry[]; abilities: AbilityInfo; maxHp: number | null; actors: Actors }) {
  return (
    <>
      {entries.map((e, i) => {
        const time = (
          <>
            <td className="num py-1 pr-3 text-muted">{fightTimePrecise(e.fightTimeMs)}</td>
            <td className="num hidden py-1 pr-3 text-faint sm:table-cell">{beforeDeath(e.beforeDeathMs)}</td>
          </>
        );
        if (e.kind === "debuff") {
          return (
            <tr key={i} className="text-xs">
              {time}
              <td colSpan={3} className="py-1 text-debuff">
                <Ability id={e.abilityId} name={abilities[e.abilityId]?.name} icon={abilities[e.abilityId]?.icon} />{" "}
                {e.change === "applied" ? "applied" : <span className="num">{e.stacks} stacks</span>}
              </td>
            </tr>
          );
        }
        if (e.kind === "healing") {
          return (
            <tr key={i}>
              {time}
              <td className="py-1 pr-3 text-xs text-muted">
                <span className="text-heal/90">heal{e.count > 1 ? ` ×${e.count}` : ""}</span>{" "}
                {e.sources.slice(0, 3).map((src, j) => (
                  <span key={src.sourceId}>
                    {j > 0 && " · "}
                    <ActorName id={src.sourceId} actors={actors} />{" "}
                    {src.spells
                      .slice(0, 2)
                      .map((sp) => `${abilities[sp.abilityId]?.name ?? "Spell"}${sp.shield ? " (shield)" : ""}`)
                      .join(", ")}
                  </span>
                ))}
                {e.sources.length > 3 && ` · +${e.sources.length - 3}`}
              </td>
              <td className="num py-1 pr-3 text-right text-heal">+{compact(e.amount)}</td>
              <td className="py-1 text-right text-fg/85">
                <HealthCell hp={e.hpAfter} />
              </td>
            </tr>
          );
        }
        return (
          <tr key={i} className={e.big ? "bg-dmg/[0.07]" : ""}>
            {time}
            <td className={`py-1 pr-3 ${e.big ? "shadow-[inset_2px_0_0_var(--color-dmg)] pl-2" : ""}`}>
              <Ability id={e.abilityId} name={abilities[e.abilityId]?.name} icon={abilities[e.abilityId]?.icon} />
              {e.big && maxHp && <span className="num ml-2 text-xs text-dmg">{percent(e.amount / maxHp)} hp</span>}
              {e.killingBlow && <span className="ml-2 text-xs text-dmg">killing blow</span>}
            </td>
            <td className="num py-1 pr-3 text-right text-dmg">−{compact(e.amount)}</td>
            <td className="py-1 text-right text-fg/85">
              <HealthCell hp={e.hpAfter} />
            </td>
          </tr>
        );
      })}
    </>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-faint">{label}</dt>
      <dd className="text-fg/90">{children}</dd>
    </>
  );
}

function Summary({ story, abilities }: { story: DeathStory; abilities: AbilityInfo }) {
  const { burst, killingBlow } = story;
  const seconds = (burst.beforeDeathMs / 1000).toFixed(1);
  const name = (id: number) => abilities[id]?.name ?? `Spell ${id}`;
  const lowHealing = burst.healing < burst.totalDamage * 0.25;
  const stacksOf = (id: number) => story.debuffs?.find((d) => d.abilityId === id)?.maxStacks ?? 0;
  return (
    <div className="space-y-3">
      <p className="num text-xl font-medium text-fg">
        {story.lowWholeWindow ? (
          <span className="font-sans">Below 75% health for the full {story.windowMs / 1000}s</span>
        ) : (
          <>
            {burst.startHp != null ? percent(burst.startHp) : "healthy"} <span className="text-faint">→</span> 0{" "}
            <span className="font-sans text-base text-muted">in {seconds}s</span>
          </>
        )}
      </p>

      {burst.damage.length > 0 && (
        <table className="w-full max-w-xl text-sm">
          <thead className="text-left text-[11px] uppercase tracking-[0.07em] text-faint">
            <tr>
              <th className="pb-1 font-medium">{story.lowWholeWindow ? "Damage" : `Damage in the last ${seconds}s`}</th>
              <th className="pb-1 text-right font-medium">Hits</th>
              <th className="pb-1 text-right font-medium">Stacks</th>
              <th className="pb-1 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {burst.damage.slice(0, 5).map((a) => (
              <tr key={a.abilityId} className="border-t border-line/60">
                <td className="py-1">
                  <Ability id={a.abilityId} name={abilities[a.abilityId]?.name} icon={abilities[a.abilityId]?.icon} />
                </td>
                <td className="num py-1 text-right text-muted">{a.hits}</td>
                <td className="num py-1 text-right text-debuff">{stacksOf(a.abilityId) > 1 ? stacksOf(a.abilityId) : ""}</td>
                <td className="num py-1 text-right text-dmg">−{compact(a.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <Fact label="Total">
          <span className="num text-dmg">−{compact(burst.totalDamage)}</span>
          {story.maxHp ? <span className="text-muted"> ({percent(burst.totalDamage / story.maxHp)} of max health)</span> : null}
          <span className="text-muted"> · healing </span>
          <span className="num text-heal">+{compact(burst.healing)}</span>
        </Fact>
        {killingBlow && (
          <Fact label="Killing blow">
            {name(killingBlow.abilityId)} <span className="num text-muted">{compact(killingBlow.amount)}</span>
            {killingBlow.shareOfBurst < 0.25 && burst.damage.length > 1 && <span className="text-muted"> · only the last tick</span>}
          </Fact>
        )}
        {story.debuffs && story.debuffs.length > 0 && (
          <Fact label="Boss debuffs">
            {story.debuffs.slice(0, 5).map((d, i) => (
              <span key={d.abilityId}>
                {i > 0 && <span className="text-faint"> · </span>}
                {name(d.abilityId)}
                {d.maxStacks > 1 && <span className="num text-debuff"> {d.maxStacks}</span>}
              </span>
            ))}
            {story.debuffs.length > 5 && <span className="text-faint"> +{story.debuffs.length - 5}</span>}
          </Fact>
        )}
        {story.repeated.length > 0 && (
          <Fact label={`Repeat hits, ${story.windowMs / 1000}s`}>
            {story.repeated
              .slice(0, 3)
              .map((r) => `${name(r.abilityId)} ${r.hits}`)
              .join(" · ")}
          </Fact>
        )}
      </dl>

      <p className="text-sm text-muted">
        {story.lowWholeWindow
          ? "It started earlier: you needed healing or a defensive well before the final hits."
          : lowHealing
            ? "Little healing landed during the drop. A defensive or healthstone after the first big hit would have bought time."
            : "Healing came in but couldn't keep up. Mitigate the drop with a defensive, or avoid what's avoidable."}
      </p>
    </div>
  );
}

/** Boss-guide tips for the abilities that did the damage in the final drop. */
function HowToHandle({
  story,
  abilities,
  tips,
  guide,
}: {
  story: DeathStory;
  abilities: AbilityInfo;
  tips: Record<number, AbilityTip>;
  guide: { name: string; url: string } | null;
}) {
  const withTips = story.burst.damage.filter((a) => tips[a.abilityId]).slice(0, 3);
  if (!withTips.length) return null;
  return (
    <div>
      <SubHeader>Mechanics</SubHeader>
      <ul className="space-y-1 text-sm text-fg/85">
        {withTips.map((a) => (
          <li key={a.abilityId}>
            <Ability id={a.abilityId} name={abilities[a.abilityId]?.name} icon={abilities[a.abilityId]?.icon} />
            <span className="text-muted">: </span>
            {tips[a.abilityId]!.tip}
          </li>
        ))}
      </ul>
      {guide && (
        <a href={guide.url} target="_blank" rel="noreferrer" className={`mt-1.5 inline-block text-xs ${linkClass}`}>
          {guide.name} guide (Mythic Trap)
        </a>
      )}
    </div>
  );
}

const ago = (ms: number) => `${(ms / 1000).toFixed(1)}s before`;

/** Defensives and consumables: what you pressed, and what you still had. */
function Survival({ review, deathMs }: { review: DefensiveReview; deathMs: number }) {
  const ready = review.notUsed.filter((d) => d.likelyReady);
  const notReady = review.notUsed.filter((d) => !d.likelyReady);
  const consumable = (label: string, c: DefensiveReview["healthstone"]) => {
    const inWindow = c.usesMs.filter((t) => t >= deathMs - 15_000);
    if (inWindow.length) return <span className="text-heal">{label} {ago(deathMs - inWindow.at(-1)!)}</span>;
    if (c.usesMs.length) return <span className="text-fg/85">{label} at <span className="num">{fightTime(c.usesMs.at(-1)!)}</span></span>;
    return <span className="text-warn">{label} unused</span>;
  };
  return (
    <div className="text-sm">
      <SubHeader>Defensives &amp; consumables</SubHeader>
      <p>
        {review.usedInWindow.length ? (
          <span className="text-heal">{review.usedInWindow.map((u) => `${u.name} ${ago(u.beforeDeathMs)}`).join(", ")}</span>
        ) : (
          <span className="text-dmg">No defensive in the last 15s</span>
        )}
      </p>
      {ready.length > 0 && (
        <p className="text-fg/85">
          <span className="text-muted">Likely ready: </span>
          {ready
            .map((d) => `${d.name}${d.uses === 0 ? (d.confirmed ? " (unused)" : " (unused, if talented)") : ` (last ${fightTime(d.lastUsedMs!)})`}`)
            .join(" · ")}
        </p>
      )}
      {notReady.length > 0 && (
        <p className="text-faint">On cooldown: {notReady.map((d) => `${d.name} (${fightTime(d.lastUsedMs!)})`).join(" · ")}</p>
      )}
      <p className="flex flex-wrap gap-x-3">
        {consumable("Healthstone", review.healthstone)}
        {consumable("Health potion", review.healthPotion)}
      </p>
      <p className="mt-1 text-[11px] text-faint">Base cooldowns; talents may shorten them.</p>
    </div>
  );
}

/** For healers: who healed or shielded this player, during the drop and over the whole window. */
function HealerBreakdown({ story, abilities, actors }: { story: DeathStory; abilities: AbilityInfo; actors: Actors }) {
  const seconds = (story.burst.beforeDeathMs / 1000).toFixed(1);
  return (
    <div>
      <SubHeader>Healing received</SubHeader>
      {story.healers.length === 0 ? (
        <p className="text-sm text-dmg">No healing or shields in the last {story.windowMs / 1000}s.</p>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-[0.07em] text-faint">
              <tr>
                <th className="pb-1 pr-3 font-medium">Source</th>
                <th className="pb-1 pr-3 text-right font-medium">Drop ({seconds}s)</th>
                <th className="pb-1 pr-3 text-right font-medium">{story.windowMs / 1000}s</th>
                <th className="pb-1 font-medium">Spells</th>
              </tr>
            </thead>
            <tbody>
              {story.healers.map((h) => (
                <tr key={h.sourceId} className="border-t border-line/60">
                  <td className="py-1 pr-3">
                    <ActorName id={h.sourceId} actors={actors} />
                  </td>
                  <td className={`num py-1 pr-3 text-right ${h.burstAmount ? "text-heal" : "text-faint"}`}>
                    {h.burstAmount ? `+${compact(h.burstAmount)}` : "–"}
                  </td>
                  <td className="num py-1 pr-3 text-right text-heal/80">+{compact(h.windowAmount)}</td>
                  <td className="py-1 text-xs text-muted">
                    <SpellList spells={h.spells} abilities={abilities} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {story.healAbsorbed.window > 0 && (
        <p className="mt-1.5 text-sm text-warn">
          <span className="num">{compact(story.healAbsorbed.window)}</span> healing absorbed by debuffs
          {story.healAbsorbed.burst > 0 && (
            <>
              {" "}
              (<span className="num">{compact(story.healAbsorbed.burst)}</span> during the drop)
            </>
          )}
        </p>
      )}
    </div>
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
  const category = categoryLabel(death, wipe, kill);
  // Debuffs falling off aren't useful to read, so only applications and stack increases are shown.
  const shown = story.entries.filter((e) => !(e.kind === "debuff" && e.change === "removed"));
  const before = shown.filter((e) => !e.inBurst);
  const during = shown.filter((e) => e.inBurst);
  const header = (
    <thead className="text-left text-[11px] uppercase tracking-[0.07em] text-faint">
      <tr className="border-b border-line">
        <th className="pb-1 pr-3 font-medium">Time</th>
        <th className="hidden pb-1 pr-3 font-medium sm:table-cell">To death</th>
        <th className="pb-1 pr-3 font-medium">Event</th>
        <th className="pb-1 pr-3 text-right font-medium">Amount</th>
        <th className="pb-1 text-right font-medium">Health</th>
      </tr>
    </thead>
  );

  return (
    <article id={`death-${death.order}`} className="scroll-mt-6 space-y-5 border-t border-line py-4">
      <header className="flex flex-wrap items-baseline gap-x-3 text-sm">
        <span className="font-semibold uppercase tracking-[0.07em] text-fg">
          Death <span className="num">{fightTime(death.fightTimeMs)}</span>
        </span>
        <span className={toneText(category.tone)}>{category.label}</span>
        <span className="text-faint">{ordinal(death.order)} in raid</span>
      </header>

      <Summary story={story} abilities={abilities} />

      {(review || story.burst.damage.some((a) => tips[a.abilityId])) && (
        <div className="grid gap-5 border-t border-line/60 pt-3 md:grid-cols-2">
          {review && <Survival review={review} deathMs={death.fightTimeMs} />}
          <HowToHandle story={story} abilities={abilities} tips={tips} guide={guide} />
        </div>
      )}

      <HealthGraph story={story} />

      <div>
        <SubHeader>Event log</SubHeader>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[460px] text-sm">
            {header}
            <tbody className="[&>tr]:border-b [&>tr]:border-line/40">
              <EventRows entries={during} abilities={abilities} maxHp={story.maxHp} actors={actors} />
            </tbody>
          </table>
        </div>
        {before.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-muted hover:text-fg">
              Earlier {((story.windowMs - story.burst.beforeDeathMs) / 1000).toFixed(0)}s ({before.length} events)
            </summary>
            <div className="-mx-4 mt-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[460px] text-sm">
                {header}
                <tbody className="[&>tr]:border-b [&>tr]:border-line/40">
                  <EventRows entries={before} abilities={abilities} maxHp={story.maxHp} actors={actors} />
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>

      <HealerBreakdown story={story} abilities={abilities} actors={actors} />
    </article>
  );
}
