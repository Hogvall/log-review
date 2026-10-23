"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { parseReportUrl } from "@log-review/wcl/url";

type View = "personal" | "raid";
const STORAGE_KEY = "rlc:view";

const VIEWS: { id: View; title: string; lead: string; points: string[] }[] = [
  {
    id: "personal",
    title: "Personal improvement",
    lead: "Your casts next to the top players of your spec.",
    points: [
      "Your opener cast by cast next to top players' openers",
      "Cooldown use over the whole fight",
      "Which potions you drink, and when, compared with top players",
      "Rotation mistakes, with the DPS they cost",
      "Every cast as a list (0:01.2 Fireball) or on a timeline",
    ],
  },
  {
    id: "raid",
    title: "Raid leader",
    lead: "The raid as a whole, or one player at a time.",
    points: [
      "Is the damage enough to kill the boss?",
      "What people die to, and whether it's getting better",
      "What the raid takes damage from, and what was avoidable",
      "Who takes the most avoidable damage",
      "Look at one pull, all wipes or the kill",
    ],
  },
];

export default function Home() {
  const router = useRouter();
  const [view, setView] = useState<View>("personal");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "personal" || saved === "raid") setView(saved);
    } catch {
      // Blocked storage: start on the personal view.
    }
  }, []);

  function choose(v: View) {
    setView(v);
    try {
      localStorage.setItem(STORAGE_KEY, v);
    } catch {
      // Remembering is only a convenience.
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ref = parseReportUrl(url);
    if (!ref) {
      setError("Not a Warcraft Logs report link. Expected warcraftlogs.com/reports/…");
      return;
    }
    if (view === "raid") {
      // The report page sends a linked pull on to the raid view of that pull.
      router.push(ref.fight != null ? `/r/${ref.code}?view=raid&fight=${ref.fight}` : `/r/${ref.code}?view=raid`);
      return;
    }
    // Links opened on a fight or player skip straight ahead.
    if (typeof ref.fight === "number" && ref.source) router.push(`/r/${ref.code}/${ref.fight}/${ref.source}`);
    else if (typeof ref.fight === "number") router.push(`/r/${ref.code}/${ref.fight}`);
    else if (ref.fight === "last") router.push(`/r/${ref.code}?fight=last`);
    else router.push(`/r/${ref.code}`);
  }

  return (
    <div className="max-w-3xl pt-4 sm:pt-10">
      <h1 className="text-2xl font-semibold text-fg">Review a raid log</h1>
      <p className="mt-1 text-muted">First pick what you want to look at, then paste a public Warcraft Logs report.</p>

      <div role="radiogroup" aria-label="What do you want to look at?" className="mt-6 grid gap-px border border-line bg-line sm:grid-cols-2">
        {VIEWS.map((v) => {
          const active = view === v.id;
          return (
            <button
              key={v.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => choose(v.id)}
              className={`flex flex-col items-start p-4 text-left ${active ? "bg-panel shadow-[inset_0_3px_0_var(--color-gold)]" : "bg-ink hover:bg-panel"}`}
            >
              <span className="flex w-full items-center justify-between">
                <span className={`text-sm font-semibold uppercase tracking-[0.07em] ${active ? "text-fg" : "text-muted"}`}>{v.title}</span>
                <span aria-hidden className={`h-3 w-3 border ${active ? "border-gold bg-gold" : "border-faint"}`} />
              </span>
              <span className="mt-1 text-sm text-fg/85">{v.lead}</span>
              <ul className="mt-3 space-y-1 text-sm text-muted">
                {v.points.map((p) => (
                  <li key={p} className="flex gap-2">
                    <span aria-hidden className="text-faint">–</span>
                    {p}
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="url" className="sr-only">
          Warcraft Logs report link
        </label>
        <input
          id="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          placeholder="https://www.warcraftlogs.com/reports/…"
          autoFocus
          className="num min-w-0 flex-1 border border-line bg-panel px-3 py-2.5 text-sm text-fg placeholder:text-faint focus:border-muted focus:outline-none"
        />
        <button
          type="submit"
          disabled={!url.trim()}
          className="border border-gold bg-gold px-5 py-2.5 text-sm font-bold text-ink hover:bg-transparent hover:text-gold disabled:opacity-30"
        >
          Open {view === "personal" ? "personal view" : "raid view"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm text-dmg">
          {error}
        </p>
      )}
    </div>
  );
}
