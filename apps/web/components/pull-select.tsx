"use client";

import { useRouter } from "next/navigation";

/** A dropdown of single pulls; picking one opens the same raid page scoped to it. */
export function PullSelect({ baseHref, pulls, value }: { baseHref: string; pulls: { id: number; label: string }[]; value: number | null }) {
  const router = useRouter();
  return (
    <label className="inline-flex items-center gap-2 text-xs text-faint">
      <span className="sr-only">Pull</span>
      <select
        value={value ?? ""}
        onChange={(e) => e.target.value && router.push(`${baseHref}?scope=${e.target.value}`)}
        className={`num border bg-panel px-2 py-1.5 text-xs ${value ? "border-gold text-gold" : "border-line text-muted"} focus:outline-none`}
      >
        <option value="">One pull…</option>
        {pulls.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}
