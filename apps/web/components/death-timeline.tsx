"use client";

import { type ReactNode, useEffect, useState } from "react";
import type { ClassifiedDeath, WipeEvent } from "@log-review/analysis";
import { classColor, fightTime } from "@/lib/format";

export interface TimelineProps {
  deaths: ClassifiedDeath[];
  wipe: WipeEvent | null;
  durationMs: number;
  playerId: number;
  names: Record<number, string>;
  classes: Record<number, string>;
  /** Killing ability names by ID. */
  abilityNames: Record<number, string>;
}

const toggleClass = "border border-line px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted hover:border-muted hover:text-fg";

/**
 * Raid deaths over the pull. Minimal by default: one strip with your deaths labeled. The button under it
 * expands to everyone: one row per player who died, plus `children` (the full raid deaths table).
 */
export function DeathTimeline({ children, ...props }: TimelineProps & { children?: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [zoomWipe, setZoomWipe] = useState(false);
  const { wipe, durationMs, deaths, playerId } = props;
  const others = deaths.filter((d) => d.targetID !== playerId).length;

  // Links to the full list ("Who died first") open it.
  useEffect(() => {
    const open = () => {
      if (window.location.hash === "#raid-deaths") setExpanded(true);
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);

  // Zooming shows the seconds around the wipe, where deaths pile up.
  const range =
    zoomWipe && wipe
      ? { start: Math.max(0, wipe.startMs - 10_000), end: Math.min(durationMs, wipe.endMs + 3_000) }
      : { start: 0, end: durationMs };

  return (
    <div id="raid-deaths" className="scroll-mt-6">
      {expanded ? <Lanes {...props} range={range} /> : <Strip {...props} />}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setExpanded(!expanded)} className={toggleClass} aria-expanded={expanded}>
          {expanded ? "Hide other players" : `Show everyone who died (${others} other ${others === 1 ? "death" : "deaths"})`}
        </button>
        {expanded && wipe && (
          <button type="button" onClick={() => setZoomWipe(!zoomWipe)} className={toggleClass} aria-pressed={zoomWipe}>
            {zoomWipe ? "Whole pull" : "Zoom to wipe"}
          </button>
        )}
      </div>
      {expanded && children && <div className="mt-4">{children}</div>}
    </div>
  );
}

/** Time ticks for a range: every minute, or every 2 seconds when zoomed in. */
function ticks(range: { start: number; end: number }) {
  const span = range.end - range.start;
  const step = span <= 60_000 ? 2_000 : 60_000;
  const out: number[] = [];
  for (let t = Math.ceil(range.start / step) * step; t < range.end; t += step) if (t > range.start) out.push(t);
  // Skip a tick that would crowd the end label.
  return out.filter((t) => range.end - t > span * 0.06);
}

function Strip({ deaths, wipe, durationMs, playerId, names }: TimelineProps) {
  const at = (ms: number) => `${Math.min(100, Math.max(0, (ms / durationMs) * 100))}%`;
  const mine = deaths.filter((d) => d.targetID === playerId);
  const labelShift = (ms: number) => (ms / durationMs > 0.9 ? "-translate-x-full" : ms / durationMs < 0.1 ? "" : "-translate-x-1/2");
  const marks = ticks({ start: 0, end: durationMs });
  return (
    <div>
      <div className="relative h-4 text-[11px] font-medium text-fg">
        {mine.map((d) => (
          <span key={d.order} className={`num absolute whitespace-nowrap ${labelShift(d.fightTimeMs)}`} style={{ left: at(d.fightTimeMs) }}>
            you {fightTime(d.fightTimeMs)}
          </span>
        ))}
      </div>
      <div className="relative h-9 border border-line bg-raised" role="img" aria-label="Deaths during the pull">
        {marks.map((m) => (
          <span key={m} className="absolute inset-y-0 w-px bg-line" style={{ left: at(m) }} />
        ))}
        {wipe && (
          <div
            className="absolute inset-y-0 bg-dmg/20"
            style={{ left: at(wipe.startMs), width: `max(4px, calc(${at(wipe.endMs)} - ${at(wipe.startMs)}))` }}
            title={`Wipe: ${wipe.deaths} deaths, ${fightTime(wipe.startMs)}–${fightTime(wipe.endMs)}`}
          />
        )}
        {deaths.map((d) => {
          const isMe = d.targetID === playerId;
          return (
            <span
              key={d.order}
              title={`${fightTime(d.fightTimeMs)} ${names[d.targetID!] ?? "Unknown"}`}
              className={`absolute -translate-x-1/2 ${isMe ? "inset-y-0 z-10 w-[3px] bg-fg" : "top-[30%] h-[40%] w-[2px] bg-muted"}`}
              style={{ left: at(d.fightTimeMs) }}
            />
          );
        })}
      </div>
      <Axis range={{ start: 0, end: durationMs }} />
      <div className="mt-1 flex flex-wrap gap-4 text-[11px] text-faint">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-[3px] bg-fg" /> you
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-[2px] bg-muted" /> other deaths
        </span>
        {wipe && (
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-3 bg-dmg/30" /> wipe
          </span>
        )}
      </div>
    </div>
  );
}

function Axis({ range, indent = false }: { range: { start: number; end: number }; indent?: boolean }) {
  const at = (ms: number) => `${((ms - range.start) / (range.end - range.start)) * 100}%`;
  return (
    <div className={`num relative mt-1 h-4 text-[10px] text-faint ${indent ? "ml-[9.5rem]" : ""}`}>
      <span className="absolute left-0">{fightTime(range.start)}</span>
      {ticks(range).map((m) => (
        <span key={m} className="absolute -translate-x-1/2" style={{ left: at(m) }}>
          {fightTime(m)}
        </span>
      ))}
      <span className="absolute right-0 bg-ink pl-1">{fightTime(range.end)}</span>
    </div>
  );
}

/** One row per player who died, ordered by first death, with each death labeled. */
function Lanes({ deaths, wipe, playerId, names, classes, abilityNames, range }: TimelineProps & { range: { start: number; end: number } }) {
  const span = range.end - range.start;
  const pos = (ms: number) => ((ms - range.start) / span) * 100;
  const inRange = deaths.filter((d) => d.fightTimeMs >= range.start && d.fightTimeMs <= range.end);
  const players = [...new Set(inRange.map((d) => d.targetID!))];
  const marks = ticks(range);

  if (!players.length) return <p className="py-2 text-sm text-muted">No deaths in this range.</p>;

  return (
    <div>
      <div className="border border-line">
        {players.map((id) => {
          const isMe = id === playerId;
          const own = inRange.filter((d) => d.targetID === id);
          return (
            <div key={id} className={`grid grid-cols-[9.5rem_minmax(0,1fr)] border-b border-line/50 last:border-b-0 ${isMe ? "bg-raised" : ""}`}>
              <div className="truncate px-2 py-1.5 text-sm" style={{ color: classColor(classes[id] ?? "") }}>
                <span className={isMe ? "font-semibold" : ""}>{names[id] ?? "Unknown"}</span>
                {isMe && <span className="ml-1 text-xs text-fg">(you)</span>}
              </div>
              <div className="relative overflow-hidden">
                {marks.map((m) => (
                  <span key={m} className="absolute inset-y-0 w-px bg-line/60" style={{ left: `${pos(m)}%` }} />
                ))}
                {wipe && (
                  <span
                    className="absolute inset-y-0 bg-dmg/15"
                    style={{
                      left: `${Math.max(0, pos(wipe.startMs))}%`,
                      width: `max(3px, ${Math.min(100, pos(wipe.endMs)) - Math.max(0, pos(wipe.startMs))}%)`,
                    }}
                  />
                )}
                {own.map((d, i) => {
                  const p = pos(d.fightTimeMs);
                  const right = p > 62;
                  const ability = d.killingAbilityGameID ? abilityNames[d.killingAbilityGameID] : undefined;
                  // Close to an earlier death on the same row: show just the time, or only the marker when very close
                  // (full details on hover), so labels don't overlap.
                  const gap = i > 0 ? p - pos(own[i - 1]!.fightTimeMs) : 100;
                  const crowded = gap < 6;
                  const label = gap < 22 ? null : ability;
                  return (
                    <span
                      key={d.order}
                      className="absolute top-1/2 flex -translate-y-1/2 items-center gap-1.5 whitespace-nowrap text-xs"
                      style={right ? { right: `${100 - p}%` } : { left: `${p}%` }}
                      title={`#${d.order} ${fightTime(d.fightTimeMs)} ${names[d.targetID!] ?? ""}${ability ? ` – ${ability}` : ""}`}
                    >
                      {right && !crowded && (
                        <span className="text-muted">
                          <span className="num text-fg/85">{fightTime(d.fightTimeMs)}</span> {label}
                        </span>
                      )}
                      <span className={`h-3 w-[3px] shrink-0 ${d.category === "early" || d.category === "wipe-start" ? "bg-dmg" : "bg-muted"}`} />
                      {!right && !crowded && (
                        <span className="text-muted">
                          <span className="num text-fg/85">{fightTime(d.fightTimeMs)}</span> {label}
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <Axis range={range} indent />
      <div className="mt-1 flex flex-wrap gap-4 text-[11px] text-faint">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-[3px] bg-dmg" /> died before or at the start of the wipe
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-[3px] bg-muted" /> during or after the wipe
        </span>
        {wipe && (
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-3 bg-dmg/30" /> wipe
          </span>
        )}
      </div>
    </div>
  );
}
