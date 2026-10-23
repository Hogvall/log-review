"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export type AppView = "personal" | "raid";

/**
 * The closest page of each view to where you are, worked out from the URL alone:
 *   /r/<code>/<fight>/<actor>                         ↔ /r/<code>/raid/<boss>/players/<actor>?scope=<fight>
 *   /r/<code>/<fight>                                 ↔ /r/<code>/raid/<boss>?scope=<fight>
 *   /r/<code>                                         ↔ /r/<code>?view=raid
 * The personal → raid direction doesn't know the boss, so it goes through the report page, which redirects.
 */
export function viewLinks(pathname: string, search: URLSearchParams): { active: AppView; personal: string; raid: string } | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "r" || !parts[1]) return null;
  const code = parts[1];
  if (parts[2] === "raid") {
    const scope = search.get("scope");
    const fight = scope && /^\d+$/.test(scope) ? scope : null;
    const actor = parts[4] === "players" ? parts[5] : undefined;
    return {
      active: "raid",
      raid: `${pathname}${scope ? `?scope=${scope}` : ""}`,
      personal: fight ? (actor ? `/r/${code}/${fight}/${actor}` : `/r/${code}/${fight}`) : `/r/${code}`,
    };
  }
  const [fight, actor] = [parts[2], parts[3]];
  const active: AppView = !fight && search.get("view") === "raid" ? "raid" : "personal";
  const raid = fight ? `/r/${code}?view=raid&fight=${fight}${actor ? `&actor=${actor}` : ""}` : `/r/${code}?view=raid`;
  return { active, raid, personal: fight ? pathname : `/r/${code}` };
}

/** The two halves of the site, in the header. Hidden on the home page, which has its own chooser. */
export function ViewNav() {
  const pathname = usePathname();
  const search = useSearchParams();
  const links = viewLinks(pathname, new URLSearchParams(search.toString()));
  if (!links) return null;
  const item = (view: AppView, n: string, label: string, hint: string, href: string) => {
    const active = links.active === view;
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={`block px-4 py-3 sm:px-5 ${active ? "bg-gold text-ink" : "text-fg hover:bg-raised"} ${view === "raid" ? "border-l border-line" : ""}`}
      >
        <span className="block text-sm font-bold">
          <span className="num">{n}</span> {label}
        </span>
        <span className={`hidden text-[13px] sm:block ${active ? "text-ink/75" : "text-muted"}`}>{hint}</span>
      </Link>
    );
  };
  return (
    <nav aria-label="View" className="grid grid-cols-2 border-l border-line">
      {item("personal", "01", "Personal improvement", "opener · cooldowns · potions · rotation", links.personal)}
      {item("raid", "02", "Raid leader", "damage check · deaths · avoidable", links.raid)}
    </nav>
  );
}
