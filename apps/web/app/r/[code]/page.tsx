import Link from "next/link";
import { redirect } from "next/navigation";
import type { Fight } from "@log-review/wcl";
import { ErrorPanel } from "@/components/error-panel";
import { Badge, Breadcrumbs, Panel } from "@/components/ui";
import { getOverview } from "@/lib/data";
import { difficultyName, fightTime } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Lower is better: kills first, then the lowest boss health. */
const progress = (f: Fight) => (f.kill ? -1 : (f.bossPercentage ?? 100));

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ fight?: string }>;
}) {
  const { code } = await params;
  const { fight } = await searchParams;

  let report;
  try {
    report = await getOverview(code);
  } catch (error) {
    return <ErrorPanel error={error} />;
  }
  if (fight === "last" && report.fights.length) redirect(`/r/${code}/${report.fights.at(-1)!.id}`);

  // Group pulls by boss and difficulty, numbering pulls in order.
  const groups = new Map<string, { name: string; difficulty: number | null; pulls: (Fight & { pull: number })[] }>();
  for (const f of report.fights) {
    const key = `${f.encounterID}:${f.difficulty}`;
    const group = groups.get(key) ?? { name: f.name, difficulty: f.difficulty, pulls: [] };
    group.pulls.push({ ...f, pull: group.pulls.length + 1 });
    groups.set(key, group);
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: report.title }]} />
      <h1 className="text-2xl font-bold text-white">{report.title}</h1>
      <p className="text-slate-400">{report.zone?.name}</p>

      {groups.size === 0 && (
        <Panel className="mt-6">
          <p>No boss pulls in this report.</p>
        </Panel>
      )}

      <div className="mt-6 space-y-6">
        {[...groups.values()].map((group) => {
          const best = [...group.pulls].sort((a, b) => progress(a) - progress(b))[0]!;
          const last = group.pulls.at(-1)!;
          const kills = group.pulls.filter((p) => p.kill).length;
          return (
            <Panel key={`${group.name}${group.difficulty}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold text-white">
                  {group.name} <span className="text-slate-400">{difficultyName(group.difficulty)}</span>
                </h2>
                <span className="text-sm text-slate-400">
                  {group.pulls.length} {group.pulls.length === 1 ? "pull" : "pulls"}
                  {kills > 0 && ` · ${kills} ${kills === 1 ? "kill" : "kills"}`}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href={`/r/${code}/${best.id}`}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink hover:brightness-110"
                >
                  {best.kill ? "Best kill" : `Best pull (${best.bossPercentage?.toFixed(1)}%)`} →
                </Link>
                {last.id !== best.id && (
                  <Link
                    href={`/r/${code}/${last.id}`}
                    className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/5"
                  >
                    Last pull →
                  </Link>
                )}
              </div>

              <details className="mt-4 group" open={group.pulls.length <= 8}>
                <summary className="cursor-pointer text-sm text-slate-400 hover:text-slate-200">All pulls</summary>
                <ul className="mt-2 divide-y divide-line">
                  {[...group.pulls].reverse().map((p) => (
                    <li key={p.id}>
                      <Link href={`/r/${code}/${p.id}`} className="flex items-center gap-3 py-2 hover:bg-white/5 sm:px-2">
                        <span className="w-16 shrink-0 text-sm text-slate-400">Pull {p.pull}</span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-line" aria-hidden>
                          <span
                            className={`block h-full ${p.kill ? "bg-emerald-400" : "bg-accent/70"}`}
                            style={{ width: `${p.kill ? 100 : 100 - (p.bossPercentage ?? 100)}%` }}
                          />
                        </span>
                        <span className="w-24 shrink-0 text-right">
                          {p.kill ? <Badge tone="green">Kill</Badge> : <span className="text-sm">{p.bossPercentage?.toFixed(1)}%</span>}
                        </span>
                        <span className="w-12 shrink-0 text-right text-sm text-slate-400">{fightTime(p.endTime - p.startTime)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
