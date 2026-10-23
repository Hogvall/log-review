import Link from "next/link";
import type { AppView } from "./view-nav";

const VIEWS: { id: AppView; n: string; title: string; lead: string; points: string[] }[] = [
  {
    id: "personal",
    n: "01",
    title: "Personal improvement",
    lead: "Your casts next to the top players of your spec.",
    points: [
      "Your opener cast by cast next to top players' openers",
      "Cooldown use over the whole fight",
      "Which potions you drink, and when, compared with top players",
      "Rotation mistakes, with the DPS they cost",
      "Every cast as a list or on a timeline",
    ],
  },
  {
    id: "raid",
    n: "02",
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

/** The two views as big choices, shown once a log is entered. `fight` carries a linked pull through. */
export function ViewChooser({ code, fight }: { code: string; fight?: string }) {
  return (
    <div className="grid gap-px border border-line bg-line sm:grid-cols-2">
      {VIEWS.map((v) => (
        <Link
          key={v.id}
          href={`/r/${code}?view=${v.id}${fight ? `&fight=${fight}` : ""}`}
          className="group flex flex-col items-start bg-panel p-5 hover:shadow-[inset_0_3px_0_var(--color-gold)]"
        >
          <span className="text-lg font-extrabold text-fg group-hover:text-gold">
            <span className="num text-gold">{v.n}</span> {v.title}
          </span>
          <span className="mt-1 text-sm text-fg">{v.lead}</span>
          <ul className="mt-3 space-y-1 text-sm text-muted">
            {v.points.map((p) => (
              <li key={p} className="flex gap-2">
                <span aria-hidden className="text-gold">
                  ▸
                </span>
                {p}
              </li>
            ))}
          </ul>
          <span className="mt-4 border border-gold px-4 py-2 text-sm font-bold text-gold group-hover:bg-gold group-hover:text-ink">Open {v.title.toLowerCase()} →</span>
        </Link>
      ))}
    </div>
  );
}
