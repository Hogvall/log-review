import type { ReactNode } from "react";
import type { Avoidability, ClassifiedDeath, DeathStory, DefensiveReview, Finding, PlayerDeath, Severity, WipeEvent } from "@log-review/analysis";
import type { AbilityTip } from "@log-review/encounters";
import { Ability, type Tone, linkClass } from "./ui";
import { classColor, compact, fightTime, ordinal, percent } from "@/lib/format";

export type AbilityInfo = Record<number, { name: string; icon: string }>;

const AVOIDABILITY: Record<Avoidability, { label: string; className: string; help: string }> = {
  avoidable: { label: "avoidable", className: "text-dmg", help: "Most top players take no damage from this." },
  situational: { label: "situational", className: "text-warn", help: "Some top players take it: a soak, or role/position dependent." },
  unavoidable: { label: "unavoidable", className: "text-faint", help: "Almost everyone takes it. Survive it with defensives and healing." },
  "raid-wide": {
    label: "raid-wide",
    className: "text-warn",
    help: "Only happens when the raid misses a mechanic (an add, a soak, an interrupt, the tank's position), and then it hits nearly everyone. Not caused by where you stood.",
  },
  targeted: {
    label: "targeted",
    className: "text-faint",
    help: "The boss picks who takes this (a mark, a tether, an uninterrupted bolt). Moving doesn't avoid it: follow the mechanic and use a defensive if it hurts.",
  },
  "tank-mechanic": {
    label: "tank mechanic",
    className: "text-faint",
    help: "Tanks take this on purpose (boss melee, tank busters) and other roles don't. Not a mistake: use defensives for the big hits.",
  },
};

