import Link from "next/link";
import { redirect } from "next/navigation";
import type { Fight } from "@log-review/wcl";
import { ErrorPanel } from "@/components/error-panel";
import { Breadcrumbs, Section } from "@/components/ui";
import type { AppView } from "@/components/view-nav";
import { getOverview } from "@/lib/data";
import { difficultyName, fightTime } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Lower is better: kills first, then the lowest boss health. */
const progress = (f: Fight) => (f.kill ? -1 : (f.bossPercentage ?? 100));

const buttonClass = "border border-line px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-fg hover:border-gold hover:text-gold";

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ fight?: string; view?: string; actor?: string }>;
}) {
  const { code } = await params;
  const { fight, view: viewParam, actor } = await searchParams;
  const view: AppView = viewParam === "raid" ? "raid" : "personal";

  let report;
  try {
    report = await getOverview(code);
  } catch (error) {
    return <ErrorPanel error={error} />;
  }
  // Links that name a pull skip ahead: to its player list, or to the raid view of that pull.
  const linked = fight === "last" ? report.fights.at(-1) : fight ? report.fights.find((f) => f.id === Number(fight)) : undefined;
  if (linked) {
    const boss = `/r/${code}/raid/${linked.encounterID}-${linked.difficulty}`;
    if (view === "raid" && linked.difficulty) redirect(actor && /^\d+$/.test(actor) ? `${boss}/players/${actor}?scope=${linked.id}` : `${boss}?scope=${linked.id}`);
    redirect(`/r/${code}/${linked.id}`);
  }

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
        <p className="text-sm text-muted">
          {report.zone?.name} ·{" "}
          {view === "personal" ? "pick a pull, then yourself" : "pick a boss: the whole night, all wipes, the kill or one pull"}
        </p>
      </div>

      {groups.size === 0 && <p className="border-t border-line py-3 text-sm text-muted">No boss pulls in this report.</p>}

      {[...groups.values()].map((group) => {
        const best = [...group.pulls].sort((a, b) => progress(a) - progress(b))[0]!;
        const last = group.pulls.at(-1)!;
        const kills = group.pulls.filter((p) => p.kill).length;
        const raidBase = group.difficulty ? `/r/${code}/raid/${group.encounterId}-${group.difficulty}` : null;
        // In the raid view each pull opens the raid page for that pull; in the personal view, its player list.
        const pullHref = (id: number) => (view === "raid" && raidBase ? `${raidBase}?scope=${id}` : `/r/${code}/${id}`);
        return (
          <Section
            key={`${group.name}${group.difficulty}`}
            title={`${group.name} · ${difficultyName(group.difficulty)}`}
            meta={`${group.pulls.length} ${group.pulls.length === 1 ? "pull" : "pulls"}${kills ? ` · ${kills} ${kills === 1 ? "kill" : "kills"}` : ""}`}
          >
            <div className="flex flex-wrap gap-2 pb-3">
              {view === "raid" && raidBase ? (
                <>
                  <Link href={`${raidBase}?scope=all`} className={buttonClass}>
                    All pulls
                  </Link>
                  {group.pulls.length > kills && (
                    <Link href={`${raidBase}?scope=wipes`} className={buttonClass}>
                      All wipes
                    </Link>
                  )}
                  {kills > 0 && (
                    <Link href={`${raidBase}?scope=kill`} className={buttonClass}>
                      The kill
                    </Link>
                  )}
                  <Link href={`${raidBase}/players?scope=all`} className={buttonClass}>
                    Players
                  </Link>
                </>
              ) : (
                <>
                  <Link href={pullHref(best.id)} className={buttonClass}>
                    {best.kill ? "Best kill" : `Best pull ${best.bossPercentage?.toFixed(1)}%`}
                  </Link>
                  {last.id !== best.id && (
                    <Link href={pullHref(last.id)} className={buttonClass}>
                      Last pull
                    </Link>
                  )}
                </>
              )}
            </div>
            <details open={group.pulls.length <= 8}>
              <summary className="cursor-pointer pb-2 text-xs text-muted hover:text-fg">All pulls</summary>
              <table className="w-full text-sm">
                <tbody>
                  {[...group.pulls].reverse().map((p) => (
                    <tr key={p.id} className="border-t border-line/50 hover:bg-panel">
                      <td className="w-16 py-0">
                        <Link href={pullHref(p.id)} className="num block py-1.5 text-muted">
                          {String(p.pull).padStart(2, "0")}
                        </Link>
                      </td>
                      <td className="py-0">
                        <Link href={pullHref(p.id)} className="flex items-center py-1.5" aria-label={`Pull ${p.pull}`}>
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
