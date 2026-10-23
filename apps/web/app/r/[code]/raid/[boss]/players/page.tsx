import Link from "next/link";
import { ErrorPanel, NotFoundPanel } from "@/components/error-panel";
import { RaidHeader, scopeLabel } from "@/components/raid";
import { Section } from "@/components/ui";
import { type RaidPlayerRow, type RaidView, getRaidView, parseScope, scopeParam } from "@/lib/raid";
import { classColor, compact, fightTime, percent, specLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

const ROLES: { role: RaidPlayerRow["role"]; label: string }[] = [
  { role: "tank", label: "Tanks" },
  { role: "healer", label: "Healers" },
  { role: "dps", label: "Damage" },
  { role: null, label: "Others" },
];

const th = "pb-1 pr-3 font-medium";

/** Every player over the scope: DPS vs top, deaths and avoidable damage. Each row opens that player. */
export default async function RaidPlayersPage({ params, searchParams }: { params: Promise<{ code: string; boss: string }>; searchParams: Promise<{ scope?: string }> }) {
  const { code, boss } = await params;
  const { scope } = await searchParams;
  const [encounterId, difficulty] = boss.split("-").map(Number);
  if (!encounterId || !difficulty) return <NotFoundPanel what="Boss" />;

  let view: RaidView | null;
  try {
    view = await getRaidView(code, encounterId, difficulty, parseScope(scope));
  } catch (error) {
    return <ErrorPanel error={error} />;
  }
  if (!view || !view.scoped.length) return <NotFoundPanel what={view ? "Pull" : "Boss"} />;

  const several = view.scoped.length > 1;
  const dmgPull = view.damagePulls[0];
  const dpsNote = !dmgPull
    ? "No damage data."
    : view.damagePulls.length === 1
      ? `DPS from pull ${dmgPull.pull} (${dmgPull.kill ? "kill" : `${dmgPull.bossPercentage?.toFixed(1)}%`}, ${fightTime(dmgPull.endTime - dmgPull.startTime)}).`
      : `DPS from the furthest pull, ${dmgPull.pull} (${dmgPull.bossPercentage?.toFixed(1)}%).`;
  const q = `?scope=${scopeParam(view.scope)}`;
  const maxAvoidable = Math.max(1, ...view.players.map((p) => p.avoidablePerPull));

  return (
    <div className="space-y-6">
      <RaidHeader view={view} code={code} page="players" />
      <p className="text-sm text-muted">
        {dpsNote} DPS is compared with top players of the same spec whose kills were closest in length. Deaths count the ones that mattered
        (before the wipe or among its first deaths) over {scopeLabel(view)}.
      </p>
      {ROLES.map(({ role, label }) => {
        const rows = view.players.filter((p) => p.role === role);
        if (!rows.length) return null;
        return (
          <Section key={label} title={label} meta={`${rows.length}`}>
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="text-left text-[11px] uppercase tracking-[0.07em] text-faint">
                  <tr className="border-b border-line">
                    <th className={th}>Player</th>
                    <th className={`${th} text-right`}>DPS</th>
                    <th className={`${th} text-right`}>vs top</th>
                    <th className={`${th} text-right`}>Deaths</th>
                    <th className={`${th} w-48`}>Avoidable damage{several ? " per pull" : ""}</th>
                    <th className="pb-1 text-right font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className="border-b border-line/40 hover:bg-panel">
                      <td className="py-1.5 pr-3">
                        <Link href={`/r/${code}/raid/${boss}/players/${p.id}${q}`} className="font-medium hover:underline" style={{ color: classColor(p.classSlug) }}>
                          {p.name}
                        </Link>{" "}
                        <span className="text-xs text-faint">{specLabel(p.specKey, p.classSlug)}</span>
                      </td>
                      <td className="num py-1.5 pr-3 text-right text-fg/85">{p.dps != null ? compact(p.dps) : "–"}</td>
                      <td
                        className={`num py-1.5 pr-3 text-right ${p.ratio != null && p.ratio < 0.8 ? "text-dmg" : "text-fg/85"}`}
                        title={p.reference ? `Top players' median: ${compact(p.reference)}` : "Healers are ranked by healing, or no benchmark yet"}
                      >
                        {p.ratio != null ? percent(p.ratio) : "–"}
                      </td>
                      <td className={`num py-1.5 pr-3 text-right ${p.deathsMattered ? "text-dmg" : "text-faint"}`} title={`${p.deaths} deaths in total`}>
                        {p.deathsMattered}
                      </td>
                      <td className="py-1.5 pr-3">
                        <div className="flex items-center gap-2">
                          <span className="h-2 flex-1 bg-line">
                            <span className="block h-full bg-dmg" style={{ width: `${(p.avoidablePerPull / maxAvoidable) * 100}%` }} />
                          </span>
                          <span className="num w-12 text-right text-fg/85">{p.avoidable ? compact(p.avoidablePerPull) : "–"}</span>
                        </div>
                      </td>
                      <td className="py-1.5 text-right text-xs">
                        {view.scope.kind === "pull" && (
                          <Link href={`/r/${code}/${view.scope.fightId}/${p.id}`} className="text-faint hover:text-fg" title="Opener, cooldowns, potions and rotation for this pull">
                            personal →
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        );
      })}
    </div>
  );
}
