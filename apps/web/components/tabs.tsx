"use client";

import { type ReactNode, useEffect, useState } from "react";

export interface Tab {
  id: string;
  label: string;
  /** Small count or marker shown next to the label, e.g. number of issues. */
  badge?: string;
  content: ReactNode;
}

/** Tabs whose selection lives in the URL hash, so a link can open a specific tab. */
export function Tabs({ tabs }: { tabs: Tab[] }) {
  const [active, setActive] = useState(tabs[0]?.id);

  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.slice(1);
      if (tabs.some((t) => t.id === id)) setActive(id);
      // Links to a specific death (#death-3) live in the deaths tab.
      else if (id.startsWith("death-")) setActive("deaths");
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [tabs]);

  return (
    <div>
      <div role="tablist" className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            onClick={() => {
              setActive(t.id);
              history.replaceState(null, "", `#${t.id}`);
            }}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
              active === t.id ? "border-accent text-white" : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            {t.label}
            {t.badge && <span className="rounded-full bg-red-500/20 px-1.5 text-xs text-red-300">{t.badge}</span>}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" hidden={active !== t.id} className="pt-5">
          {t.content}
        </div>
      ))}
    </div>
  );
}
