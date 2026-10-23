import Link from "next/link";

export type AppView = "personal" | "raid";

/** The two halves of the site. Each page links to the closest page of the other view. */
export function ViewNav({ active, personalHref, raidHref }: { active: AppView; personalHref: string; raidHref: string }) {
  const item = (view: AppView, href: string, label: string, hint: string) => (
    <Link
      href={href}
      aria-current={active === view ? "page" : undefined}
      className={`-mb-px border-b-2 px-3 py-2 ${active === view ? "border-fg text-fg" : "border-transparent text-faint hover:text-muted"}`}
    >
      <span className="block text-[11px] font-semibold uppercase tracking-[0.07em]">{label}</span>
      <span className="hidden text-xs font-normal sm:block">{hint}</span>
    </Link>
  );
  return (
    <nav aria-label="View" className="-mx-4 mb-5 flex border-b border-line px-4 sm:mx-0 sm:px-0">
      {item("personal", personalHref, "Personal improvement", "Opener, cooldowns, potions, rotation")}
      {item("raid", raidHref, "Raid leader", "Damage check, deaths, avoidable damage")}
    </nav>
  );
}
