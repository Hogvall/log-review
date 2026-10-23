import type { ReactNode } from "react";
import Link from "next/link";
import { abilityIconUrl, wowheadSpellUrl } from "@/lib/format";

/** A HUD panel with a small gold header. The basic building block of every page. */
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
    <section id={id} className={`border border-line bg-panel px-4 pb-4 sm:px-5 ${className}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 pt-4 pb-3">
        <h2 className="hud-title">{title}</h2>
        {meta && <span className="text-xs text-muted">{meta}</span>}
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
      <h2 className="hud-title">{children}</h2>
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

/** A spell's icon as a square, linked to Wowhead. Cooldowns get a gold frame. */
export function SpellIcon({
  id,
  name,
  icon,
  size = 28,
  gold,
  title,
}: {
  id: number;
  name?: string;
  icon?: string;
  size?: number;
  gold?: boolean;
  title?: string;
}) {
  return (
    <a href={wowheadSpellUrl(id)} target="_blank" rel="noreferrer" title={title ?? name} className="block shrink-0" style={{ width: size, height: size }}>
      {icon ? (
        <img
          src={abilityIconUrl(icon)}
          alt={name ?? `Spell ${id}`}
          width={size}
          height={size}
          className={`block box-border ${gold ? "border-2 border-gold" : "border border-black"}`}
          style={{ width: size, height: size }}
        />
      ) : (
        <span className={`block h-full w-full bg-line ${gold ? "border-2 border-gold" : "border border-black"}`} />
      )}
    </a>
  );
}

/** A meter in 20 segments, like a game resource bar. */
export function Meter({ label, value, share, color }: { label: string; value: ReactNode; share: number; color: string }) {
  const lit = Math.round(Math.max(0, Math.min(1, share)) * 20);
  return (
    <div>
      <div className="flex justify-between gap-3 text-xs">
        <span className="font-semibold uppercase tracking-[0.08em] text-muted">{label}</span>
        <span className="num font-bold text-fg">{value}</span>
      </div>
      <div className="mt-1 grid grid-cols-[repeat(20,minmax(0,1fr))] gap-0.5" aria-hidden>
        {Array.from({ length: 20 }, (_, i) => (
          <span key={i} className="h-2" style={{ background: i < lit ? color : "var(--color-line)" }} />
        ))}
      </div>
    </div>
  );
}

/** Dark or light text, whichever reads on a class color. */
export function textOn(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.2 ? "#0d1220" : "#ffffff";
}
