"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { parseReportUrl } from "@log-review/wcl/url";

/** Asks for a log, nothing else. Which view to open is picked on the next page. */
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
    // A link to one player's pull can only mean their personal view; anything else goes to the view choice,
    // carrying a linked pull through.
    if (typeof ref.fight === "number" && ref.source) router.push(`/r/${ref.code}/${ref.fight}/${ref.source}`);
    else if (ref.fight != null) router.push(`/r/${ref.code}?fight=${ref.fight}`);
    else router.push(`/r/${ref.code}`);
  }

  return (
    <div className="mx-auto max-w-2xl pt-6 sm:pt-16">
      <section className="border border-line bg-panel p-5 sm:p-7">
        <h1 className="text-3xl font-extrabold tracking-tight text-fg">Review a raid log</h1>
        <p className="mt-1 text-muted">Paste a public Warcraft Logs report. Next you pick what to look at: your own play, or the raid as a whole.</p>
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
            className="num min-w-0 flex-1 border border-line bg-raised px-3 py-3 text-sm text-fg placeholder:text-muted focus:border-gold focus:outline-none"
          />
          <button
            type="submit"
            disabled={!url.trim()}
            className="border border-gold bg-gold px-6 py-3 text-sm font-bold text-ink hover:bg-transparent hover:text-gold disabled:opacity-30"
          >
            Open log
          </button>
        </form>
        {error && (
          <p role="alert" className="mt-2 text-sm text-dmg">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
