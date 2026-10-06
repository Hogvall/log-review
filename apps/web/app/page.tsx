"use client";

import { useState, type FormEvent } from "react";
import type { ReportOverview } from "@log-review/wcl";

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportOverview | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch(`/api/report?url=${encodeURIComponent(url)}`);
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Something went wrong.");
      else setReport(body.report);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>Raid Log Coach</h1>
      <p>Paste a Warcraft Logs report link to see what went wrong.</p>
      <form onSubmit={onSubmit} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.warcraftlogs.com/reports/..."
          style={{ flex: "1 1 300px", padding: 8 }}
        />
        <button type="submit" disabled={loading || !url.trim()}>
          {loading ? "Loading…" : "Analyze"}
        </button>
      </form>

      {error && <p role="alert" style={{ color: "crimson" }}>{error}</p>}

      {report && (
        <section>
          <h2>{report.title}</h2>
          <p>{report.zone?.name}</p>
          <ul>
            {report.fights.map((f) => (
              <li key={f.id}>
                {f.name}: {f.kill ? "Kill" : `Wipe at ${f.bossPercentage?.toFixed(1)}%`} (
                {Math.round((f.endTime - f.startTime) / 1000)}s)
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
