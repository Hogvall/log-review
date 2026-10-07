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
      // Links to a specific death (#death-3) or the raid deaths list live in the deaths tab.
      else if (id.startsWith("death-") || id === "raid-deaths") setActive("deaths");
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [tabs]);

  return (
    <div>
      <div role="tablist" className="-mx-4 flex overflow-x-auto border-y border-line px-4 sm:mx-0 sm:px-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            onClick={() => {
              setActive(t.id);
              history.replaceState(null, "", `#${t.id}`);
            }}
            className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.07em] ${
              active === t.id ? "border-fg text-fg" : "border-transparent text-faint hover:text-muted"
            }`}
          >
            {t.label}
            {t.badge && <span className="num text-dmg">{t.badge}</span>}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" hidden={active !== t.id} className="pt-3">
          {t.content}
        </div>
      ))}
    </div>
  );
}
