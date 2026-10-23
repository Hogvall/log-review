"use client";

import { type ReactNode, useEffect, useState } from "react";

export type TimelineStyle = "list" | "lanes" | "spine" | "availability" | "events";

const STYLES: { id: TimelineStyle; label: string }[] = [
  { id: "list", label: "Cast list" },
  { id: "lanes", label: "A Icon lanes" },
  { id: "spine", label: "B Side by side" },
  { id: "availability", label: "C Availability" },
  { id: "events", label: "D Event track" },
];

const STORAGE_KEY = "rlc:timeline-style";

/** Picks one of five ways to show the pull's casts. The choice is remembered per browser. */
export function TimelineSwitch({ views }: { views: Record<TimelineStyle, ReactNode> }) {
  const [style, setStyle] = useState<TimelineStyle>("lanes");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (STYLES.some((s) => s.id === saved)) setStyle(saved as TimelineStyle);
    } catch {
      // Blocked storage: the default is fine.
    }
  }, []);
  const choose = (s: TimelineStyle) => {
    setStyle(s);
    try {
      localStorage.setItem(STORAGE_KEY, s);
    } catch {
      // Remembering is only a convenience.
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 border border-line bg-panel px-4 py-3 sm:px-5">
        <div>
          <h2 className="hud-title">Timeline</h2>
          <p className="text-sm text-muted">Five ways to look at the same casts.</p>
        </div>
        <div role="radiogroup" aria-label="Timeline style" className="flex flex-wrap border border-line">
          {STYLES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={style === s.id}
              onClick={() => choose(s.id)}
              className={`px-3 py-2.5 text-sm font-semibold ${style === s.id ? "bg-gold text-ink" : "text-fg hover:bg-raised"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {views[style]}
    </div>
  );
}
