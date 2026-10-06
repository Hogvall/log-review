"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { parseReportUrl } from "@log-review/wcl/url";

export default function Home() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ref = parseReportUrl(url);
    if (!ref) {
      setError("Not a Warcraft Logs report link. Expected warcraftlogs.com/reports/…");
      return;
    }
    // Links opened on a fight or player skip straight ahead.
    if (typeof ref.fight === "number" && ref.source) router.push(`/r/${ref.code}/${ref.fight}/${ref.source}`);
    else if (typeof ref.fight === "number") router.push(`/r/${ref.code}/${ref.fight}`);
    else if (ref.fight === "last") router.push(`/r/${ref.code}?fight=last`);
    else router.push(`/r/${ref.code}`);
  }

  return (
    <div className="max-w-2xl pt-4 sm:pt-12">
      <h1 className="text-2xl font-semibold text-fg">Review a pull</h1>
      <p className="mt-1 text-muted">
        Paste a public Warcraft Logs report. You get what killed you, what was avoidable, and how your casts compare with the top 15 of
        your spec.
      </p>
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
          className="border border-fg bg-fg px-5 py-2.5 text-sm font-semibold text-ink hover:bg-transparent hover:text-fg disabled:opacity-30"
        >
          Open
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm text-dmg">
          {error}
        </p>
      )}
      <dl className="mt-10 grid gap-x-6 gap-y-1 border-t border-line pt-4 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
        <dt className="text-faint">Deaths</dt>
        <dd className="text-muted">Health and every hit in the seconds before, defensives you had, who was healing you.</dd>
        <dt className="text-faint">Mechanics</dt>
        <dd className="text-muted">Which boss abilities top players avoid, with notes from the Mythic Trap guides.</dd>
        <dt className="text-faint">Performance</dt>
        <dd className="text-muted">Casts, buffs, targets and cooldowns against the top 15 of your spec, updated weekly.</dd>
      </dl>
    </div>
  );
}
