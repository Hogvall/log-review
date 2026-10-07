import Link from "next/link";
import { redirect } from "next/navigation";
import type { Fight } from "@log-review/wcl";
import { ErrorPanel } from "@/components/error-panel";
import { Breadcrumbs, Section } from "@/components/ui";
import { getOverview } from "@/lib/data";
import { difficultyName, fightTime } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Lower is better: kills first, then the lowest boss health. */
const progress = (f: Fight) => (f.kill ? -1 : (f.bossPercentage ?? 100));

const buttonClass = "border border-line px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-fg hover:border-fg";

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
  const groups = new Map<string, { name: string; encounterId: number; difficulty: number | null; pulls: (Fight & { pull: number })[] }>();
  for (const f of report.fights) {
    const key = `${f.encounterID}:${f.difficulty}`;
    const group = groups.get(key) ?? { name: f.name, encounterId: f.encounterID, difficulty: f.difficulty, pulls: [] };
    group.pulls.push({ ...f, pull: group.pulls.length + 1 });
    groups.set(key, group);
  }

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: report.title }]} />
        <h1 className="text-2xl font-semibold text-fg">{report.title}</h1>
        <p className="text-sm text-muted">{report.zone?.name}</p>
      </div>

      {groups.size === 0 && <p className="border-t border-line py-3 text-sm text-muted">No boss pulls in this report.</p>}

      {[...groups.values()].map((group) => {
        const best = [...group.pulls].sort((a, b) => progress(a) - progress(b))[0]!;
        const last = group.pulls.at(-1)!;
        const kills = group.pulls.filter((p) => p.kill).length;
        return (
          <Section
            key={`${group.name}${group.difficulty}`}
            title={`${group.name} · ${difficultyName(group.difficulty)}`}
            meta={`${group.pulls.length} ${group.pulls.length === 1 ? "pull" : "pulls"}${kills ? ` · ${kills} ${kills === 1 ? "kill" : "kills"}` : ""}`}
          >
            <div className="flex flex-wrap gap-2 pb-3">
              <Link href={`/r/${code}/${best.id}`} className={buttonClass}>
                {best.kill ? "Best kill" : `Best pull ${best.bossPercentage?.toFixed(1)}%`}
              </Link>
              {last.id !== best.id && (
                <Link href={`/r/${code}/${last.id}`} className={buttonClass}>
                  Last pull
                </Link>
              )}
              {group.pulls.length > 1 && group.difficulty && (
                <Link
                  href={`/r/${code}/raid/${group.encounterId}-${group.difficulty}`}
                  className={buttonClass}
                  title="For raid leaders: what people die to over all pulls, and whether the raid's damage is enough"
                >
                  Raid night
                </Link>
              )}
            </div>
            <details open={group.pulls.length <= 8}>
              <summary className="cursor-pointer pb-2 text-xs text-muted hover:text-fg">All pulls</summary>
              <table className="w-full text-sm">
                <tbody>
                  {[...group.pulls].reverse().map((p) => (
                    <tr key={p.id} className="border-t border-line/50 hover:bg-panel">
                      <td className="w-16 py-0">
                        <Link href={`/r/${code}/${p.id}`} className="num block py-1.5 text-muted">
                          {String(p.pull).padStart(2, "0")}
                        </Link>
                      </td>
                      <td className="py-0">
                        <Link href={`/r/${code}/${p.id}`} className="flex items-center py-1.5" aria-label={`Pull ${p.pull}`}>
                          <span className="h-1.5 w-full bg-line" aria-hidden>
                            <span
                              className={`block h-full ${p.kill ? "bg-heal" : "bg-muted"}`}
                              style={{ width: `${p.kill ? 100 : 100 - (p.bossPercentage ?? 100)}%` }}
                            />
                          </span>
                        </Link>
                      </td>
                      <td className="num w-20 py-1.5 text-right">
                        {p.kill ? <span className="text-heal">kill</span> : <span className="text-fg/85">{p.bossPercentage?.toFixed(1)}%</span>}
                      </td>
                      <td className="num w-16 py-1.5 text-right text-faint">{fightTime(p.endTime - p.startTime)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </Section>
        );
      })}
    </div>
  );
}
