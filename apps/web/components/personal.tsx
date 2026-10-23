import type { ReactNode } from "react";
import type { Comparison, OpenerStep, PerfFinding, PhaseSpan, TopTimeline } from "@log-review/analysis";
import type { AbilityInfo } from "./report";
import { Ability, Meter, SpellIcon } from "./ui";
import type { CooldownLane, PotionReview } from "@/lib/data";
import { abilityIconUrl, fightTime, fightTimePrecise, percent, wowheadSpellUrl } from "@/lib/format";

type Cast = [number, number];

const th = "pb-1 pr-3 font-medium";
const theadClass = "text-left text-[11px] uppercase tracking-[0.08em] text-muted";
const panel = "border border-line bg-panel p-4 sm:p-5";

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
      {a?.icon && <img src={abilityIconUrl(a.icon)} alt="" width={18} height={18} className="shrink-0 border border-black" />}
      <span className="truncate">{a?.name ?? `Spell ${id}`}</span>
    </a>
  );
}

function PanelTitle({ letter, children, hint }: { letter?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3">
      <h3 className="text-xl font-extrabold tracking-tight text-fg">
        {letter && <span className="num mr-2 text-gold">{letter}</span>}
        {children}
      </h3>
      {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
    </div>
  );
}

/** A time axis under lanes, every `stepMs`. */
function Axis({ spanMs, stepMs, seconds }: { spanMs: number; stepMs: number; seconds?: boolean }) {
  const ticks = Array.from({ length: Math.floor(spanMs / stepMs) + 1 }, (_, i) => i * stepMs);
  return (
    <div className="relative h-4 text-muted">
      {ticks.map((t) => (
        <span key={t} className="num absolute -translate-x-1/2 text-[11px]" style={{ left: `${(t / spanMs) * 100}%` }}>
          {seconds ? `${t / 1000}s` : fightTime(t)}
        </span>
      ))}
    </div>
  );
}

// ─── Findings as short cards ─────────────────────────────────────────────────

export interface FindingSummary {
  title: string;
  body: string;
  /** Estimated DPS gain as a share of your DPS. */
  gainShare: number | null;
  abilityId: number | null;
}

/** A finding in a line or two, for the hero and the next-pulls cards. */
export function summarizeFinding(f: PerfFinding, abilities: AbilityInfo, amount: number | null): FindingSummary {
  const name = (id: number) => abilities[id]?.name ?? `Spell ${id}`;
  const share = (gain: number | null) => (gain != null && amount ? gain / amount : null);
  switch (f.kind) {
    case "low-active-time":
      return { title: "Cast more of the time", body: `Casting ${percent(f.player)} of your time alive; top players ${percent(f.median)}.`, gainShare: share(f.estDpsGain), abilityId: null };
    case "low-casts": {
      const a = f.ability;
      return {
        title: `More ${name(a.abilityId)}`,
        body: a.expected ? `${a.casts} casts, ${a.expected.casts} fit at top players' pace.` : `${a.playerCpm.toFixed(1)}/min vs top ${a.benchmark.median.toFixed(1)}/min.`,
        gainShare: share(a.estDpsGain),
        abilityId: a.abilityId,
      };
    }
    case "missing-ability":
      return { title: `Use ${name(f.ability.abilityId)}`, body: `${percent(f.ability.benchmark.usedBy)} of top players cast it; you never did.`, gainShare: share(f.ability.estDpsGain), abilityId: f.ability.abilityId };
    case "low-buff-uptime":
      return { title: `Keep ${name(f.buff.abilityId)} up`, body: `Uptime ${percent(f.buff.player)} vs top ${percent(f.buff.benchmark.median)}.`, gainShare: null, abilityId: f.buff.abilityId };
    case "late-cooldown":
      return {
        title: `${name(f.abilityId)} on the pull`,
        body: `You pressed it at ${(f.playerMs / 1000).toFixed(1)}s; top players at ${(f.topMs / 1000).toFixed(1)}s.`,
        gainShare: null,
        abilityId: f.abilityId,
      };
    case "idle-time":
      return { title: "Fewer gaps without casting", body: `${Math.round(f.playerMs / 1000)}s idle vs ${Math.round(f.topMs / 1000)}s for top players.`, gainShare: share(f.estDpsGain), abilityId: null };
    case "low-target-share":
      return { title: `More damage on ${f.target.target}`, body: `${percent(f.target.player)} of your damage vs top ${percent(f.target.benchmark.median)}.`, gainShare: null, abilityId: null };
  }
}

const gainText = (g: number | null) => (g != null ? `≈ +${(g * 100).toFixed(1)}% DPS` : "worth checking");

/** The gauge, the verdict and the meters. */
export function Hero({
  name,
  color,
  subtitle,
  facts,
  ratio,
  verdict,
  meters,
}: {
  name: string;
  color: string;
  subtitle: string;
  facts: ReactNode;
  ratio: number | null;
  verdict: ReactNode;
  meters: { label: string; value: string; share: number; color: string }[];
}) {
  // A 270° arc: the dash shows the ratio (capped at 100%).
  const arc = 226;
  const lit = ratio != null ? Math.min(1, ratio) * arc : 0;
  return (
    <section className={`${panel} flex flex-wrap items-center gap-7`}>
      <svg width="150" height="150" viewBox="0 0 120 120" role="img" aria-label={ratio != null ? `DPS at ${percent(ratio)} of top players` : "No DPS comparison"} className="shrink-0">
        <circle cx="60" cy="60" r="48" fill="none" stroke="var(--color-line)" strokeWidth="12" strokeDasharray={`${arc} 302`} transform="rotate(135 60 60)" />
        <circle
          cx="60"
          cy="60"
          r="48"
          fill="none"
          stroke={ratio == null ? "var(--color-line)" : ratio < 0.85 ? "var(--color-dmg)" : ratio >= 1 ? "var(--color-heal)" : "var(--color-gold)"}
          strokeWidth="12"
          strokeDasharray={`${lit} 302`}
          transform="rotate(135 60 60)"
        />
        <text x="60" y="62" textAnchor="middle" className="fill-fg" style={{ font: "800 26px var(--font-sans)" }}>
          {ratio != null ? percent(ratio) : "–"}
        </text>
        <text x="60" y="80" textAnchor="middle" className="fill-muted" style={{ font: "9px var(--font-mono)" }}>
          OF TOP DPS
        </text>
      </svg>
      <div className="min-w-0 flex-[1_1_380px]">
        <div className="num text-[13px] uppercase text-muted">{facts}</div>
        <h1 className="mt-1 text-4xl font-extrabold tracking-tight" style={{ color }}>
          {name} <span className="text-xl font-medium tracking-normal text-muted">{subtitle}</span>
        </h1>
        <p className="mt-2 max-w-2xl text-lg text-fg">{verdict}</p>
      </div>
      {meters.length > 0 && (
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-3">
          {meters.map((m) => (
            <Meter key={m.label} {...m} />
          ))}
        </div>
      )}
    </section>
  );
}

/** The three things worth the most, as cards. */
export function NextPulls({ items, abilities }: { items: FindingSummary[]; abilities: AbilityInfo }) {
  if (!items.length) return null;
  return (
    <section>
      <h2 className="hud-title mb-2.5">Your next {items.length === 1 ? "pull" : `${items.length} pulls`}</h2>
      <ol className="grid gap-3 sm:grid-cols-3">
        {items.map((f, i) => (
          <li key={i} className="flex gap-3 border border-line bg-panel p-4">
            {f.abilityId != null ? (
              <SpellIcon id={f.abilityId} name={abilities[f.abilityId]?.name} icon={abilities[f.abilityId]?.icon} size={40} gold />
            ) : (
              <span className="num flex h-10 w-10 shrink-0 items-center justify-center border-2 border-gold text-sm font-bold text-gold">··</span>
            )}
            <div className="min-w-0">
              <div className="num text-xs text-muted">0{i + 1}</div>
              <div className="text-[17px] font-bold">{f.title}</div>
              <div className="text-sm text-muted">{f.body}</div>
              <div className="num mt-1.5 text-[13px] font-bold text-gold">{gainText(f.gainShare)}</div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ─── Timeline styles ─────────────────────────────────────────────────────────

/** Cast list: every cast of the pull, yours next to #1's. */
export function CastListView({ you, top, abilities }: { you: Cast[]; top: TopTimeline | null; abilities: AbilityInfo }) {
  const rows = [...you.map((c) => ({ c, who: "you" as const })), ...(top?.casts ?? []).map((c) => ({ c, who: "top" as const }))].sort((a, b) => a.c[0] - b.c[0]);
  return (
    <section className={panel}>
      <PanelTitle hint={top ? `Every cast you finished, next to ${top.name}'s (#1).` : "Every cast you finished."}>Cast list</PanelTitle>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No casts.</p>
      ) : (
        <div className="-mx-4 max-h-[36rem] overflow-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[480px] text-sm">
            <thead className={`${theadClass} sticky top-0 bg-panel`}>
              <tr className="border-b border-line">
                <th className={`${th} w-24 text-right`}>Time</th>
                <th className={th}>You</th>
                {top && <th className="pb-1 font-medium">{top.name}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, who }, i) => (
                <tr key={i} className="border-b border-line/40">
                  <td className="num py-0.5 pr-3 text-right text-muted">{fightTimePrecise(c[0])}</td>
                  <td className="max-w-56 py-0.5 pr-3">{who === "you" && <Spell id={c[1]} abilities={abilities} />}</td>
                  {top && <td className="max-w-56 py-0.5">{who === "top" && <Spell id={c[1]} abilities={abilities} dim />}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const ICON_WINDOW_MS = 15_000;

/** A: the opener as icon lanes, you against the top three, with bands while cooldowns run. */
export function IconLanesView({
  you,
  tops,
  cooldownIds,
  activeMs,
  abilities,
}: {
  you: Cast[];
  tops: TopTimeline[];
  cooldownIds: number[];
  /** How long each cooldown's effect lasts, for its band. */
  activeMs: Record<number, number>;
  abilities: AbilityInfo;
}) {
  const cooldowns = new Set(cooldownIds);
  const at = (ms: number) => `${(ms / ICON_WINDOW_MS) * 100}%`;
  const row = (label: ReactNode, color: string, casts: Cast[], key: string) => {
    const inWindow = casts.filter(([t]) => t <= ICON_WINDOW_MS).sort((a, b) => a[0] - b[0]);
    const bands = inWindow.filter(([, id]) => cooldowns.has(id) && activeMs[id]);
    return [
      <span key={`${key}-l`} className="truncate font-bold" style={{ color }}>
        {label}
      </span>,
      <div key={`${key}-r`} className="relative h-10 border border-[#1f2940] bg-raised">
        {bands.map(([t, id], i) => (
          <div
            key={i}
            className="absolute inset-y-0 border-l-2 border-gold bg-gold/20"
            style={{ left: at(t), width: `calc(${at(Math.min(activeMs[id]!, ICON_WINDOW_MS - t))})` }}
          />
        ))}
        {inWindow.map(([t, id], i) => (
          <span key={i} className="absolute top-1.5 -translate-x-1/2" style={{ left: at(t) }}>
            <SpellIcon id={id} name={abilities[id]?.name} icon={abilities[id]?.icon} size={28} gold={cooldowns.has(id)} title={`${(t / 1000).toFixed(1)}s ${abilities[id]?.name ?? ""}`} />
          </span>
        ))}
      </div>,
    ];
  };
  return (
    <section className={panel}>
      <PanelTitle letter="A" hint="Every cast as its spell icon, you against the top three. The gold band is a cooldown running; gold frames are cooldowns.">
        Icon lanes · opener, first {ICON_WINDOW_MS / 1000}s
      </PanelTitle>
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="grid min-w-[780px] grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
          {row("You", "var(--color-you)", you, "you")}
          {tops.slice(0, 3).map((t) => row(`#${t.rank} ${t.name}`, "var(--color-fg)", t.casts, `t${t.rank}`))}
          <span />
          <Axis spanMs={ICON_WINDOW_MS} stepMs={3000} seconds />
        </div>
      </div>
      {tops.length === 0 && <p className="mt-2 text-sm text-muted">No top-player timelines for this spec and boss yet.</p>}
    </section>
  );
}

/** B: the opener step by step, your cast on the left and what most top players cast on the right. */
export function SideBySideView({ steps, abilities, players }: { steps: OpenerStep[]; abilities: AbilityInfo; players: number }) {
  return (
    <section className={panel}>
      <PanelTitle letter="B" hint={`Time runs down. Your cast on the left, the most common cast of the top ${players} at the same step on the right. Coral = most top players did something else.`}>
        Side by side · opener, step by step
      </PanelTitle>
      {steps.length === 0 ? (
        <p className="text-sm text-muted">No top-player timelines for this spec and boss yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_6rem_minmax(0,1fr)] text-[13px] font-bold uppercase tracking-[0.08em]">
            <span className="text-right text-you">You</span>
            <span />
            <span className="text-muted">Top {players}</span>
          </div>
          <ol className="relative mt-1.5">
            <span aria-hidden className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-px bg-line" />
            {steps.map((s) => {
              const bad = s.match === false;
              return (
                <li key={s.step} className="relative grid min-h-[42px] grid-cols-[minmax(0,1fr)_6rem_minmax(0,1fr)] items-center">
                  <div className="flex items-center justify-end gap-2">
                    {s.you && (
                      <>
                        <span className={`truncate px-2.5 py-1 text-sm font-bold ${bad ? "bg-dmg text-ink" : "bg-raised text-fg"}`}>{abilities[s.you[1]]?.name ?? `Spell ${s.you[1]}`}</span>
                        <SpellIcon id={s.you[1]} name={abilities[s.you[1]]?.name} icon={abilities[s.you[1]]?.icon} size={22} />
                      </>
                    )}
                  </div>
                  <div className="flex justify-center">
                    <span className={`num relative border bg-ink px-2 text-xs ${bad ? "border-dmg" : "border-line"}`}>{s.you ? fightTimePrecise(s.you[0]) : `#${s.step}`}</span>
                  </div>
                  <div className="flex min-w-0 items-center gap-2">
                    {s.common && (
                      <>
                        <SpellIcon id={s.common.abilityId} name={abilities[s.common.abilityId]?.name} icon={abilities[s.common.abilityId]?.icon} size={22} />
                        <span className="truncate border border-line bg-raised px-2.5 py-1 text-sm font-bold">{abilities[s.common.abilityId]?.name ?? `Spell ${s.common.abilityId}`}</span>
                        <span className="num text-xs text-muted">{percent(s.common.share)}</span>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}

/** C: each DPS cooldown over the pull as running / ready-but-unused stretches, with #1 underneath. */
export function AvailabilityView({ lanes, spanMs, abilities, topName }: { lanes: CooldownLane[]; spanMs: number; abilities: AbilityInfo; topName: string | null }) {
  const at = (ms: number) => `${(ms / spanMs) * 100}%`;
  const width = ([a, b]: [number, number]) => `max(3px, ${((b - a) / spanMs) * 100}%)`;
  return (
    <section className={panel}>
      <PanelTitle
        letter="C"
        hint={
          <>
            Gold = the cooldown is running. Hatched coral = it was ready (going by top players&apos; pace) and you didn&apos;t press it.
            {topName && <> The thin line under each row is {topName} (#1).</>}
          </>
        }
      >
        Availability · cooldowns over the whole pull
      </PanelTitle>
      {lanes.length === 0 ? (
        <p className="text-sm text-muted">No DPS cooldowns with top-player timings for this spec yet.</p>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div className="grid min-w-[860px] grid-cols-[12rem_minmax(0,1fr)_5rem] items-center gap-x-4 gap-y-3.5">
            {lanes.map((l) => (
              <Lane key={l.abilityId} lane={l} at={at} width={width} abilities={abilities} />
            ))}
            <span />
            <Axis spanMs={spanMs} stepMs={60_000} />
            <span />
          </div>
        </div>
      )}
    </section>
  );
}

function Lane({ lane, at, width, abilities }: { lane: CooldownLane; at: (ms: number) => string; width: (r: [number, number]) => string; abilities: AbilityInfo }) {
  const short = lane.fits != null && lane.casts < lane.fits;
  return (
    <>
      <span className="flex min-w-0 items-center gap-2 font-bold">
        <SpellIcon id={lane.abilityId} name={abilities[lane.abilityId]?.name} icon={abilities[lane.abilityId]?.icon} size={22} gold />
        <span className="truncate">{abilities[lane.abilityId]?.name ?? `Spell ${lane.abilityId}`}</span>
      </span>
      <div className="relative h-[30px] border border-[#1f2940] bg-raised">
        {lane.idle.map((r, i) => (
          <div
            key={`i${i}`}
            title={`ready ${fightTime(r[0])}–${fightTime(r[1])}`}
            className="absolute top-[3px] h-4 border border-dmg"
            style={{ left: at(r[0]), width: width(r), background: "repeating-linear-gradient(45deg, var(--color-dmg) 0 2px, transparent 2px 6px)" }}
          />
        ))}
        {lane.used.map((r, i) => (
          <div key={`u${i}`} title={`pressed ${fightTime(r[0])}`} className="absolute top-[3px] h-4 bg-gold" style={{ left: at(r[0]), width: width(r) }} />
        ))}
        {lane.topUsed.map((r, i) => (
          <div key={`t${i}`} className="absolute top-[23px] h-[3px] bg-muted" style={{ left: at(r[0]), width: width(r) }} />
        ))}
      </div>
      <span className={`num text-right ${short ? "text-dmg" : "text-fg"}`} title="Your uses / uses that fit at top players' pace">
        {lane.casts}
        {lane.fits != null && ` / ${lane.fits}`}
      </span>
    </>
  );
}

export interface TrackPin {
  ms: number;
  label: string;
  tone: "bad" | "cooldown" | "good";
}

const PIN_COLOR: Record<TrackPin["tone"], string> = { bad: "var(--color-dmg)", cooldown: "var(--color-gold)", good: "var(--color-you)" };

/** D: the boss's phases as a band with only the moments that matter pinned to it. */
export function EventTrackView({ phases, pins, spanMs }: { phases: PhaseSpan[]; pins: TrackPin[]; spanMs: number }) {
  const at = (ms: number) => `${(ms / spanMs) * 100}%`;
  // Alternate pins above and below the band, with a second row when they'd touch on the same side.
  const placed: (TrackPin & { side: "above" | "below"; row: number })[] = [];
  const lastAt = { above: [-1e9, -1e9], below: [-1e9, -1e9] };
  [...pins]
    .sort((a, b) => a.ms - b.ms)
    .forEach((p, i) => {
      const side = i % 2 === 0 ? "above" : "below";
      const gap = spanMs * 0.1;
      const row = p.ms - lastAt[side][0]! >= gap ? 0 : p.ms - lastAt[side][1]! >= gap ? 1 : 0;
      lastAt[side][row] = p.ms;
      placed.push({ ...p, side, row });
    });
  const bands = phases.length ? phases : [{ id: 0, name: "Pull", intermission: false, startMs: 0, endMs: spanMs }];
  return (
    <section className={panel}>
      <PanelTitle letter="D" hint="Boss phases as a band, with only the moments that matter pinned to it.">
        Event track · the whole pull at a glance
      </PanelTitle>
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="relative h-[200px] min-w-[860px]">
          {placed.map((p, i) => {
            const above = p.side === "above";
            const labelTop = above ? (p.row === 0 ? 0 : 38) : p.row === 0 ? 128 : 164;
            return (
              <div key={i}>
                <div
                  className="absolute w-0.5"
                  style={{ left: at(p.ms), background: PIN_COLOR[p.tone], top: above ? labelTop + 36 : 116, height: above ? 94 - (labelTop + 36) : labelTop - 116 }}
                />
                <div className="absolute -translate-x-1/2 whitespace-nowrap text-center text-[13px] text-fg" style={{ left: at(p.ms), top: labelTop }}>
                  <span className="num block text-xs" style={{ color: PIN_COLOR[p.tone] }}>
                    {fightTime(p.ms)}
                  </span>
                  {p.label}
                </div>
              </div>
            );
          })}
          <div className="absolute inset-x-0 top-[94px] flex h-[22px]">
            {bands.map((b, i) => (
              <div
                key={i}
                title={`${b.name} ${fightTime(b.startMs)}–${fightTime(b.endMs)}`}
                className={`num overflow-hidden border-r-2 border-ink px-1.5 py-0.5 text-[11px] font-bold whitespace-nowrap ${b.intermission ? "bg-[#3a4766]" : "bg-line"}`}
                style={{ width: at(b.endMs - b.startMs) }}
              >
                {b.name}
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-1.5 text-[13px] text-muted">
        <span className="text-dmg">●</span> mistake &nbsp; <span className="text-gold">●</span> cooldown or potion &nbsp; <span className="text-you">●</span> on time
      </p>
    </section>
  );
}

// ─── Potions ─────────────────────────────────────────────────────────────────

/** Your combat potions next to every top player's, as icon lanes. */
export function PotionLanes({ potions, durationMs, abilities }: { potions: PotionReview; durationMs: number; abilities: AbilityInfo }) {
  const { yours, top, healing } = potions;
  const span = Math.max(durationMs, ...(top?.rows ?? []).map((r) => r.durationMs));
  const at = (ms: number) => `${(ms / span) * 100}%`;
  const missingSecond = top && top.usedTwo >= 0.5 && yours.length < 2 && top.second ? top.second.median : null;
  const missingFirst = top && top.usedAny >= 0.5 && yours.length === 0 && top.first ? top.first.median : null;
  const icon = (id: number, size = 18) => <SpellIcon id={id} name={abilities[id]?.name} icon={abilities[id]?.icon} size={size} />;
  const lane = (uses: Cast[], missing: (number | null)[], duration: number) => (
    <div className="relative h-[22px] bg-raised">
      <div className="absolute inset-y-0 bg-line/50" style={{ width: at(duration) }} />
      {uses.map(([t, id], i) => (
        <span key={i} className="absolute top-0.5 -translate-x-1/2" style={{ left: at(t) }} title={`${fightTime(t)} ${abilities[id]?.name ?? ""}`}>
          {icon(id)}
        </span>
      ))}
      {missing.map((t, i) =>
        t == null ? null : <span key={`m${i}`} title={`missing: top players drink one around ${fightTime(t)}`} className="absolute top-0.5 h-[18px] w-[18px] -translate-x-1/2 border-2 border-dashed border-dmg" style={{ left: at(t) }} />,
      )}
    </div>
  );
  const summary = !top
    ? "No top-player timelines for this spec and boss yet."
    : `${Math.round(top.usedTwo * top.players)} of ${top.players} top players drink two${top.first ? `, the first around ${fightTime(top.first.median)}` : ""}${top.second ? ` and the second around ${fightTime(top.second.median)}` : ""}. You drank ${yours.length === 0 ? "none" : yours.length === 1 ? "one" : yours.length}.`;
  return (
    <section className={panel}>
      <PanelTitle hint={summary}>Potions · you and the top {top?.players ?? 15}</PanelTitle>
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="grid min-w-[760px] grid-cols-[9rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
          <span className="text-sm font-extrabold text-you">You</span>
          {lane(yours, [missingFirst, missingSecond], durationMs)}
          {(top?.rows ?? []).map((r) => [
            <span key={`n${r.rank}`} className="truncate text-sm text-muted" title={r.name}>
              <span className="num">#{r.rank}</span> {r.name}
            </span>,
            <div key={`l${r.rank}`}>{lane(r.uses, [], r.durationMs)}</div>,
          ])}
          <span />
          <Axis spanMs={span} stepMs={60_000} />
        </div>
      </div>
      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-1 text-sm">
        <div>
          <dt className="inline text-muted">Most common potion: </dt>
          <dd className="inline">{top?.mostCommon ? <Spell id={top.mostCommon.abilityId} abilities={abilities} /> : "–"}</dd>
        </div>
        <div>
          <dt className="inline text-muted">Healthstones and health potions: </dt>
          <dd className="num inline">
            {healing.you} <span className="text-muted">(top median {healing.topMedian ?? "–"})</span>
          </dd>
        </div>
      </dl>
      <p className="mt-1 text-xs text-muted">Counted from casts. A potion drunk before the pull isn&apos;t a cast in the fight, so a pre-pot doesn&apos;t show.</p>
    </section>
  );
}

// ─── Details tabs ────────────────────────────────────────────────────────────

/** The opener step by step as a table: you, the top players' most common cast and #1's. */
export function OpenerTable({ steps, abilities, topName, cooldownIds }: { steps: OpenerStep[]; abilities: AbilityInfo; topName: string | null; cooldownIds: number[] }) {
  if (!steps.length) return <p className="text-sm text-muted">No top-player timelines for this spec and boss yet.</p>;
  const cooldowns = new Set(cooldownIds);
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[620px] text-sm">
        <thead className={theadClass}>
          <tr className="border-b border-line">
            <th className={`${th} w-8 text-right`}>#</th>
            <th className={`${th} w-20 text-right`}>Time</th>
            <th className={th}>You</th>
            <th className={th}>Most top players</th>
            <th className={`${th} w-20 text-right`}>#1</th>
            <th className="pb-1 font-medium">{topName ?? "#1"}</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((s) => (
            <tr key={s.step} className={`border-b border-line/40 ${s.match === false ? "shadow-[inset_2px_0_0_var(--color-dmg)]" : ""}`}>
              <td className="num py-1 pr-3 text-right text-muted">{s.step}</td>
              <td className="num py-1 pr-3 text-right text-muted">{s.you ? fightTimePrecise(s.you[0]) : ""}</td>
              <td className={`max-w-48 py-1 pr-3 ${s.you && cooldowns.has(s.you[1]) ? "font-bold" : ""}`}>{s.you ? <Spell id={s.you[1]} abilities={abilities} /> : "–"}</td>
              <td className="max-w-56 py-1 pr-3">
                {s.common ? (
                  <span className="flex items-center gap-2">
                    <Spell id={s.common.abilityId} abilities={abilities} dim={s.match !== false} />
                    <span className="num shrink-0 text-xs text-muted">{percent(s.common.share)}</span>
                  </span>
                ) : (
                  "–"
                )}
              </td>
              <td className="num py-1 pr-3 text-right text-muted">{s.top1 ? fightTimePrecise(s.top1[0]) : ""}</td>
              <td className="max-w-48 py-1">{s.top1 ? <Spell id={s.top1[1]} abilities={abilities} dim /> : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Each DPS cooldown's uses vs what fits at top players' pace vs #1. */
export function CooldownTable({ cooldownIds, you, top, comparison, abilities }: { cooldownIds: number[]; you: Cast[]; top: TopTimeline | null; comparison: Comparison | null; abilities: AbilityInfo }) {
  const ids = cooldownIds.slice(0, 10);
  if (!ids.length) return <p className="text-sm text-muted">No major DPS cooldowns found for this spec.</p>;
  const expected = (id: number) => comparison?.abilities.find((a) => a.abilityId === id)?.expected ?? null;
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[560px] max-w-3xl text-sm">
        <thead className={theadClass}>
          <tr className="border-b border-line">
            <th className={th}>Cooldown</th>
            <th className={`${th} text-right`}>You</th>
            <th className={`${th} text-right`} title="Uses that fit in your time alive at top players' pace">
              Fits
            </th>
            <th className={`${th} text-right`}>#1</th>
            <th className="pb-1 font-medium">Your uses</th>
          </tr>
        </thead>
        <tbody>
          {ids.map((id) => {
            const mine = you.filter(([, a]) => a === id).sort((a, b) => a[0] - b[0]);
            const fit = expected(id);
            return (
              <tr key={id} className="border-b border-line/40">
                <td className="py-1.5 pr-3">
                  <Ability id={id} name={abilities[id]?.name} icon={abilities[id]?.icon} />
                </td>
                <td className={`num py-1.5 pr-3 text-right ${fit && mine.length < fit.casts ? "text-dmg" : "text-fg"}`}>{mine.length}</td>
                <td className="num py-1.5 pr-3 text-right text-muted" title={fit ? `First at ${fightTime(fit.firstMs)}, then every ${Math.round(fit.everyMs / 1000)}s` : undefined}>
                  {fit ? fit.casts : "–"}
                </td>
                <td className="num py-1.5 pr-3 text-right text-muted">{top ? top.casts.filter(([, a]) => a === id).length : "–"}</td>
                <td className="num py-1.5 text-xs text-muted">{mine.map(([t]) => fightTime(t)).join("  ")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Every spell of the pull as a lane, like Warcraft Logs' timeline: yours on top, #1's faded below. */
export function SpellLanes({
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
  const counts = new Map<number, number>();
  for (const [, id] of you) counts.set(id, (counts.get(id) ?? 0) + 1);
  const topCounts = new Map<number, number>();
  for (const [, id] of top?.casts ?? []) topCounts.set(id, (topCounts.get(id) ?? 0) + 1);
  const cooldowns = new Set(cooldownIds);
  const utility = new Set(utilityIds);
  // Cooldowns first, then by how often you cast it; anything #1 casts that you never did goes last.
  const ids = [...new Set([...counts.keys(), ...[...topCounts].filter(([, n]) => n >= 3).map(([id]) => id)])].sort(
    (a, b) => Number(cooldowns.has(b)) - Number(cooldowns.has(a)) || (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || (topCounts.get(b) ?? 0) - (topCounts.get(a) ?? 0),
  );
  const span = Math.max(durationMs, top?.durationMs ?? 0);
  const at = (ms: number) => `${(ms / span) * 100}%`;
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="grid min-w-[760px] grid-cols-[12rem_3.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-px text-xs">
        <span className={theadClass}>Spell</span>
        <span className={`${theadClass} text-right`}>You/#1</span>
        <span />
        {ids.map((id) => (
          <SpellLane
            key={id}
            id={id}
            you={you.filter(([, a]) => a === id)}
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
  );
}

function SpellLane({
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
      <span className={`min-w-0 ${utility ? "opacity-60" : ""} ${cooldown ? "font-bold" : ""}`}>
        <Spell id={id} abilities={abilities} />
      </span>
      <span className="num text-right text-muted">
        {youN}
        {topN != null && <span className="text-faint">/{topN}</span>}
      </span>
      <div className="relative h-5 border-b border-line/40">
        {you.map(([t], i) => (
          <span key={i} title={fightTimePrecise(t)} className={`absolute top-0.5 h-2 w-[3px] -translate-x-1/2 ${cooldown ? "bg-gold" : "bg-fg"}`} style={{ left: at(t) }} />
        ))}
        {top.map(([t], i) => (
          <span key={`t${i}`} title={`#1 ${fightTimePrecise(t)}`} className="absolute bottom-0.5 h-1.5 w-[2px] -translate-x-1/2 bg-muted/60" style={{ left: at(t) }} />
        ))}
      </div>
    </>
  );
}
