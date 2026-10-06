import type { ReactNode } from "react";
import type { Avoidability, ClassifiedDeath, DeathStory, DefensiveReview, Finding, PlayerDeath, Severity, WipeEvent } from "@log-review/analysis";
import type { AbilityTip } from "@log-review/encounters";
import { Ability, type Tone, linkClass } from "./ui";
import { compact, fightTime, ordinal, percent } from "@/lib/format";

export type AbilityInfo = Record<number, { name: string; icon: string }>;

const AVOIDABILITY: Record<Avoidability, { label: string; className: string; help: string }> = {
  avoidable: { label: "avoidable", className: "text-dmg", help: "Most top players take no damage from this." },
  situational: { label: "situational", className: "text-warn", help: "Some top players take it: a soak, or role/position dependent." },
  unavoidable: { label: "unavoidable", className: "text-faint", help: "Almost everyone takes it. Survive it with defensives and healing." },
};

export function AvoidabilityBadge({ value, zeroShare }: { value: Avoidability | null; zeroShare?: number | null }) {
  if (!value) return <span className="text-xs text-faint" title="No top-player data for this ability yet.">–</span>;
  const info = AVOIDABILITY[value];
  const detail = zeroShare != null ? ` ${percent(zeroShare)} of top players took none.` : "";
  return (
    <span className={`text-xs font-medium ${info.className}`} title={info.help + detail}>
      {info.label}
    </span>
  );
}

const SEVERITY_COLOR: Record<Severity, string> = { high: "text-dmg", medium: "text-warn", low: "text-faint" };

/** A numbered row in the top-issues list. */
export function IssueRow({
  index,
  severity,
  title,
  children,
}: {
  index: number;
  severity: Severity;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-2 border-b border-line py-3 last:border-b-0">
      <span className={`num pt-px text-sm ${SEVERITY_COLOR[severity]}`}>{String(index).padStart(2, "0")}</span>
      <div className="min-w-0 space-y-1">
        <div className="font-medium text-fg">{title}</div>
        {children && <div className="space-y-0.5 text-sm text-muted">{children}</div>}
      </div>
    </li>
  );
}

/** One line on defensives and healthstone for a death row. */
function SurvivalLine({ review }: { review: DefensiveReview }) {
  if (review.usedInWindow.length) return null;
  const ready = review.notUsed.filter((d) => d.likelyReady && (d.confirmed || d.uses === 0)).map((d) => d.name);
  const parts = ["No defensive in the last 15s"];
  if (ready.length) parts.push(`${listNames(ready.slice(0, 2))} likely ready`);
  if (!review.healthstone.usesMs.length) parts.push("no healthstone used");
  return <p className="text-warn">{parts.join(" · ")}</p>;
}

/** "A, B and C" */
function listNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function deathContext(d: PlayerDeath, wipe: WipeEvent | null): string {
  if (d.category === "early") return wipe ? `${ordinal(d.order)} death, before the wipe.` : `${ordinal(d.order)} death.`;
  if (d.category === "wipe-start") return "Among the first deaths of the wipe.";
  return `${wipe?.deaths ?? "Many"} players died within seconds; likely not on you.`;
}

