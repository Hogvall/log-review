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
    <div className="space-y-6">
      {me && (
        <Link
          href={`${baseHref}/${me.id}`}
          className="flex items-center justify-between rounded-xl border border-accent/50 bg-accent/10 px-4 py-3 hover:bg-accent/20"
        >
          <span>
            <span className="block text-xs uppercase tracking-wide text-accent">Continue as</span>
            <span className="text-lg font-semibold" style={{ color: classColor(me.classSlug) }}>
              {me.name}
            </span>{" "}
            <span className="text-sm text-slate-400">{specLabel(me.specKey, me.classSlug)}</span>
          </span>
          <span aria-hidden className="text-accent">
            →
          </span>
        </Link>
      )}
      {groups
        .filter((g) => g.players.length)
        .map((group) => (
          <div key={group.label}>
            <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-slate-400">{group.label}</h2>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
              {group.players.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`${baseHref}/${p.id}`}
                    className="flex items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2.5 hover:border-slate-500"
                    style={{ borderLeft: `4px solid ${classColor(p.classSlug)}` }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium" style={{ color: classColor(p.classSlug) }}>
                        {p.name}
                      </span>
                      <span className="block truncate text-xs text-slate-400">{specLabel(p.specKey, p.classSlug)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}
