import type { ReactNode } from "react";
import Link from "next/link";
import { abilityIconUrl, wowheadSpellUrl } from "@/lib/format";

/** A flat block separated by a rule, with a small uppercase header. The basic building block instead of cards. */
export function Section({
  title,
  meta,
  children,
  id,
  className = "",
}: {
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section id={id} className={`border-t border-line ${className}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-muted">{title}</h2>
        {meta && <span className="text-xs text-faint">{meta}</span>}
      </header>
      {children}
    </section>
  );
}

/** Kept for simple wrappers; now just a ruled block. */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`border-t border-line pt-3 ${className}`}>{children}</div>;
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-muted">{children}</h2>
      {hint && <p className="text-sm text-faint">{hint}</p>}
    </div>
  );
}

const TONES = {
  red: "text-dmg",
  amber: "text-warn",
  green: "text-heal",
  slate: "text-faint",
  blue: "text-shield",
} as const;

export type Tone = keyof typeof TONES;

/** A label as plain colored text (no pill). */
export function Badge({ tone = "slate", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`text-xs font-medium lowercase ${TONES[tone]}`}>
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
      className="inline-flex items-center gap-1.5 align-middle text-fg decoration-faint underline-offset-4 hover:underline"
    >
      {icon && <img src={abilityIconUrl(icon)} alt="" width={16} height={16} className="outline outline-1 outline-black/60" />}
      {name ?? `Spell ${id}`}
    </a>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="mb-4 flex flex-wrap items-center gap-1.5 text-xs text-faint">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span aria-hidden>/</span>}
          {item.href ? (
            <Link href={item.href} className="hover:text-fg">
              {item.label}
            </Link>
          ) : (
            <span className="text-muted">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

/** A plain text link. */
export const linkClass = "text-fg underline decoration-line underline-offset-4 hover:decoration-fg";
