"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { classColor, specLabel } from "@/lib/format";

export interface PickerPlayer {
  id: number;
  name: string;
  classSlug: string;
  specKey: string | null;
}

const STORAGE_KEY = "rlc:character";

function readCharacter(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Remembers the last character the viewer analyzed, so the picker can highlight them next time. */
export function RememberCharacter({ name }: { name: string }) {
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, name);
    } catch {
      // Private browsing or blocked storage: remembering is only a convenience.
    }
  }, [name]);
  return null;
}

export function PlayerPicker({
  baseHref,
  groups,
}: {
  baseHref: string;
  groups: { label: string; players: PickerPlayer[] }[];
}) {
  const [remembered, setRemembered] = useState<string | null>(null);
  useEffect(() => setRemembered(readCharacter()), []);
  const me = groups.flatMap((g) => g.players).find((p) => p.name === remembered);

  return (
    <div className="space-y-5">
      {me && (
        <Link href={`${baseHref}/${me.id}`} className="flex items-baseline gap-3 border border-line bg-panel px-3 py-2 hover:border-muted">
          <span className="text-[11px] uppercase tracking-[0.07em] text-faint">Continue as</span>
          <span className="font-semibold" style={{ color: classColor(me.classSlug) }}>
            {me.name}
          </span>
          <span className="text-sm text-muted">{specLabel(me.specKey, me.classSlug)}</span>
        </Link>
      )}
      {groups
        .filter((g) => g.players.length)
        .map((group) => (
          <section key={group.label} className="border-t border-line">
            <h2 className="py-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted">{group.label}</h2>
            <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 md:grid-cols-3">
              {group.players.map((p) => (
                <li key={p.id} className="border-b border-line/50">
                  <Link href={`${baseHref}/${p.id}`} className="flex items-baseline justify-between gap-3 py-1.5 hover:bg-panel">
                    <span className="truncate font-medium" style={{ color: classColor(p.classSlug) }}>
                      {p.name}
                    </span>
                    <span className="shrink-0 text-xs text-faint">{specLabel(p.specKey, p.classSlug)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
