import type { ReactNode } from "react";
import Link from "next/link";
import { abilityIconUrl, wowheadSpellUrl } from "@/lib/format";

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-panel p-4 sm:p-5 ${className}`}>{children}</section>;
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3">
      <h2 className="text-lg font-semibold text-white">{children}</h2>
      {hint && <p className="text-sm text-slate-400">{hint}</p>}
    </div>
  );
}

const TONES = {
  red: "bg-red-500/15 text-red-300 ring-red-500/30",
  amber: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  green: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  slate: "bg-slate-500/15 text-slate-300 ring-slate-500/30",
  blue: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
} as const;

export type Tone = keyof typeof TONES;

export function Badge({ tone = "slate", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {children}
    </span>
  );
}

/** Spell icon + name, linked to Wowhead (which adds hover tooltips). */
export function Ability({ id, name, icon }: { id: number; name?: string; icon?: string }) {
  return (
    <a
      href={wowheadSpellUrl(id)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 align-middle font-medium text-white hover:underline"
    >
      {icon && <img src={abilityIconUrl(icon)} alt="" width={18} height={18} className="rounded-sm" />}
      {name ?? `Spell ${id}`}
    </a>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="mb-4 flex flex-wrap items-center gap-1 text-sm text-slate-400">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span aria-hidden>›</span>}
          {item.href ? (
            <Link href={item.href} className="hover:text-white">
              {item.label}
            </Link>
          ) : (
            <span className="text-slate-200">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
