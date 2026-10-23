import type { Comparison, OpenerStep, TopTimeline } from "@log-review/analysis";
import { ByMode } from "./display-mode";
import type { AbilityInfo } from "./report";
import { CastStrip } from "./timeline";
import { Ability } from "./ui";
import type { PotionReview } from "@/lib/data";
import { abilityIconUrl, fightTime, fightTimePrecise, percent, wowheadSpellUrl } from "@/lib/format";

type Cast = [number, number];

const th = "pb-1 pr-3 font-medium";
const theadClass = "text-left text-[11px] uppercase tracking-[0.07em] text-faint";

/** Icon + name, compact, for cast lists. */
function Spell({ id, abilities, dim }: { id: number; abilities: AbilityInfo; dim?: boolean }) {
  const a = abilities[id];
  return (
    <a
      href={wowheadSpellUrl(id)}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex min-w-0 items-center gap-1.5 align-middle hover:underline ${dim ? "text-muted" : "text-fg"}`}
    >
      {a?.icon && <img src={abilityIconUrl(a.icon)} alt="" width={16} height={16} className="shrink-0 outline outline-1 outline-black/60" />}
      <span className="truncate">{a?.name ?? `Spell ${id}`}</span>
    </a>
  );
}

function Heading({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mb-2">
      <h3 className="font-medium text-fg">{children}</h3>
      {hint && <p className="text-xs text-faint">{hint}</p>}
    </div>
  );
}

/** A time axis under strips, every `stepMs`. */
function Axis({ spanMs, stepMs, precise }: { spanMs: number; stepMs: number; precise?: boolean }) {
  const ticks = Array.from({ length: Math.floor(spanMs / stepMs) + 1 }, (_, i) => i * stepMs);
  return (
    <div className="relative h-4 text-faint">
      {ticks.map((t) => (
        <span key={t} className="num absolute -translate-x-1/2 text-[11px]" style={{ left: `${(t / spanMs) * 100}%` }}>
          {precise ? `${t / 1000}s` : fightTime(t)}
        </span>
      ))}
    </div>
  );
}

// ─── Opener ──────────────────────────────────────────────────────────────────

/**
 * Your opener next to top players': as a step-by-step cast list, or as cast strips for you and the
 * top three.
 */
export function OpenerCompare({
  steps,
  you,
  tops,
  cooldownIds,
  abilities,
  windowMs,
}: {
  steps: OpenerStep[];
  you: Cast[];
  tops: TopTimeline[];
  cooldownIds: number[];
  abilities: AbilityInfo;
  windowMs: number;
}) {
  const cooldowns = new Set(cooldownIds);
  const opener = (casts: Cast[]) => casts.filter(([t]) => t <= windowMs);
  const mismatches = steps.filter((s) => s.match === false).length;
  return (
    <div>
      <Heading
        hint={
          <ByMode
            list={
              <>
                Cast by cast, lined up with what the {tops.length} top players cast at the same step (movement and defensives left out).
                {mismatches > 0 ? ` ${mismatches} ${mismatches === 1 ? "step differs" : "steps differ"} from what most of them do.` : " Your order matches theirs."}
              </>
            }
            timeline={<>The first {windowMs / 1000} seconds for you and the top three. Cooldowns are outlined; hover an icon for its time.</>}
          />
        }
      >
        Opener vs top players
      </Heading>
      <ByMode
        list={
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[620px] text-sm">
              <thead className={theadClass}>
                <tr className="border-b border-line">
                  <th className={`${th} w-8 text-right`}>#</th>
                  <th className={`${th} w-16 text-right`}>Time</th>
                  <th className={th}>You</th>
                  <th className={th}>Most top players</th>
                  <th className={`${th} w-16 text-right`}>#1</th>
                  <th className={`pb-1 font-medium`}>{tops[0]?.name ?? "#1"}</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((s) => (
                  <tr key={s.step} className={`border-b border-line/40 ${s.match === false ? "shadow-[inset_2px_0_0_var(--color-dmg)]" : ""}`}>
                    <td className="num py-1 pr-3 text-right text-faint">{s.step}</td>
                    <td className="num py-1 pr-3 text-right text-muted">{s.you ? fightTimePrecise(s.you[0]) : ""}</td>
                    <td className="max-w-48 py-1 pr-3">
                      {s.you ? (
                        <span className={cooldowns.has(s.you[1]) ? "font-semibold" : ""}>
                          <Spell id={s.you[1]} abilities={abilities} />
                        </span>
                      ) : (
                        <span className="text-faint">–</span>
                      )}
                    </td>
                    <td className="max-w-56 py-1 pr-3">
                      {s.common ? (
                        <span className="flex items-center gap-2">
                          <Spell id={s.common.abilityId} abilities={abilities} dim={s.match !== false} />
                          <span className="num shrink-0 text-xs text-faint">{percent(s.common.share)}</span>
                        </span>
                      ) : (
                        <span className="text-faint">–</span>
                      )}
                    </td>
                    <td className="num py-1 pr-3 text-right text-faint">{s.top1 ? fightTimePrecise(s.top1[0]) : ""}</td>
                    <td className="max-w-48 py-1">{s.top1 ? <Spell id={s.top1[1]} abilities={abilities} dim /> : <span className="text-faint">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        }
        timeline={
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <div className="grid min-w-[640px] grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 text-xs text-muted">
              <span className="font-semibold text-fg">You</span>
              <CastStrip casts={opener(you)} windowMs={windowMs} cooldowns={cooldowns} abilities={abilities} />
              {tops.slice(0, 3).map((t) => (
                <TopLabelStrip key={t.rank} top={t} casts={opener(t.casts)} windowMs={windowMs} cooldowns={cooldowns} abilities={abilities} />
              ))}
              <span />
              <Axis spanMs={windowMs} stepMs={5000} precise />
            </div>
          </div>
        }
      />
    </div>
  );
}

function TopLabelStrip({ top, casts, windowMs, cooldowns, abilities }: { top: TopTimeline; casts: Cast[]; windowMs: number; cooldowns: Set<number>; abilities: AbilityInfo }) {
  return (
    <>
      <span className="truncate" title={top.name}>
        <span className="num text-faint">#{top.rank}</span> {top.name}
      </span>
      <CastStrip casts={casts} windowMs={windowMs} cooldowns={cooldowns} abilities={abilities} />
    </>
  );
}

// ─── Cooldowns ───────────────────────────────────────────────────────────────

/** DPS cooldown use over the whole fight: a merged timestamped list, or one lane per cooldown. */
export function CooldownCompare({
  cooldownIds,
  you,
  durationMs,
  top,
  comparison,
  abilities,
}: {
  cooldownIds: number[];
  you: Cast[];
  durationMs: number;
  top: TopTimeline | null;
  comparison: Comparison | null;
  abilities: AbilityInfo;
}) {
  const ids = cooldownIds.slice(0, 10);
  if (!ids.length) return <p className="text-sm text-muted">No major DPS cooldowns found for this spec.</p>;
  const set = new Set(ids);
  const mine = you.filter(([, id]) => set.has(id)).sort((a, b) => a[0] - b[0]);
  const theirs = (top?.casts ?? []).filter(([, id]) => set.has(id)).sort((a, b) => a[0] - b[0]);
  const span = Math.max(durationMs, top?.durationMs ?? 0);
  const at = (ms: number) => `${(ms / span) * 100}%`;
  const expected = (id: number) => comparison?.abilities.find((a) => a.abilityId === id)?.expected ?? null;

  const summary = (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="mb-4 w-full min-w-[520px] max-w-2xl text-sm">
        <thead className={theadClass}>
          <tr className="border-b border-line">
            <th className={th}>Cooldown</th>
            <th className={`${th} text-right`}>You</th>
            <th className={`${th} text-right`} title="Uses that fit in your time alive at top players' pace">
              Fits
            </th>
            <th className="pb-1 text-right font-medium">#1</th>
          </tr>
        </thead>
        <tbody>
          {ids.map((id) => {
            const n = mine.filter(([, a]) => a === id).length;
            const fit = expected(id);
            return (
              <tr key={id} className="border-b border-line/40">
                <td className="py-1.5 pr-3">
                  <Ability id={id} name={abilities[id]?.name} icon={abilities[id]?.icon} />
                </td>
                <td className={`num py-1.5 pr-3 text-right ${fit && n < fit.casts ? "text-dmg" : "text-fg/85"}`}>{n}</td>
                <td className="num py-1.5 pr-3 text-right text-muted" title={fit ? `First at ${fightTime(fit.firstMs)}, then every ${Math.round(fit.everyMs / 1000)}s` : undefined}>
                  {fit ? fit.casts : "–"}
                </td>
                <td className="num py-1.5 text-right text-faint">{top ? theirs.filter(([, a]) => a === id).length : "–"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div>
      <Heading hint={<>Defensives aren't here: when to use them depends on the fight, not the rotation.{top && <> #1 is {top.name}.</>}</>}>DPS cooldowns over the fight</Heading>
      {summary}
      <ByMode
        list={<MergedLog you={mine} top={top ? theirs : null} topName={top?.name ?? null} abilities={abilities} />}
        timeline={
          <div className="space-y-3">
            {ids.map((id) => (
              <div key={id}>
                <div className="mb-1 text-sm">
                  <Ability id={id} name={abilities[id]?.name} icon={abilities[id]?.icon} />
                </div>
                <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <span>You</span>
                  <Lane casts={mine.filter(([, a]) => a === id)} durationMs={durationMs} at={at} tone="bg-fg" />
                  {top && (
                    <>
                      <span>#1</span>
                      <Lane casts={theirs.filter(([, a]) => a === id)} durationMs={top.durationMs} at={at} tone="bg-muted" />
                    </>
                  )}
                </div>
              </div>
            ))}
            <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-2">
              <span />
              <Axis spanMs={span} stepMs={60_000} />
            </div>
          </div>
        }
      />
    </div>
  );
}

function Lane({ casts, durationMs, at, tone }: { casts: Cast[]; durationMs: number; at: (ms: number) => string; tone: string }) {
  return (
    <div className="relative h-4 bg-line/60">
      <div className="absolute inset-y-0 bg-line" style={{ width: at(durationMs) }} />
      {casts.map(([t], i) => (
        <span key={i} title={fightTime(t)} className={`absolute top-1/2 h-3 w-1.5 -translate-x-1/2 -translate-y-1/2 ${tone}`} style={{ left: at(t) }} />
      ))}
    </div>
  );
}

/** Your casts and #1's in one chronological list: "0:01.2  You  Fireball". */
function MergedLog({ you, top, topName, abilities, maxHeight }: { you: Cast[]; top: Cast[] | null; topName: string | null; abilities: AbilityInfo; maxHeight?: boolean }) {
  const rows = [...you.map((c) => ({ c, who: "you" as const })), ...(top ?? []).map((c) => ({ c, who: "top" as const }))].sort((a, b) => a.c[0] - b.c[0]);
  if (!rows.length) return <p className="text-sm text-muted">No casts.</p>;
  return (
    <div className={`-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 ${maxHeight ? "max-h-[32rem] overflow-y-auto" : ""}`}>
      <table className="w-full min-w-[480px] text-sm">
        <thead className={`${theadClass} sticky top-0 bg-ink`}>
          <tr className="border-b border-line">
            <th className={`${th} w-20 text-right`}>Time</th>
            <th className={th}>You</th>
            {top && <th className="pb-1 font-medium">{topName ?? "#1"}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ c, who }, i) => (
            <tr key={i} className="border-b border-line/30">
              <td className="num py-0.5 pr-3 text-right text-muted">{fightTimePrecise(c[0])}</td>
              <td className="max-w-56 py-0.5 pr-3">{who === "you" && <Spell id={c[1]} abilities={abilities} />}</td>
              {top && <td className="max-w-56 py-0.5">{who === "top" && <Spell id={c[1]} abilities={abilities} dim />}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Potions ─────────────────────────────────────────────────────────────────

const medianTime = (s: { median: number } | null) => (s ? fightTime(s.median) : "–");

/** Which combat potion you drank and when, next to every top player's. */
export function PotionCompare({ potions, durationMs, abilities }: { potions: PotionReview; durationMs: number; abilities: AbilityInfo }) {
  const { yours, top, healing } = potions;
  const span = Math.max(durationMs, ...(top?.rows ?? []).map((r) => r.durationMs));
  const at = (ms: number) => `${(ms / span) * 100}%`;
  const verdict =
    top && top.usedTwo >= 0.5 && yours.length < 2
      ? { tone: "text-dmg", text: `You drank ${yours.length === 0 ? "no combat potion" : "one combat potion"}; ${percent(top.usedTwo)} of top players drink two.` }
      : top && top.usedAny >= 0.5 && yours.length === 0
        ? { tone: "text-dmg", text: `You drank no combat potion; ${percent(top.usedAny)} of top players drink one.` }
        : null;
  return (
    <div className="space-y-4">
      <div>
        <Heading hint="Counted from casts. A potion drunk before the pull isn't a cast in the fight, so a pre-pot doesn't show; top players' first potion is usually on the pull or with Bloodlust.">
          Combat potions
        </Heading>
        {verdict && <p className={`mb-2 text-sm ${verdict.tone}`}>{verdict.text}</p>}
        <dl className="grid max-w-2xl grid-cols-[minmax(0,1fr)_auto_auto] gap-x-6 gap-y-1 border-y border-line py-2 text-sm">
          <dt className="text-[11px] uppercase tracking-[0.07em] text-faint" />
          <dd className="text-[11px] uppercase tracking-[0.07em] text-faint">You</dd>
          <dd className="text-[11px] uppercase tracking-[0.07em] text-faint">Top players</dd>
          <dt className="text-muted">Potions drunk</dt>
          <dd className="num">{yours.length}</dd>
          <dd className="num text-muted">{top ? `${percent(top.usedTwo)} drink 2` : "–"}</dd>
          <dt className="text-muted">First potion</dt>
          <dd className="num">{yours[0] ? fightTime(yours[0][0]) : "–"}</dd>
          <dd className="num text-muted">{top ? medianTime(top.first) : "–"}</dd>
          <dt className="text-muted">Second potion</dt>
          <dd className="num">{yours[1] ? fightTime(yours[1][0]) : "–"}</dd>
          <dd className="num text-muted">{top ? medianTime(top.second) : "–"}</dd>
          <dt className="text-muted">Which</dt>
          <dd>{yours[0] ? <Spell id={yours[0][1]} abilities={abilities} /> : "–"}</dd>
          <dd className="text-muted">
            {top?.mostCommon ? (
              <span className="inline-flex items-center gap-2">
                <Spell id={top.mostCommon.abilityId} abilities={abilities} dim /> <span className="num text-xs text-faint">{percent(top.mostCommon.share)}</span>
              </span>
            ) : (
              "–"
            )}
          </dd>
          <dt className="text-muted">Healthstones and health potions</dt>
          <dd className="num">{healing.you}</dd>
          <dd className="num text-muted">{healing.topMedian ?? "–"}</dd>
        </dl>
      </div>

      {top && top.rows.length > 0 && (
        <ByMode
          list={
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[520px] max-w-2xl text-sm">
                <thead className={theadClass}>
                  <tr className="border-b border-line">
                    <th className={th}>Player</th>
                    <th className={`${th} w-20 text-right`}>1st</th>
                    <th className={`${th} w-20 text-right`}>2nd</th>
                    <th className="pb-1 font-medium">Potion</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-line/40 bg-panel">
                    <td className="py-1 pr-3 font-semibold">You</td>
                    <td className="num py-1 pr-3 text-right">{yours[0] ? fightTime(yours[0][0]) : "–"}</td>
                    <td className="num py-1 pr-3 text-right">{yours[1] ? fightTime(yours[1][0]) : "–"}</td>
                    <td className="py-1">{yours[0] ? <Spell id={yours[0][1]} abilities={abilities} /> : <span className="text-dmg">none</span>}</td>
                  </tr>
                  {top.rows.map((r) => (
                    <tr key={r.rank} className="border-b border-line/40">
                      <td className="py-1 pr-3 text-muted">
                        <span className="num text-faint">#{r.rank}</span> {r.name}
                      </td>
                      <td className="num py-1 pr-3 text-right text-muted">{r.uses[0] ? fightTime(r.uses[0][0]) : "–"}</td>
                      <td className="num py-1 pr-3 text-right text-muted">{r.uses[1] ? fightTime(r.uses[1][0]) : "–"}</td>
                      <td className="py-1">{r.uses[0] ? <Spell id={r.uses[0][1]} abilities={abilities} dim /> : <span className="text-faint">none</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          }
          timeline={
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <div className="grid min-w-[560px] grid-cols-[7rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 text-xs text-muted">
                <span className="font-semibold text-fg">You</span>
                <PotionLane uses={yours} durationMs={durationMs} at={at} abilities={abilities} mine />
                {top.rows.map((r) => (
                  <PotionLaneRow key={r.rank} row={r} at={at} abilities={abilities} />
                ))}
                <span />
                <Axis spanMs={span} stepMs={60_000} />
              </div>
            </div>
          }
        />
      )}
    </div>
  );
}

function PotionLaneRow({ row, at, abilities }: { row: { rank: number; name: string; durationMs: number; uses: Cast[] }; at: (ms: number) => string; abilities: AbilityInfo }) {
  return (
    <>
      <span className="truncate" title={row.name}>
        <span className="num text-faint">#{row.rank}</span> {row.name}
      </span>
      <PotionLane uses={row.uses} durationMs={row.durationMs} at={at} abilities={abilities} />
    </>
  );
}

function PotionLane({ uses, durationMs, at, abilities, mine }: { uses: Cast[]; durationMs: number; at: (ms: number) => string; abilities: AbilityInfo; mine?: boolean }) {
  return (
    <div className={`relative h-5 ${mine ? "bg-line/80" : "bg-line/40"}`}>
      <div className="absolute inset-y-0 bg-line/70" style={{ width: at(durationMs) }} />
      {uses.map(([t, id], i) => {
        const a = abilities[id];
        return (
          <span key={i} title={`${fightTime(t)} ${a?.name ?? ""}`} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: at(t) }}>
            {a?.icon ? (
              <img src={abilityIconUrl(a.icon)} alt={a.name} width={16} height={16} className="block outline outline-1 outline-black/60" />
            ) : (
              <span className="block h-4 w-1.5 bg-warn" />
            )}
          </span>
        );
      })}
    </div>
  );
}

// ─── Whole-fight cast log ────────────────────────────────────────────────────

/** Every cast of the fight: a timestamped log next to #1, or one lane per ability (like Warcraft Logs' timeline). */
export function CastLog({
  you,
  top,
  durationMs,
  cooldownIds,
  utilityIds,
  abilities,
}: {
  you: Cast[];
  top: TopTimeline | null;
  durationMs: number;
  cooldownIds: number[];
  utilityIds: number[];
  abilities: AbilityInfo;
}) {
  const sorted = [...you].sort((a, b) => a[0] - b[0]);
  const counts = new Map<number, number>();
  for (const [, id] of sorted) counts.set(id, (counts.get(id) ?? 0) + 1);
  const topCounts = new Map<number, number>();
  for (const [, id] of top?.casts ?? []) topCounts.set(id, (topCounts.get(id) ?? 0) + 1);
  const cooldowns = new Set(cooldownIds);
  const utility = new Set(utilityIds);
  // Lanes: cooldowns first, then by how often you cast it; anything #1 casts that you never did goes last.
  const ids = [...new Set([...counts.keys(), ...[...topCounts].filter(([, n]) => n >= 3).map(([id]) => id)])].sort(
    (a, b) => Number(cooldowns.has(b)) - Number(cooldowns.has(a)) || (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || (topCounts.get(b) ?? 0) - (topCounts.get(a) ?? 0),
  );
  const span = Math.max(durationMs, top?.durationMs ?? 0);
  const at = (ms: number) => `${(ms / span) * 100}%`;
  return (
    <div>
      <Heading
        hint={
          <ByMode
            list={<>Every cast you finished, next to {top ? top.name : "the #1 player"}&apos;s.</>}
            timeline={<>One lane per spell: your casts on top, {top ? `${top.name}'s` : "#1's"} faded below. Gaps in a lane you normally keep rolling are the places to look.</>}
          />
        }
      >
        Every cast
      </Heading>
      <ByMode
        list={<MergedLog you={sorted} top={top?.casts ?? null} topName={top?.name ?? null} abilities={abilities} maxHeight />}
        timeline={
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <div className="grid min-w-[720px] grid-cols-[11rem_3rem_minmax(0,1fr)] items-center gap-x-2 gap-y-px text-xs">
              <span className={theadClass}>Spell</span>
              <span className={`${theadClass} text-right`}>You/#1</span>
              <span />
              {ids.map((id) => (
                <CastLane
                  key={id}
                  id={id}
                  you={sorted.filter(([, a]) => a === id)}
                  top={(top?.casts ?? []).filter(([, a]) => a === id)}
                  youN={counts.get(id) ?? 0}
                  topN={top ? (topCounts.get(id) ?? 0) : null}
                  at={at}
                  cooldown={cooldowns.has(id)}
                  utility={utility.has(id)}
                  abilities={abilities}
                />
              ))}
              <span />
              <span />
              <Axis spanMs={span} stepMs={60_000} />
            </div>
          </div>
        }
      />
    </div>
  );
}

