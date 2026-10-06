import type { Avoidability, ClassifiedDeath, DeathStory, DefensiveReview, Finding, PlayerDeath, WipeEvent } from "@log-review/analysis";
import type { AbilityTip } from "@log-review/encounters";
import { Ability, Badge, type Tone } from "./ui";
import { compact, fightTime, ordinal, percent } from "@/lib/format";

export type AbilityInfo = Record<number, { name: string; icon: string }>;

const AVOIDABILITY: Record<Avoidability, { label: string; tone: Tone; help: string }> = {
  avoidable: { label: "Avoidable", tone: "red", help: "Most top players take no damage from this." },
  situational: { label: "Situational", tone: "amber", help: "Some top players take this. It may be a soak or depend on your role or position." },
  unavoidable: { label: "Unavoidable", tone: "slate", help: "Almost everyone takes this. Survive it with defensives and healing." },
};

export function AvoidabilityBadge({ value, zeroShare }: { value: Avoidability | null; zeroShare?: number | null }) {
  if (!value) return <Badge title="No benchmark data for this ability yet.">Unknown</Badge>;
  const info = AVOIDABILITY[value];
  const detail = zeroShare != null ? ` ${percent(zeroShare)} of top players took none.` : "";
  return (
    <Badge tone={info.tone} title={info.help + detail}>
      {info.label}
    </Badge>
  );
}

const SEVERITY_STYLE = {
  high: "border-red-500/40",
  medium: "border-amber-500/40",
  low: "border-line",
} as const;

function deathAdvice(death: PlayerDeath, ability: string) {
  switch (death.killingAvoidability) {
    case "avoidable":
      return `Most top players never get hit by ${ability}. Learn what it targets and where to stand.`;
    case "unavoidable":
      return `${ability} hits everyone, so the fix is surviving it: use a defensive or healthstone before it lands, or check with your healers.`;
    case "situational":
      return `${ability} is only taken by some players. Check whether it was your job to take it, and if not, how to avoid it.`;
    default:
      return `Look up what ${ability} does and whether you can avoid it.`;
  }
}

/** One line on defensives and healthstone for a death card. */
function SurvivalLine({ review }: { review: DefensiveReview }) {
  if (review.usedInWindow.length) return null;
  const ready = review.notUsed.filter((d) => d.likelyReady && (d.confirmed || d.uses === 0)).map((d) => d.name);
  const parts: string[] = [];
  if (ready.length) parts.push(`${listNames(ready.slice(0, 2))} ${ready.length === 1 ? "was" : "were"} probably ready`);
  if (!review.healthstone.usesMs.length) parts.push("you hadn't used a healthstone");
  if (!parts.length) return <p className="mt-1 text-sm text-amber-300">No defensive pressed in the last 15 seconds.</p>;
  return (
    <p className="mt-1 text-sm text-amber-300">
      No defensive pressed in the last 15 seconds, but {listNames(parts)}.
    </p>
  );
}

