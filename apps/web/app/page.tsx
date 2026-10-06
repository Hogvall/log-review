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
      setError("That doesn't look like a Warcraft Logs report link. It should look like warcraftlogs.com/reports/AbCd…");
      return;
    }
    // Links opened on a fight or player skip straight ahead.
    if (typeof ref.fight === "number" && ref.source) router.push(`/r/${ref.code}/${ref.fight}/${ref.source}`);
    else if (typeof ref.fight === "number") router.push(`/r/${ref.code}/${ref.fight}`);
    else if (ref.fight === "last") router.push(`/r/${ref.code}?fight=last`);
    else router.push(`/r/${ref.code}`);
  }

  return (
    <div className="mx-auto max-w-2xl pt-6 sm:pt-16">
      <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">What went wrong on that pull?</h1>
      <p className="mt-3 text-lg text-slate-400">
        Paste a Warcraft Logs report. We'll show what killed you, whether you could have avoided it, and what to fix first.
      </p>
      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-3 sm:flex-row">
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
          className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-4 py-3 text-white placeholder:text-slate-500 focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={!url.trim()}
          className="rounded-lg bg-accent px-6 py-3 font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
        >
          Analyze
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-300">
          {error}
        </p>
      )}
      <ol className="mt-12 grid gap-4 text-sm text-slate-400 sm:grid-cols-3">
        {[
          ["1. Paste your log", "Any public Warcraft Logs report from the current raid."],
          ["2. Pick a pull and yourself", "We'll pre-select your best pull."],
          ["3. Get your top fixes", "Deaths, avoidable damage, and how top players handle it."],
        ].map(([title, body]) => (
          <li key={title} className="rounded-lg border border-line p-4">
            <div className="font-medium text-slate-200">{title}</div>
            <div className="mt-1">{body}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}