function CastLane({
  id,
  you,
  top,
  youN,
  topN,
  at,
  cooldown,
  utility,
  abilities,
}: {
  id: number;
  you: Cast[];
  top: Cast[];
  youN: number;
  topN: number | null;
  at: (ms: number) => string;
  cooldown: boolean;
  utility: boolean;
  abilities: AbilityInfo;
}) {
  return (
    <>
      <span className={`min-w-0 ${utility ? "opacity-60" : ""} ${cooldown ? "font-semibold" : ""}`}>
        <Spell id={id} abilities={abilities} />
      </span>
      <span className="num text-right text-muted">
        {youN}
        {topN != null && <span className="text-faint">/{topN}</span>}
      </span>
      <div className="relative h-5 border-b border-line/40">
        {you.map(([t], i) => (
          <span key={i} title={fightTimePrecise(t)} className={`absolute top-0.5 h-2 w-[3px] -translate-x-1/2 ${cooldown ? "bg-warn" : "bg-fg"}`} style={{ left: at(t) }} />
        ))}
        {top.map(([t], i) => (
          <span key={`t${i}`} title={`#1 ${fightTimePrecise(t)}`} className="absolute bottom-0.5 h-1.5 w-[2px] -translate-x-1/2 bg-muted/60" style={{ left: at(t) }} />
        ))}
      </div>
    </>
  );
}