/** "A, B and C" */
function listNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function FindingCard({
  finding,
  abilities,
  wipe,
  stories = {},
  avoidability = {},
  reviews = {},
  tips = {},
}: {
  finding: Finding;
  abilities: AbilityInfo;
  wipe: WipeEvent | null;
  /** Death stories by death order, to explain what actually did the damage. */
  stories?: Record<number, DeathStory>;
  /** Avoidability of abilities you took damage from. */
  avoidability?: Record<number, Avoidability | null>;
  /** Defensive and consumable reviews by death order. */
  reviews?: Record<number, DefensiveReview>;
  /** Boss tips by ability ID. */
  tips?: Record<number, AbilityTip>;
}) {
  const border = SEVERITY_STYLE[finding.severity];
  if (finding.kind === "death" && stories[finding.death.order]?.burst.damage.length) {
    const d = finding.death;
    const story = stories[d.order]!;
    const main = story.burst.damage.slice(0, 3);
    const nameOf = (id: number) => abilities[id]?.name ?? `Spell ${id}`;
    const avoidable = main.filter((a) => avoidability[a.abilityId] === "avoidable");
    const seconds = (story.burst.beforeDeathMs / 1000).toFixed(1);
    let context = "";
    if (d.category === "early") context = `You were the ${ordinal(d.order)} player to die${wipe ? ", before the raid wiped" : ""}. `;
    else if (d.category === "wipe-start") context = `You were one of the first to die when the raid wiped. `;
    else context = `${wipe?.deaths ?? "Many"} players died within a few seconds, so this probably wasn't your fault. `;
    return (
      <div className={`rounded-xl border bg-panel p-4 ${border}`}>
        <div className="text-white">
          Died at {fightTime(d.fightTimeMs)}:{" "}
          {story.lowWholeWindow ? "low on health for 15+ seconds" : `${story.burst.startHp != null ? percent(story.burst.startHp) : "healthy"} → dead in ${seconds}s`}
        </div>
        <p className="mt-2 text-sm text-slate-300">
          Mostly from{" "}
          {main.map((a, i) => (
            <span key={a.abilityId}>
              {i > 0 && (i === main.length - 1 ? " and " : ", ")}
              <Ability id={a.abilityId} name={abilities[a.abilityId]?.name} icon={abilities[a.abilityId]?.icon} />
            </span>
          ))}
          . {context}
        </p>
        {d.category !== "wipe" && reviews[d.order] && <SurvivalLine review={reviews[d.order]!} />}
        {d.category !== "wipe" && main.some((a) => tips[a.abilityId]) && (
          <p className="mt-1 text-sm text-slate-300">
            Tip:{" "}
            {main
              .filter((a) => tips[a.abilityId])
              .slice(0, 1)
              .map((a) => `${nameOf(a.abilityId)}: ${tips[a.abilityId]!.tip}`)}
          </p>
        )}
        {d.category !== "wipe" && (
          <p className="mt-1 text-sm text-slate-400">
            {avoidable.length
              ? `${listNames(avoidable.map((a) => nameOf(a.abilityId)))} ${avoidable.length === 1 ? "is" : "are"} avoidable: most top players never get hit. Learn where to stand for ${avoidable.length === 1 ? "it" : "them"}.`
              : story.burst.healing < story.burst.totalDamage * 0.25
                ? "Very little healing landed in those seconds. Use a personal defensive or healthstone as soon as the first big hit lands."
                : "Healing couldn't keep up. A defensive during the drop would have bought time."}
          </p>
        )}
        <a href={`#death-${d.order}`} className="mt-2 inline-block text-sm text-accent hover:underline">
          See the full timeline →
        </a>
      </div>
    );
  }
  if (finding.kind === "death") {
    const d = finding.death;
    const id = d.killingAbilityGameID;
    const info = id ? abilities[id] : undefined;
    const name = info?.name ?? "an unknown ability";
    let context: string;
    if (d.category === "early") context = `You were the ${ordinal(d.order)} player to die${wipe ? ", before the raid wiped" : ""}.`;
    else if (d.category === "wipe-start") context = `You were one of the first to die when the raid wiped at ${fightTime(wipe!.startMs)}. Early deaths in a wipe often cause it.`;
    else context = `${wipe?.deaths ?? "Many"} players died within a few seconds, so this probably wasn't your fault.`;
    return (
      <div className={`rounded-xl border bg-panel p-4 ${border}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-white">
            Died to {id ? <Ability id={id} name={info?.name} icon={info?.icon} /> : "unknown damage"} at {fightTime(d.fightTimeMs)}
          </span>
          {id && <AvoidabilityBadge value={d.killingAvoidability} />}
        </div>
        <p className="mt-2 text-sm text-slate-300">{context}</p>
        {d.category !== "wipe" && <p className="mt-1 text-sm text-slate-400">{deathAdvice(d, name)}</p>}
        <a href={`#death-${d.order}`} className="mt-2 inline-block text-sm text-accent hover:underline">
          See what hit you →
        </a>
      </div>
    );
  }
  const a = finding.ability;
  const info = abilities[a.abilityId];
  return (
    <div className={`rounded-xl border bg-panel p-4 ${border}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-white">
          Hit by <Ability id={a.abilityId} name={info?.name} icon={info?.icon} /> {a.hits}×
        </span>
        <AvoidabilityBadge value={a.classification} zeroShare={a.zeroShare} />
      </div>
      <p className="mt-2 text-sm text-slate-300">
        {a.zeroShare != null && `${percent(a.zeroShare)} of top players take no damage from this. `}
        It was {percent(a.share)} of all the damage you took ({compact(a.total)}).
      </p>
      <p className="mt-1 text-sm text-slate-400">
        {tips[a.abilityId] ? `Tip: ${tips[a.abilityId]!.tip}` : "Every hit you avoid is healing your healers can spend elsewhere."}
      </p>
    </div>
  );
}

/** A strip across the pull showing every raid death, with this player's deaths highlighted. */
export function DeathTimeline({
  deaths,
  wipe,
  durationMs,
  playerId,
  names,
}: {
  deaths: ClassifiedDeath[];
  wipe: WipeEvent | null;
  durationMs: number;
  playerId: number;
  names: Record<number, string>;
}) {
  const at = (ms: number) => `${Math.min(100, Math.max(0, (ms / durationMs) * 100))}%`;
  return (
    <div>
      <div className="relative h-10 rounded-lg bg-line/60" role="img" aria-label="Timeline of deaths during the pull">
        {wipe && (
          <div
            className="absolute inset-y-0 rounded bg-red-500/20"
            style={{ left: at(wipe.startMs), width: `max(6px, calc(${at(wipe.endMs)} - ${at(wipe.startMs)}))` }}
            title={`Raid wipe: ${wipe.deaths} deaths from ${fightTime(wipe.startMs)} to ${fightTime(wipe.endMs)}`}
          />
        )}
        {deaths.map((d) => {
          const mine = d.targetID === playerId;
          return (
            <span
              key={`${d.order}`}
              title={`${fightTime(d.fightTimeMs)} ${names[d.targetID!] ?? "Unknown"}`}
              className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${
                mine ? "z-10 h-4 w-4 bg-accent ring-2 ring-white" : "h-2.5 w-2.5 bg-slate-400"
              }`}
              style={{ left: at(d.fightTimeMs) }}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-xs text-slate-500">
        <span>0:00</span>
        <span>{fightTime(durationMs)}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-accent ring-2 ring-white" /> You
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-400" /> Other players
        </span>
        {wipe && (
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-4 rounded bg-red-500/30" /> Raid wipe
          </span>
        )}
      </div>
    </div>
  );
}

const CATEGORY_LABEL: Record<ClassifiedDeath["category"], { label: string; tone: Tone }> = {
  early: { label: "Before the wipe", tone: "red" },
  "wipe-start": { label: "Start of the wipe", tone: "red" },
  wipe: { label: "During the wipe", tone: "slate" },
  "after-wipe": { label: "After the wipe", tone: "slate" },
};

export function DeathDetails({
  death,
  abilities,
  wipe,
  kill,
}: {
  death: PlayerDeath;
  abilities: AbilityInfo;
  wipe: WipeEvent | null;
  kill: boolean;
}) {
  const max = Math.max(1, ...death.recap.abilities.map((a) => a.total));
  const category =
    death.category === "early" && !wipe ? { label: kill ? "Before the kill" : "During the pull", tone: "red" as Tone } : CATEGORY_LABEL[death.category];
  return (
    <div id={`death-${death.order}`} className="scroll-mt-6 rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-white">Died at {fightTime(death.fightTimeMs)}</span>
        <Badge tone={category.tone}>{category.label}</Badge>
        <span className="text-sm text-slate-400">{ordinal(death.order)} death in the raid</span>
      </div>
      <p className="mt-3 text-sm text-slate-400">
        Damage taken in the last {death.recap.windowMs / 1000} seconds: <span className="text-slate-200">{compact(death.recap.total)}</span>
      </p>
      {death.recap.abilities.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">No boss damage recorded just before this death.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {death.recap.abilities.map((a) => {
            const info = abilities[a.abilityId];
            const killing = a.abilityId === death.killingAbilityGameID;
            return (
              <li key={a.abilityId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 text-sm">
                <span className="truncate">
                  <Ability id={a.abilityId} name={info?.name} icon={info?.icon} />
                  {killing && <span className="ml-2 text-xs text-red-300">killing blow</span>}
                </span>
                <span className="text-slate-300">
                  {compact(a.total)} <span className="text-slate-500">({a.hits}×)</span>
                </span>
                <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
                  <span className={`block h-full ${killing ? "bg-red-400" : "bg-slate-400"}`} style={{ width: `${(a.total / max) * 100}%` }} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