export function AvoidabilityBadge({
  value,
  zeroShare,
  fightShare,
  raidBreadth,
  tank,
}: {
  value: Avoidability | null;
  zeroShare?: number | null;
  fightShare?: number | null;
  raidBreadth?: number | null;
  tank?: boolean;
}) {
  if (!value) return <span className="text-xs text-faint" title="No top-player data for this ability yet.">–</span>;
  const info = AVOIDABILITY[value];
  // A tank's labels come from top tanks in the same fights.
  const detail =
    value === "raid-wide" && fightShare != null && raidBreadth != null
      ? ` It happened in ${percent(fightShare)} of top kills, hitting ${percent(raidBreadth)} of the raid.`
      : zeroShare != null
        ? ` ${percent(zeroShare)} of top ${tank ? "tanks" : "players"} took none.`
        : "";
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
      if (d.category === "wipe") {
        return (
          <IssueRow
            index={index}
            severity={finding.severity}
            title={
              <>
                Died <span className="num">{fightTime(d.fightTimeMs)}</span> in the wipe{" "}
                <span className="font-normal text-muted">
                  ({wipe?.deaths ?? "many"} deaths in {wipe ? Math.max(1, Math.round((wipe.endMs - wipe.startMs) / 1000)) : "a few"}s)
                </span>
              </>
            }
          >
            <p>
              The raid was already going down, so this one is probably not on you. Mostly{" "}
              {main.map((a, i) => (
                <span key={a.abilityId}>
                  {i > 0 && ", "}
                  {ability(a.abilityId)}
                </span>
              ))}
              .
            </p>
            <p className="flex gap-4 text-xs">
              <a href="#raid-deaths" className={linkClass}>
                Who died first
              </a>
              <a href={`#death-${d.order}`} className={linkClass}>
                Your death timeline
              </a>
            </p>
          </IssueRow>
        );
      }
      return (
        <IssueRow
          index={index}
          severity={finding.severity}
          title={
            <>
              Died <span className="num">{fightTime(d.fightTimeMs)}</span>
              {d.category === "wipe-start" && " at the start of the wipe"} <span className="text-muted">·</span> {drop}
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
          {reviews[d.order] && <SurvivalLine review={reviews[d.order]!} />}
          {avoidable.length > 0 && (
            <p>{listNames(avoidable.map((a) => nameOf(a.abilityId)))}: most top players take none.</p>
          )}
          {tipped && (
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

const PHASE: Record<ClassifiedDeath["category"], { label: string; className: string }> = {
  early: { label: "before wipe", className: "text-dmg" },
  "wipe-start": { label: "wipe start", className: "text-warn" },
  wipe: { label: "wipe", className: "text-faint" },
  "after-wipe": { label: "after wipe", className: "text-faint" },
};

/** Every death in the pull in order, so it's clear who went first. The bulk of the wipe is folded away. */
export function RaidDeathsTable({
  deaths,
  playerId,
  names,
  classes,
  abilities,
  kill,
  wipe,
}: {
  deaths: ClassifiedDeath[];
  playerId: number;
  names: Record<number, string>;
  classes: Record<number, string>;
  abilities: AbilityInfo;
  kill: boolean;
  wipe: WipeEvent | null;
}) {
  if (!deaths.length) return null;
  const firstWipe = deaths.find((d) => d.category === "wipe-start" || d.category === "wipe");
  const firstAfter = deaths.find((d) => d.category === "after-wipe");
  // A thin labeled row where the wipe starts and where it ends, so the full list still reads in phases.
  const divider = (key: string, label: string) => (
    <tr key={key}>
      <td colSpan={5} className="pt-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-dmg/80">
        {label}
      </td>
    </tr>
  );
  const rows = deaths.flatMap((d) => [
    ...(d === firstWipe && wipe
      ? [divider("wipe", `Wipe · ${wipe.deaths} deaths, ${fightTime(wipe.startMs)}–${fightTime(wipe.endMs)}`)]
      : []),
    ...(d === firstAfter ? [divider("after", "After the wipe")] : []),
    row(d),
  ]);
  function row(d: ClassifiedDeath) {
    const isMe = d.targetID === playerId;
    const id = d.killingAbilityGameID;
    const phase = d.category === "early" && kill ? { label: "before kill", className: "text-dmg" } : PHASE[d.category];
    return (
      <tr key={d.order} className={`border-b border-line/40 ${isMe ? "bg-raised" : ""}`}>
        <td className="num py-1 pr-3 text-faint">{d.order}</td>
        <td className="num py-1 pr-3 text-muted">{fightTime(d.fightTimeMs)}</td>
        <td className="py-1 pr-3">
          <span className={isMe ? "font-semibold" : ""} style={{ color: classColor(classes[d.targetID!] ?? "") }}>
            {names[d.targetID!] ?? "Unknown"}
          </span>
          {isMe && <span className="ml-1.5 text-xs text-fg">(you)</span>}
        </td>
        <td className="py-1 pr-3 text-fg/85">{id ? <Ability id={id} name={abilities[id]?.name} icon={abilities[id]?.icon} /> : "–"}</td>
        <td className={`py-1 text-xs ${phase.className}`}>{phase.label}</td>
      </tr>
    );
  }
  const head = (
    <thead className="text-left text-[11px] uppercase tracking-[0.07em] text-faint">
      <tr className="border-b border-line">
        <th className="pb-1 pr-3 font-medium">#</th>
        <th className="pb-1 pr-3 font-medium">Time</th>
        <th className="pb-1 pr-3 font-medium">Player</th>
        <th className="pb-1 pr-3 font-medium">Killed by</th>
        <th className="pb-1 font-medium">When</th>
      </tr>
    </thead>
  );
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[480px] text-sm">
        {head}
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

/** One line at the top: how many times you died this pull, and when. */
export function DeathsSummary({ deaths, wipe, kill }: { deaths: PlayerDeath[]; wipe: WipeEvent | null; kill: boolean }) {
  if (!deaths.length) return <p className="text-sm text-heal">No deaths this pull.</p>;
  const phase = (d: PlayerDeath) => categoryLabel(d, wipe, kill);
  return (
    <p className="text-sm">
      <span className={deaths.length > 1 ? "font-semibold text-dmg" : "font-medium text-fg"}>
        Died {deaths.length === 1 ? "once" : `${deaths.length} times`}
      </span>
      <span className="text-muted">: </span>
      {deaths.map((d, i) => {
        const p = phase(d);
        return (
          <span key={d.order}>
            {i > 0 && <span className="text-faint"> · </span>}
            <a href={`#death-${d.order}`} className={linkClass}>
              <span className="num">{fightTime(d.fightTimeMs)}</span>
            </a>{" "}
            <span className={toneText(p.tone)}>{p.label}</span>
          </span>
        );
      })}
      {deaths.length > 1 && <span className="text-muted"> (battle-ressed in between)</span>}
    </p>
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
