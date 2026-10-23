import Link from "next/link";
import type { DeathCause, DpsCheck, RaidAbilityDamage } from "@log-review/analysis";
import { PullSelect } from "./pull-select";
import { AvoidabilityBadge } from "./report";
import { Ability, Breadcrumbs, linkClass, textOn } from "./ui";
import { type RaidScope, type RaidView, scopeParam } from "@/lib/raid";
import { classColor, compact, difficultyName, fightTime, percent } from "@/lib/format";

const th = "pb-1 pr-3 font-medium";
const theadClass = "text-left text-[11px] uppercase tracking-[0.07em] text-faint";

export const scopeLabel = (view: Pick<RaidView, "scope" | "pulls">) => {
  const s = view.scope;
  if (s.kind === "pull") return `pull ${view.pulls.find((p) => p.id === s.fightId)?.pull ?? "?"}`;
  return s.kind === "all" ? "all pulls" : s.kind === "wipes" ? "all wipes" : "the kill";
};

const sameScope = (a: RaidScope, b: RaidScope) => scopeParam(a) === scopeParam(b);

/** Breadcrumbs, the view switch, the boss title, the scope picker and the Raid / Players switch. */
export function RaidHeader({ view, code, page, actor }: { view: RaidView; code: string; page: "raid" | "players"; actor?: { id: number; name: string } }) {
  const boss = `${view.encounterId}-${view.difficulty}`;
  const base = `/r/${code}/raid/${boss}${page === "players" ? `/players${actor ? `/${actor.id}` : ""}` : ""}`;
  const q = `?scope=${scopeParam(view.scope)}`;
  const pull = view.scope.kind === "pull" ? view.scope.fightId : null;
  const chip = (scope: RaidScope, label: string) => (
    <Link
      key={label}
      href={`${base}?scope=${scopeParam(scope)}`}
      aria-current={sameScope(scope, view.scope) ? "true" : undefined}
      className={`border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.1em] ${
        sameScope(scope, view.scope) ? "border-gold bg-gold text-ink" : "border-line text-fg hover:border-gold"
      }`}
    >
      {label}
    </Link>
  );
  const kills = view.pulls.filter((p) => p.kill).length;
  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: view.report.title, href: `/r/${code}?view=raid` },
          { label: view.name, href: actor ? `/r/${code}/raid/${boss}/players${q}` : undefined },
          ...(actor ? [{ label: actor.name }] : []),
        ]}
      />
      <h1 className="text-2xl font-semibold text-fg">
        {actor ? `${actor.name} on ${view.name}` : view.name} <span className="text-muted">{difficultyName(view.difficulty)}</span>
      </h1>
      <p className="text-sm text-muted">
        {view.pulls.length} pulls{view.resets > 0 && ` (${view.resets} under 30s skipped as resets)`} ·{" "}
        {view.kill ? <span className="text-heal">killed on pull {view.kill.pull}</span> : <>no kill yet</>} · showing{" "}
        <span className="text-fg">{scopeLabel(view)}</span>
        {view.scope.kind !== "pull" && ` (${view.scoped.length} ${view.scoped.length === 1 ? "pull" : "pulls"})`}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {chip({ kind: "all" }, "All pulls")}
        {chip({ kind: "wipes" }, "All wipes")}
        {kills > 0 && chip({ kind: "kill" }, kills === 1 ? "The kill" : "Kills")}
        <PullSelect
          baseHref={base}
          value={pull}
          pulls={[...view.pulls].reverse().map((p) => ({
            id: p.id,
            label: `Pull ${p.pull} · ${p.kill ? "kill" : `${p.bossPercentage?.toFixed(1)}%`} · ${fightTime(p.endTime - p.startTime)}`,
          }))}
        />
      </div>
      <nav aria-label="Raid pages" className="mt-4 flex border-b border-line">
        {[
          { id: "raid", label: "Whole raid", href: `/r/${code}/raid/${boss}${q}` },
          { id: "players", label: actor ? "Players" : "Players", href: `/r/${code}/raid/${boss}/players${q}` },
        ].map((t) => (
          <Link
            key={t.id}
            href={t.href}
            aria-current={page === t.id ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.07em] ${
              page === t.id ? "border-gold text-fg" : "border-transparent text-muted hover:text-fg"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** The scope's pulls as bars of boss health left, linking to each pull. */
export function PullStrip({ view, code }: { view: RaidView; code: string }) {
  if (view.scoped.length < 2) return null;
  const base = `/r/${code}/raid/${view.encounterId}-${view.difficulty}`;
  return (
    <div className="flex h-16 items-end gap-px" aria-label="Boss health left at the end of each pull">
      {view.scoped.map((p) => (
        <Link
          key={p.id}
          href={`${base}?scope=${p.id}`}
          title={`Pull ${p.pull}: ${p.kill ? "kill" : `${p.bossPercentage?.toFixed(1)}% left`} · ${fightTime(p.endTime - p.startTime)}`}
          className="group flex h-full min-w-[3px] flex-1 flex-col justify-end"
        >
          <span
            className={`block w-full group-hover:opacity-70 ${p.kill ? "bg-heal" : "bg-muted/70"}`}
            style={{ height: `${p.kill ? 100 : Math.max(4, 100 - (p.bossPercentage ?? 100))}%` }}
          />
        </Link>
      ))}
    </div>
  );
}

const perPull = (n: number) => n.toFixed(n < 1 ? 2 : 1);

function Trend({ cause }: { cause: DeathCause }) {
  const { firstHalfRate: a, secondHalfRate: b } = cause;
  const label = b < a * 0.7 ? "getting better" : b > a * 1.3 ? "getting worse" : "about the same";
  const tone = b < a * 0.7 ? "text-heal" : b > a * 1.3 ? "text-dmg" : "text-muted";
  return (
    <span className="whitespace-nowrap text-xs" title="Deaths that mattered per pull, first half of these pulls → second half">
      <span className="num text-fg/85">
        {perPull(a)} → {perPull(b)}
      </span>{" "}
      <span className={tone}>{label}</span>
    </span>
  );
}

export function DeathCauses({ view, code }: { view: RaidView; code: string }) {
  const { deaths, abilities, tips } = view;
  if (!deaths.causes.length) return <p className="py-2 text-sm text-muted">No deaths in {scopeLabel(view)}.</p>;
  const shown = deaths.causes.filter((c) => c.mattered > 0).slice(0, 12);
  const several = view.scoped.length > 1;
  const playerHref = (id: number) => `/r/${code}/raid/${view.encounterId}-${view.difficulty}/players/${id}?scope=${scopeParam(view.scope)}`;
  return (
    <>
      <p className="mb-2 text-sm text-muted">
        {deaths.mattered} of {deaths.total} deaths mattered: before the wipe, or among its first deaths. Each death is put down to what did the
        most damage in the seconds before it, not the killing blow.
        {deaths.firstDeathMedianMs != null && (
          <>
            {" "}
            The first death that mattered came at <span className="num text-fg">{fightTime(deaths.firstDeathMedianMs)}</span>
            {several ? " in a typical pull" : ""}.
          </>
        )}
      </p>
      {shown.length === 0 ? (
        <p className="py-2 text-sm text-heal">Nobody died before the wipe.</p>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead className={theadClass}>
              <tr className="border-b border-line">
                <th className={th}>Died to</th>
                <th className={`${th} text-right`}>Deaths</th>
                {several && <th className={`${th} text-right`}>Pulls</th>}
                <th className={th}>Who</th>
                {several && <th className="pb-1 font-medium">Per pull</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.abilityId} className="border-b border-line/40 align-top">
                  <td className="py-1.5 pr-3">
                    <Ability id={c.abilityId} name={c.name} icon={abilities[c.abilityId]?.icon} />
                    {c.often && <span className="block text-xs text-muted">often with {c.often.name}</span>}
                    {tips[c.abilityId] && <span className="mt-0.5 block max-w-sm text-xs text-muted">{tips[c.abilityId]!.tip}</span>}
                  </td>
                  <td className="num py-1.5 pr-3 text-right text-fg" title={`${c.all} deaths in total, counting during and after the wipe`}>
                    {c.mattered}
                  </td>
                  {several && <td className="num py-1.5 pr-3 text-right text-muted">{c.pulls}</td>}
                  <td className="py-1.5 pr-3 text-xs">
                    {c.players.slice(0, 5).map((p, i) => (
                      <span key={p.playerId}>
                        {i > 0 && ", "}
                        <Link href={playerHref(p.playerId)} className="hover:underline" style={{ color: classColor(view.classes[p.playerId] ?? "") }}>
                          {p.name}
                        </Link>
                        {p.count > 1 && <span className="num text-faint"> ×{p.count}</span>}
                      </span>
                    ))}
                    {c.players.length > 5 && <span className="text-faint"> +{c.players.length - 5} more</span>}
                  </td>
                  {several && (
                    <td className="py-1.5">
                      <Trend cause={c} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const VERDICT: Record<DpsCheck["verdict"], { title: string; tone: string; bar: string }> = {
  enough: { title: "The damage is enough", tone: "text-heal", bar: "bg-heal" },
  close: { title: "The damage is close", tone: "text-warn", bar: "bg-warn" },
  short: { title: "Short on damage", tone: "text-dmg", bar: "bg-dmg" },
  unknown: { title: "Not enough kill data to judge damage yet", tone: "text-muted", bar: "bg-muted" },
};

/** Is the raid's damage enough to kill the boss? Or, for a kill, how long it took next to other raids' kills. */
export function DamageCheck({ view, code }: { view: RaidView; code: string }) {
  const { check, deaths, pulls } = view;
  const base = `/r/${code}/raid/${view.encounterId}-${view.difficulty}`;
  const killPull = view.damagePulls[0]?.kill ? view.damagePulls[0] : null;
  if (killPull) {
    const ref = view.referenceKills.length >= 10 ? [...view.referenceKills].sort((a, b) => a - b) : null;
    const median = ref ? ref[Math.floor(ref.length / 2)]! : null;
    const length = killPull.endTime - killPull.startTime;
    return (
      <p className="py-2 text-sm text-fg/85">
        <span className="text-heal">Killed on pull {killPull.pull}</span> in <span className="num text-fg">{fightTime(length)}</span>.
        {median != null && (
          <>
            {" "}
            Raids that kill it take <span className="num text-fg">{fightTime(median)}</span> (median of {ref!.length} kills): this kill was{" "}
            {length <= median ? "faster than most" : `${percent(length / median - 1)} longer`}.
          </>
        )}{" "}
        For progress, look at {view.scope.kind === "kill" ? <Link className={linkClass} href={`${base}?scope=wipes`}>all wipes</Link> : "the wipes"}.
      </p>
    );
  }
  if (!check || check.projectedKillMs == null) return <p className="py-2 text-sm text-muted">Not enough damage data in {scopeLabel(view)} to check yet.</p>;
  const v = VERDICT[check.verdict];
  const ref = check.reference;
  const pullNo = (id: number) => pulls.find((p) => p.id === id)?.pull;
  const firstDeath = deaths.firstDeathMedianMs;
  // Boss health removed at a steady rate: what's left when the slower quarter of kills finish.
  const left = ref ? Math.max(0, 1 - ref.p75 / check.projectedKillMs) : 0;
  return (
    <>
      <p className={`text-lg font-semibold ${v.tone}`}>{v.title}</p>
      <p className="mt-1 max-w-2xl text-sm text-fg/85">
        At the damage {view.damagePulls.length > 1 ? `the ${view.damagePulls.length} furthest pulls did` : "this pull did"} to the boss, it would die at
        about <span className="num text-fg">{fightTime(check.projectedKillMs)}</span>.
        {ref && (
          <>
            {" "}
            Raids that kill it take <span className="num text-fg">{fightTime(ref.median)}</span> (median of {ref.n} kills), and the slower quarter
            finish by <span className="num text-fg">{fightTime(ref.p75)}</span>.
          </>
        )}
        {check.verdict === "short" && check.neededIncrease != null && <> To kill it at that pace, the raid needs about {percent(check.neededIncrease)} more damage on the boss.</>}
        {check.verdict === "close" && check.neededIncrease != null && <> A few percent more ({percent(check.neededIncrease)}) gets you there: fewer deaths alone could cover it.</>}
        {check.verdict === "enough" && <> The wipes are about mechanics: see what people die to below.</>}
        {firstDeath != null && check.projectedKillMs > firstDeath && (
          <>
            {" "}
            People start dying at <span className="num text-fg">{fightTime(firstDeath)}</span>, before that point.
          </>
        )}
      </p>

      {/* The boss's health bar at the time kills usually finish, at this damage. */}
      {ref && (
        <div className="mt-4">
          <div className="flex flex-wrap items-baseline gap-3 text-sm">
            <span className="font-bold">{view.name}</span>
            <span className={v.tone}>
              {left > 0 ? `${percent(left)} left at ${fightTime(ref.p75)}` : `dead by ${fightTime(check.projectedKillMs)}`}
            </span>
          </div>
          <div
            className="relative mt-1.5 h-7 border-2 border-black bg-[#2a1215] shadow-[0_0_0_1px_#5a2a2e]"
            role="img"
            aria-label={`Boss at ${percent(left)} health when kills usually finish`}
          >
            <div className="absolute inset-y-0 left-0 bg-gradient-to-b from-[#e24a4a] to-[#9b1d1d]" style={{ width: percent(left, 1) }} />
            {Array.from({ length: 9 }, (_, i) => (
              <div key={i} className="absolute inset-y-0 w-px bg-black/60" style={{ left: `${(i + 1) * 10}%` }} />
            ))}
            <span className="absolute top-0.5 right-2.5 text-sm font-extrabold text-white">
              {check.neededIncrease != null && check.neededIncrease > 0 ? `needs +${percent(check.neededIncrease)} boss damage` : "enough damage"}
            </span>
          </div>
        </div>
      )}
      <div className="mt-3.5 grid gap-3 sm:grid-cols-3">
        <div className="bg-raised px-3 py-2.5">
          <div className="text-xs uppercase tracking-[0.08em] text-muted">Projected kill</div>
          <div className={`num text-2xl font-bold ${v.tone}`}>{fightTime(check.projectedKillMs)}</div>
        </div>
        <div className="bg-raised px-3 py-2.5">
          <div className="text-xs uppercase tracking-[0.08em] text-muted">Kills (median)</div>
          <div className="num text-2xl font-bold text-heal">{ref ? fightTime(ref.median) : "–"}</div>
        </div>
        <div className="bg-raised px-3 py-2.5">
          <div className="text-xs uppercase tracking-[0.08em] text-muted">First death that matters</div>
          <div className="num text-2xl font-bold">{firstDeath != null ? fightTime(firstDeath) : "–"}</div>
        </div>
      </div>

      <div className="-mx-4 mt-3 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[520px] max-w-2xl text-sm">
          <thead className={theadClass}>
            <tr className="border-b border-line">
              <th className={th}>Pull</th>
              <th className={`${th} text-right`}>Boss left</th>
              <th className={`${th} text-right`}>Length</th>
              <th className={`${th} text-right`}>Raid DPS on boss</th>
              <th className="pb-1 text-right font-medium">Would kill at</th>
            </tr>
          </thead>
          <tbody>
            {check.pulls.map((p) => (
              <tr key={p.pullId} className="border-b border-line/40">
                <td className="py-1.5 pr-3">
                  <Link href={`${base}?scope=${p.pullId}`} className={linkClass}>
                    Pull {pullNo(p.pullId)}
                  </Link>
                </td>
                <td className="num py-1.5 pr-3 text-right">{p.bossPercentage.toFixed(1)}%</td>
                <td className="num py-1.5 pr-3 text-right text-muted">{fightTime(p.durationMs)}</td>
                <td className="num py-1.5 pr-3 text-right">{compact(p.bossDps)}</td>
                <td className="num py-1.5 text-right">{p.projectedKillMs ? fightTime(p.projectedKillMs) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-faint">
        Boss health is estimated from how much damage took off how much health ({check.bossHealth ? compact(check.bossHealth) : "–"} in total; on
        council fights all bosses together). Kill times come from top players&apos; kills we&apos;ve downloaded, so they lean towards stronger raids.
        The projection assumes the raid keeps the same damage for the whole fight.
      </p>
    </>
  );
}

/** What the raid takes damage from, biggest first, with what top players avoid flagged. */
export function RaidDamageTable({ view, code, limit = 15 }: { view: RaidView; code: string; limit?: number }) {
  const { damageTaken, abilities, tips } = view;
  if (!damageTaken.abilities.length) return <p className="py-2 text-sm text-muted">No boss damage taken.</p>;
  const rows = damageTaken.abilities.slice(0, limit);
  const max = rows[0]?.total ?? 1;
  const playerHref = (id: number) => `/r/${code}/raid/${view.encounterId}-${view.difficulty}/players/${id}?scope=${scopeParam(view.scope)}`;
  const perPull = view.scoped.length > 1;
  return (
    <>
      <p className="mb-2 text-sm text-muted">
        {compact(damageTaken.total)} damage taken{perPull ? ` over ${damageTaken.pulls} pulls` : ""};{" "}
        <span className="text-dmg">{percent(damageTaken.total ? damageTaken.avoidable / damageTaken.total : 0)} avoidable</span> (abilities most top
        players take none of).
      </p>
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[680px] text-sm">
          <thead className={theadClass}>
            <tr className="border-b border-line">
              <th className={th}>Ability</th>
              <th className={th}>Type</th>
              <th className={`${th} w-40`}>Damage</th>
              <th className={`${th} text-right`}>{perPull ? "Hits/pull" : "Hits"}</th>
              <th className="pb-1 font-medium">Most hit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a: RaidAbilityDamage) => (
              <tr key={a.abilityId} className={`border-b border-line/40 align-top ${a.classification === "avoidable" ? "shadow-[inset_2px_0_0_var(--color-dmg)]" : ""}`}>
                <td className="py-1.5 pr-3 pl-2">
                  <Ability id={a.abilityId} name={abilities[a.abilityId]?.name} icon={abilities[a.abilityId]?.icon} />
                  {tips[a.abilityId] && <span className="mt-0.5 block max-w-sm text-xs text-muted">{tips[a.abilityId]!.tip}</span>}
                </td>
                <td className="py-1.5 pr-3">{a.classification ? <AvoidabilityBadge value={a.classification} /> : <span className="text-xs text-faint">no data</span>}</td>
                <td className="py-1.5 pr-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2 flex-1 bg-line">
                      <span className={`block h-full ${a.classification === "avoidable" ? "bg-dmg" : "bg-muted"}`} style={{ width: `${(a.total / max) * 100}%` }} />
                    </span>
                    <span className="num w-12 text-right text-fg/85">{compact(a.total)}</span>
                  </div>
                </td>
                <td className="num py-1.5 pr-3 text-right text-muted">{perPull ? (a.hits / damageTaken.pulls).toFixed(1) : a.hits}</td>
                <td className="py-1.5 text-xs">
                  {a.players.slice(0, 3).map((p, i) => (
                    <span key={p.playerId}>
                      {i > 0 && ", "}
                      <Link href={playerHref(p.playerId)} className="hover:underline" style={{ color: classColor(view.classes[p.playerId] ?? "") }}>
                        {view.names[p.playerId] ?? p.playerId}
                      </Link>{" "}
                      <span className="num text-faint">{percent(p.total / a.total)}</span>
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Raid frames: one tile per player in class color, filled red by their avoidable damage per pull. */
export function RaidFrames({ view, code }: { view: RaidView; code: string }) {
  const players = [...view.players].sort((a, b) => ROLE_ORDER[a.role ?? "none"]! - ROLE_ORDER[b.role ?? "none"]! || a.name.localeCompare(b.name));
  if (!players.length) return <p className="py-2 text-sm text-muted">No players in these pulls.</p>;
  const max = Math.max(1, ...players.map((p) => p.avoidablePerPull));
  const href = (id: number) => `/r/${code}/raid/${view.encounterId}-${view.difficulty}/players/${id}?scope=${scopeParam(view.scope)}`;
  return (
    <>
      <p className="mb-3 text-sm text-muted">
        Red fill = avoidable damage{view.scoped.length > 1 ? " per pull" : ""}, against the worst player. ☠ = deaths that mattered. Click a frame for that player.
      </p>
      <ul className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-5">
        {players.map((p) => {
          const color = classColor(p.classSlug);
          const ink = textOn(color);
          return (
            <li key={p.id}>
              <Link
                href={href(p.id)}
                title={`${p.name}: ${compact(p.avoidablePerPull)} avoidable${view.scoped.length > 1 ? " per pull" : ""}, ${p.avoidableHits} hits, ${p.deathsMattered} deaths that mattered`}
                className="relative block h-12 overflow-hidden border border-black hover:outline hover:outline-2 hover:outline-gold"
                style={{ background: color, color: ink }}
              >
                <span className="absolute inset-y-0 left-0 bg-[rgba(200,30,30,0.85)]" style={{ width: `${(p.avoidablePerPull / max) * 100}%` }} />
                <span className="absolute top-1 left-2 right-2 truncate text-[13px] font-bold">{p.name}</span>
                <span className="num absolute bottom-1 left-2 text-[11px] font-bold">{p.avoidable ? compact(p.avoidablePerPull) : "0"}</span>
                {p.deathsMattered > 0 && <span className="absolute right-2 bottom-1 text-xs font-extrabold">☠{p.deathsMattered}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

const ROLE_ORDER: Record<string, number> = { tank: 0, healer: 1, dps: 2, none: 3 };

const SLICE = {
  avoidable: { label: "avoidable", color: "var(--color-dmg)" },
  "raid-wide": { label: "raid-wide", color: "var(--color-gold)" },
  other: { label: "unavoidable, targeted or tank", color: "#3a4766" },
  unknown: { label: "no top-player data", color: "var(--color-line)" },
} as const;
type SliceKey = keyof typeof SLICE;
const sliceOf = (c: RaidAbilityDamage["classification"]): SliceKey => (c === "avoidable" || c === "raid-wide" ? c : c ? "other" : "unknown");

/** Where the raid's damage taken goes: a donut by avoidability, and the biggest abilities. */
export function DamageDonut({ view }: { view: RaidView }) {
  const { damageTaken, abilities } = view;
  if (!damageTaken.total) return <p className="py-2 text-sm text-muted">No boss damage taken.</p>;
  const totals: Record<SliceKey, number> = { avoidable: 0, "raid-wide": 0, other: 0, unknown: 0 };
  for (const a of damageTaken.abilities) totals[sliceOf(a.classification)] += a.total;
  // Circumference 100 at r=15.9, so dash lengths are percentages.
  let offset = 25;
  const slices = (Object.keys(SLICE) as SliceKey[]).map((k) => {
    const share = (totals[k] / damageTaken.total) * 100;
    const slice = { key: k, share, offset };
    offset -= share;
    return slice;
  });
  const avoidableShare = totals.avoidable / damageTaken.total;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg width="170" height="170" viewBox="0 0 42 42" role="img" aria-label={`Damage taken: ${percent(avoidableShare)} avoidable`} className="shrink-0">
        <circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--color-line)" strokeWidth="6" />
        {slices.map((s) =>
          s.share > 0 ? (
            <circle key={s.key} cx="21" cy="21" r="15.9" fill="none" stroke={SLICE[s.key].color} strokeWidth="6" strokeDasharray={`${s.share} ${100 - s.share}`} strokeDashoffset={s.offset} />
          ) : null,
        )}
        <text x="21" y="21" textAnchor="middle" className="fill-fg" style={{ font: "800 7px var(--font-sans)" }}>
          {percent(avoidableShare)}
        </text>
        <text x="21" y="27" textAnchor="middle" className="fill-muted" style={{ font: "2.6px var(--font-mono)" }}>
          AVOIDABLE
        </text>
      </svg>
      <div className="min-w-0 flex-[1_1_260px]">
        {damageTaken.abilities.slice(0, 5).map((a) => (
          <div key={a.abilityId} className="grid grid-cols-[12px_minmax(0,1fr)_4.5rem] items-center gap-2.5 border-b border-line py-2">
            <span className="h-3 w-3" style={{ background: SLICE[sliceOf(a.classification)].color }} />
            <span className="min-w-0 truncate">
              <Ability id={a.abilityId} name={abilities[a.abilityId]?.name} icon={abilities[a.abilityId]?.icon} />{" "}
              <span className="text-[13px] text-muted">{SLICE[sliceOf(a.classification)].label}</span>
            </span>
            <span className="num text-right">{compact(a.total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
