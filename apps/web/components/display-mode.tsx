"use client";

import { type ReactNode, createContext, useContext, useEffect, useState } from "react";

/** How cast data is shown: a timestamped list ("0:01.2 Fireball") or marks on a time axis. */
export type DisplayMode = "list" | "timeline";

const STORAGE_KEY = "rlc:display";
const Ctx = createContext<{ mode: DisplayMode; setMode: (m: DisplayMode) => void }>({ mode: "timeline", setMode: () => {} });

export function DisplayModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<DisplayMode>("timeline");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "list" || saved === "timeline") setModeState(saved);
    } catch {
      // Blocked storage: the default is fine.
    }
  }, []);
  const setMode = (m: DisplayMode) => {
    setModeState(m);
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {
      // Remembering is only a convenience.
    }
  };
  return <Ctx.Provider value={{ mode, setMode }}>{children}</Ctx.Provider>;
}

/** The List / Timeline switch. Every ByMode on the page follows it. */
export function DisplaySwitch() {
  const { mode, setMode } = useContext(Ctx);
  const option = (m: DisplayMode, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={mode === m}
      onClick={() => setMode(m)}
      className={`px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.07em] ${mode === m ? "bg-fg text-ink" : "text-muted hover:text-fg"}`}
    >
      {label}
    </button>
  );
  return (
    <div role="radiogroup" aria-label="Show casts as" className="inline-flex border border-line">
      {option("list", "Cast list")}
      {option("timeline", "Timeline")}
    </div>
  );
}

/** Renders `list` or `timeline`, following the page's switch. */
export function ByMode({ list, timeline }: { list: ReactNode; timeline: ReactNode }) {
  const { mode } = useContext(Ctx);
  return <>{mode === "list" ? list : timeline}</>;
}
