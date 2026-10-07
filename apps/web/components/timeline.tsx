import { type CastMark, type TimelineReview, activityCpm, activityIdleShare } from "@log-review/analysis";
import type { AbilityInfo } from "./report";
import { Ability } from "./ui";
import { abilityIconUrl, fightTime, percent, wowheadSpellUrl } from "@/lib/format";

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function Heading({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mb-2">
      <h3 className="font-medium text-fg">{children}</h3>
      {hint && <p className="text-xs text-faint">{hint}</p>}
    </div>
  );
}

/** What the player hardcast before the pull, and when they first pressed something. */
export function PullStart({ timeline, abilities }: { timeline: TimelineReview; abilities: AbilityInfo }) {
  const first = timeline.opener.you[0];
  const topFirst = timeline.opener.top?.[0];
  return (
    <div>
      <Heading>Start of the pull</Heading>
      <p className="text-sm text-fg/85">
        {timeline.precasts.length ? (
          <>
            Precast:{" "}
            {timeline.precasts.map((id, i) => (
              <span key={id}>
                {i > 0 && ", "}
                <Ability id={id} name={abilities[id]?.name} icon={abilities[id]?.icon} />
              </span>
            ))}
            , landing as the pull started.
          </>
        ) : first ? (
          <>
            No precast spell found. Your first cast landed at <span className="num">{secs(first[0])}</span>
            {topFirst ? (
              <>
                {" "}
                (#1: <span className="num">{secs(topFirst[0])}</span>)
              </>
            ) : null}
            .
          </>
        ) : (
          "No casts in the first 30 seconds."
        )}
      </p>
      {timeline.topPrecast && (
        <p className="text-xs text-faint">
          {percent(timeline.topPrecast.share)} of top players precast
          {timeline.topPrecast.abilityId != null && timeline.topPrecast.share > 0 && (
            <>
              , most often <Ability id={timeline.topPrecast.abilityId} name={abilities[timeline.topPrecast.abilityId]?.name} icon={abilities[timeline.topPrecast.abilityId]?.icon} />
            </>
          )}
          .
        </p>
      )}
    </div>
  );
}

function CastStrip({ casts, windowMs, cooldowns, abilities }: { casts: CastMark[]; windowMs: number; cooldowns: Set<number>; abilities: AbilityInfo }) {
  return (
    <div className="relative h-7 bg-line/40">
      {casts.map(([t, id], i) => {
        const a = abilities[id];
        const big = cooldowns.has(id);
        return (
          <a
            key={i}
            href={wowheadSpellUrl(id)}
            target="_blank"
            rel="noreferrer"
            title={`${secs(t)} ${a?.name ?? `Spell ${id}`}`}
            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 ${big ? "z-10 outline outline-2 outline-warn" : ""}`}
            style={{ left: `${(t / windowMs) * 100}%` }}
          >
            {a?.icon ? (
              <img src={abilityIconUrl(a.icon)} alt={a.name} width={big ? 20 : 16} height={big ? 20 : 16} className="block outline outline-1 outline-black/60" />
            ) : (
              <span className="block h-4 w-1.5 bg-fg" />
            )}
          </a>
        );
      })}
    </div>
  );
}

/** The first 30 seconds as cast strips, plus when each cooldown was first pressed. */
export function Opener({ timeline, abilities, topName }: { timeline: TimelineReview; abilities: AbilityInfo; topName: string | null }) {
  const { opener } = timeline;
  const cooldowns = new Set(opener.firstUses.map((f) => f.abilityId));
  const late = new Map(timeline.findings.flatMap((f) => (f.kind === "late-cooldown" ? [[f.abilityId, f.playerMs - f.topMs] as const] : [])));
  const hasMedian = opener.firstUses.some((f) => f.median);
  const ticks = Array.from({ length: opener.windowMs / 5000 + 1 }, (_, i) => i * 5000);
  return (
    <div>
      <Heading
        hint={
          <>
            Every cast in the first {opener.windowMs / 1000} seconds next to the #1 player's. Cooldowns are outlined. Hover an icon for its time.
            {hasMedian && " First uses compare with the top players' median (Top) and #1."}
          </>
        }
      >
        Opener
      </Heading>
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="grid min-w-[640px] grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 text-xs text-muted">
          <span>You</span>
          <CastStrip casts={opener.you} windowMs={opener.windowMs} cooldowns={cooldowns} abilities={abilities} />
          {opener.top && (
            <>
              <span className="truncate" title={topName ?? undefined}>
                #1
              </span>
              <CastStrip casts={opener.top} windowMs={opener.windowMs} cooldowns={cooldowns} abilities={abilities} />
            </>
          )}
          <span />
          <div className="relative h-4 text-faint">
            {ticks.map((t) => (
              <span key={t} className="num absolute -translate-x-1/2" style={{ left: `${(t / opener.windowMs) * 100}%` }}>
                {t / 1000}s
              </span>
            ))}
          </div>
        </div>
      </div>

      {opener.firstUses.length > 0 && (
        <table className="mt-3 w-full max-w-lg text-sm">
          <thead className="text-left text-[11px] uppercase tracking-[0.07em] text-faint">
            <tr className="border-b border-line">
              <th className="pb-1 pr-3 font-medium">First used</th>
              <th className="pb-1 pr-3 text-right font-medium">You</th>
              {hasMedian && <th className="pb-1 pr-3 text-right font-medium">Top</th>}
              <th className="pb-1 pr-3 text-right font-medium">#1</th>
              <th className="pb-1 text-right font-medium" />
            </tr>
          </thead>
          <tbody>
            {opener.firstUses.map((f) => (
              <tr key={f.abilityId} className="border-b border-line/40">
                <td className="py-1.5 pr-3">
                  <Ability id={f.abilityId} name={abilities[f.abilityId]?.name} icon={abilities[f.abilityId]?.icon} />
                </td>
                <td className={`num py-1.5 pr-3 text-right ${late.has(f.abilityId) ? "text-dmg" : "text-fg/85"}`}>
                  {f.player == null ? "never" : secsOrClock(f.player)}
                </td>
                {hasMedian && (
                  <td className="num py-1.5 pr-3 text-right text-muted" title={f.median ? `${percent(f.median.usedBy)} of top players use it` : undefined}>
                    {f.median ? secsOrClock(f.median.median) : "–"}
                  </td>
                )}
                <td className="num py-1.5 pr-3 text-right text-faint">{f.top == null ? "–" : secsOrClock(f.top)}</td>
                <td className="num py-1.5 text-right text-xs text-dmg">{late.get(f.abilityId) != null ? `${secs(late.get(f.abilityId)!)} late` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Seconds in the opener, m:ss later in the fight. */
const secsOrClock = (ms: number) => (ms < 60_000 ? secs(ms) : fightTime(ms));

/** Casts per minute and idle time in each boss phase (or minute): you vs top players' median, or #1 without one. */
export function PhaseActivityTable({ timeline }: { timeline: TimelineReview }) {
  const hasMedian = timeline.phases.some((p) => p.median);
  const hasTop = hasMedian || timeline.phases.some((p) => p.top);
  const topLabel = hasMedian ? "Top" : "#1";
  const longest = [...timeline.gaps].sort((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs)).slice(0, 5);
  return (
    <div>
      <Heading
        hint={
          <>
            Idle means {"≥"}4 seconds without finishing a cast while alive. {timeline.byPhase ? "Repeated phases are added together." : "This boss has no phases, so the fight is split into minutes."}
            {hasMedian && ` Top is the median of ${timeline.sampleSize} top players.`}
          </>
        }
      >
        Through the fight
      </Heading>
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-[11px] uppercase tracking-[0.07em] text-faint">
            <tr className="border-b border-line">
              <th className="pb-1 pr-3 font-medium">{timeline.byPhase ? "Phase" : "Window"}</th>
              <th className="pb-1 pr-3 text-right font-medium">Time</th>
              <th className="pb-1 pr-3 text-right font-medium">Casts/min</th>
              {hasTop && <th className="pb-1 pr-3 text-right font-medium">{topLabel}</th>}
              <th className="pb-1 pr-3 text-right font-medium">Idle</th>
              {hasTop && <th className="pb-1 text-right font-medium">{topLabel}</th>}
            </tr>
          </thead>
          <tbody>
            {timeline.phases.map((p) => {
              const you = p.you;
              const ref = hasMedian
                ? p.median && { cpm: p.median.cpm.median, idleShare: p.median.idleShare.median }
                : p.top && { cpm: activityCpm(p.top), idleShare: activityIdleShare(p.top) };
              // Compare idle as a share of the phase: phases last different times in different kills.
              const idleShare = you ? activityIdleShare(you) : 0;
              const badIdle = you != null && ref != null && idleShare - ref.idleShare >= 0.05 && you.idleMs >= 5000;
              const lowCpm = you != null && ref != null && activityCpm(you) < ref.cpm * 0.9;
              return (
                <tr key={p.id} className="border-b border-line/40">
                  <td className={`py-1.5 pr-3 ${p.intermission ? "text-muted" : "text-fg"}`}>{p.name}</td>
                  <td className="num py-1.5 pr-3 text-right text-muted">{you ? fightTime(you.durationMs) : "dead"}</td>
                  <td className={`num py-1.5 pr-3 text-right ${lowCpm ? "text-dmg" : "text-fg/85"}`}>{you ? activityCpm(you).toFixed(1) : "–"}</td>
                  {hasTop && <td className="num py-1.5 pr-3 text-right text-muted">{ref ? ref.cpm.toFixed(1) : "–"}</td>}
                  <td className={`num py-1.5 pr-3 text-right ${badIdle ? "text-dmg" : "text-fg/85"}`}>
                    {you ? `${Math.round(you.idleMs / 1000)}s` : "–"}
                    {you && you.durationMs > 0 && <span className="text-xs text-faint"> {percent(idleShare)}</span>}
                  </td>
                  {hasTop && <td className="num py-1.5 text-right text-muted">{ref ? percent(ref.idleShare) : "–"}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-sm text-fg/85">
        Idle in total: <span className="num">{Math.round(timeline.idleMs / 1000)}s</span>
        {timeline.medianIdleMs != null ? (
          <>
            {" "}
            vs <span className="num">{Math.round(timeline.medianIdleMs / 1000)}s</span> for top players (median) over the same time
          </>
        ) : timeline.topIdleMs != null ? (
          <>
            {" "}
            vs <span className="num">{Math.round(timeline.topIdleMs / 1000)}s</span> for #1 over the same time
          </>
        ) : null}
        .
      </p>
      {longest.length > 0 && (
        <ul className="mt-1 text-sm">
          {longest.map((g) => {
            const phase = g.phase;
            return (
              <li key={g.startMs} className="num flex gap-3 border-b border-line/40 py-1">
                <span className="w-24 text-fg/85">
                  {fightTime(g.startMs)}–{fightTime(g.endMs)}
                </span>
                <span className="w-12 text-right text-dmg">{secs(g.endMs - g.startMs)}</span>
                {phase && <span className="truncate text-muted">{phase}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
