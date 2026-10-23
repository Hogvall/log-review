import Link from "next/link";
import type { DeathCause, DpsCheck, RaidAbilityDamage } from "@log-review/analysis";
import { PullSelect } from "./pull-select";
import { AvoidabilityBadge } from "./report";
import { Ability, Breadcrumbs, linkClass } from "./ui";
import { ViewNav } from "./view-nav";
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
  // The personal view of the same thing: this player's pull, the pull's player list, or the report.
  const personalHref = pull ? (actor ? `/r/${code}/${pull}/${actor.id}` : `/r/${code}/${pull}`) : `/r/${code}`;
  const chip = (scope: RaidScope, label: string) => (
    <Link
      key={label}
      href={`${base}?scope=${scopeParam(scope)}`}
      aria-current={sameScope(scope, view.scope) ? "true" : undefined}
      className={`border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.1em] ${
        sameScope(scope, view.scope) ? "border-fg bg-fg text-ink" : "border-line text-fg hover:border-fg"
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
      <ViewNav active="raid" personalHref={personalHref} raidHref={`${base}${q}`} />
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
              page === t.id ? "border-fg text-fg" : "border-transparent text-faint hover:text-muted"
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
  const span = Math.max(check.projectedKillMs, ref?.p75 ?? 0, ...check.pulls.map((p) => p.durationMs)) * 1.08;
  const at = (ms: number) => `${(ms / span) * 100}%`;
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

      {/* Projected kill time against the kill-time bar. */}
      <div className="mt-4 max-w-2xl" aria-hidden>
        <div className="relative h-8 border-b border-line">
          {ref && <div className="absolute inset-y-0 bg-heal/15" style={{ left: 0, width: at(ref.p75) }} title="Where kills land" />}
          {ref && <div className="absolute inset-y-0 w-px bg-heal" style={{ left: at(ref.median) }} />}
          {firstDeath != null && <div className="absolute inset-y-0 w-px bg-dmg" style={{ left: at(firstDeath) }} />}
          <div className={`absolute top-1 bottom-1 w-[3px] -translate-x-1/2 ${v.bar}`} style={{ left: at(check.projectedKillMs) }} />
        </div>
        <div className="relative mt-1 h-4 text-[11px] text-faint">
          {ref && (
            <span className="num absolute -translate-x-1/2 text-heal" style={{ left: at(ref.median) }}>
              kills {fightTime(ref.median)}
            </span>
          )}
          <span className={`num absolute -translate-x-1/2 ${v.tone}`} style={{ left: at(check.projectedKillMs) }}>
            you {fightTime(check.projectedKillMs)}
          </span>
        </div>
        {firstDeath != null && <p className="mt-1 text-[11px] text-faint"><span className="text-dmg">|</span> first death that matters, typically</p>}
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

/** Who takes the most avoidable damage. */
export function AvoidableByPlayer({ view, code, limit = 8 }: { view: RaidView; code: string; limit?: number }) {
  const rows = view.players.filter((p) => p.avoidable > 0).sort((a, b) => b.avoidablePerPull - a.avoidablePerPull).slice(0, limit);
  if (!rows.length) return <p className="py-2 text-sm text-heal">Nobody took avoidable damage.</p>;
  const max = rows[0]!.avoidablePerPull || 1;
  const href = (id: number) => `/r/${code}/raid/${view.encounterId}-${view.difficulty}/players/${id}?scope=${scopeParam(view.scope)}`;
  return (
    <ul className="max-w-2xl">
      {rows.map((p) => (
        <li key={p.id} className="border-b border-line/40">
          <Link href={href(p.id)} className="grid grid-cols-[9rem_minmax(0,1fr)_5rem] items-center gap-3 py-1.5 text-sm hover:bg-panel">
            <span className="truncate font-medium" style={{ color: classColor(p.classSlug) }}>
              {p.name}
            </span>
            <span className="h-2 bg-line">
              <span className="block h-full bg-dmg" style={{ width: `${(p.avoidablePerPull / max) * 100}%` }} />
            </span>
            <span className="num text-right text-fg/85" title={`${p.avoidableHits} avoidable hits in total`}>
              {compact(p.avoidablePerPull)}
              {view.scoped.length > 1 && <span className="text-faint">/pull</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