export function FindingCard({
  index,
  finding,
  abilities,
  wipe,
  stories = {},
  avoidability = {},
  reviews = {},
  tips = {},
}: {
  index: number;
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
  const nameOf = (id: number) => abilities[id]?.name ?? `Spell ${id}`;
  const ability = (id: number) => <Ability id={id} name={abilities[id]?.name} icon={abilities[id]?.icon} />;

  if (finding.kind === "death") {
    const d = finding.death;
    const story = stories[d.order];
    if (story?.burst.damage.length) {
      const main = story.burst.damage.slice(0, 3);
      const avoidable = main.filter((a) => avoidability[a.abilityId] === "avoidable");
      const tipped = main.find((a) => tips[a.abilityId]);
      const drop = story.lowWholeWindow
        ? "low health for 15s+"
        : `${story.burst.startHp != null ? percent(story.burst.startHp) : "healthy"} → 0 in ${(story.burst.beforeDeathMs / 1000).toFixed(1)}s`;
      return (
        <IssueRow
          index={index}
          severity={finding.severity}
          title={
            <>
              Died <span className="num">{fightTime(d.fightTimeMs)}</span> <span className="text-muted">·</span> {drop}
            </>
          }
        >
          <p className="text-fg/85">
            {main.map((a, i) => (
              <span key={a.abilityId}>
                {i > 0 && ", "}
                {ability(a.abilityId)}
              </span>
            ))}
            <span className="text-muted">. {deathContext(d, wipe)}</span>
          </p>
          {d.category !== "wipe" && reviews[d.order] && <SurvivalLine review={reviews[d.order]!} />}
          {d.category !== "wipe" && avoidable.length > 0 && (
            <p>{listNames(avoidable.map((a) => nameOf(a.abilityId)))}: most top players take none.</p>
          )}
          {d.category !== "wipe" && tipped && (
            <p>
              <span className="text-fg/85">{nameOf(tipped.abilityId)}:</span> {tips[tipped.abilityId]!.tip}
            </p>
          )}
          <a href={`#death-${d.order}`} className={`text-xs ${linkClass}`}>
            Death timeline
          </a>
        </IssueRow>
      );
    }
    const id = d.killingAbilityGameID;
    return (
      <IssueRow
        index={index}
        severity={finding.severity}
        title={
          <>
            Died <span className="num">{fightTime(d.fightTimeMs)}</span> to {id ? ability(id) : "unknown damage"}{" "}
            {id && <AvoidabilityBadge value={d.killingAvoidability} />}
          </>
        }
      >
        <p>{deathContext(d, wipe)}</p>
        <a href={`#death-${d.order}`} className={`text-xs ${linkClass}`}>
          Death details
        </a>
      </IssueRow>
    );
  }

  const a = finding.ability;
  return (
    <IssueRow
      index={index}
      severity={finding.severity}
      title={
        <>
          Hit by {ability(a.abilityId)} <span className="num text-muted">×{a.hits}</span> <AvoidabilityBadge value={a.classification} zeroShare={a.zeroShare} />
        </>
      }
    >
      <p>
        {a.zeroShare != null && `${percent(a.zeroShare)} of top players take none · `}
        <span className="num">{percent(a.share)}</span> of your damage taken (<span className="num">{compact(a.total)}</span>)
      </p>
      {tips[a.abilityId] && <p className="text-fg/85">{tips[a.abilityId]!.tip}</p>}
    </IssueRow>
  );
}

/** A strip across the pull showing every raid death, with this player's deaths marked. */
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
      <div className="relative h-8 border border-line bg-raised" role="img" aria-label="Deaths during the pull">
        {wipe && (
          <div
            className="absolute inset-y-0 bg-dmg/15"
            style={{ left: at(wipe.startMs), width: `max(4px, calc(${at(wipe.endMs)} - ${at(wipe.startMs)}))` }}
            title={`Wipe: ${wipe.deaths} deaths, ${fightTime(wipe.startMs)}–${fightTime(wipe.endMs)}`}
          />
        )}
        {deaths.map((d) => {
          const mine = d.targetID === playerId;
          return (
            <span
              key={d.order}
              title={`${fightTime(d.fightTimeMs)} ${names[d.targetID!] ?? "Unknown"}`}
              className={`absolute -translate-x-1/2 ${mine ? "inset-y-0 z-10 w-[3px] bg-fg" : "top-1/4 h-1/2 w-px bg-muted"}`}
              style={{ left: at(d.fightTimeMs) }}
            />
          );
        })}
      </div>
      <div className="num mt-1 flex justify-between text-[11px] text-faint">
        <span>0:00</span>
        <span className="flex gap-4 font-sans">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-[3px] bg-fg" /> you
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-px bg-muted" /> others
          </span>
          {wipe && (
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-3 bg-dmg/30" /> wipe
            </span>
          )}
        </span>
        <span>{fightTime(durationMs)}</span>
      </div>
    </div>
  );
}

const CATEGORY_LABEL: Record<ClassifiedDeath["category"], { label: string; tone: Tone }> = {
  early: { label: "before the wipe", tone: "red" },
  "wipe-start": { label: "start of the wipe", tone: "red" },
  wipe: { label: "during the wipe", tone: "slate" },
  "after-wipe": { label: "after the wipe", tone: "slate" },
};

export function categoryLabel(death: PlayerDeath, wipe: WipeEvent | null, kill: boolean): { label: string; tone: Tone } {
  return death.category === "early" && !wipe ? { label: kill ? "before the kill" : "mid-pull", tone: "red" } : CATEGORY_LABEL[death.category];
}

const TONE_TEXT: Record<Tone, string> = { red: "text-dmg", amber: "text-warn", green: "text-heal", slate: "text-faint", blue: "text-shield" };
export const toneText = (tone: Tone) => TONE_TEXT[tone];

/** Fallback when the timestamped story couldn't be built: damage by ability before death. */
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
  const category = categoryLabel(death, wipe, kill);
  return (
    <article id={`death-${death.order}`} className="scroll-mt-6 border-t border-line py-3">
      <header className="flex flex-wrap items-baseline gap-x-3 text-sm">
        <span className="font-semibold uppercase tracking-[0.07em] text-fg">
          Death <span className="num">{fightTime(death.fightTimeMs)}</span>
        </span>
        <span className={toneText(category.tone)}>{category.label}</span>
        <span className="text-faint">{ordinal(death.order)} in raid</span>
      </header>
      <p className="mt-2 text-sm text-muted">
        Damage taken, last {death.recap.windowMs / 1000}s: <span className="num text-fg">{compact(death.recap.total)}</span>
      </p>
      <ul className="mt-2 space-y-1">
        {death.recap.abilities.map((a) => {
          const killing = a.abilityId === death.killingAbilityGameID;
          return (
            <li key={a.abilityId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 text-sm">
              <span className="truncate">
                <Ability id={a.abilityId} name={abilities[a.abilityId]?.name} icon={abilities[a.abilityId]?.icon} />
                {killing && <span className="ml-2 text-xs text-dmg">killing blow</span>}
              </span>
              <span className="num text-fg/85">
                {compact(a.total)} <span className="text-faint">×{a.hits}</span>
              </span>
              <span className="col-span-2 h-1 bg-line" aria-hidden>
                <span className={`block h-full ${killing ? "bg-dmg" : "bg-muted"}`} style={{ width: `${(a.total / max) * 100}%` }} />
              </span>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
