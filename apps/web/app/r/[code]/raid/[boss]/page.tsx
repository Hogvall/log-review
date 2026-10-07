import Link from "next/link";
import type { DeathCause, DpsCheck } from "@log-review/analysis";
import { ErrorPanel, NotFoundPanel } from "@/components/error-panel";
import { Ability, Breadcrumbs, Section, linkClass } from "@/components/ui";
import { type RaidNight, getRaidNight } from "@/lib/night";
import { classColor, compact, difficultyName, fightTime, percent, specLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

const perPull = (n: number) => n.toFixed(n < 1 ? 2 : 1);

function Trend({ cause }: { cause: DeathCause }) {
  const { firstHalfRate: a, secondHalfRate: b } = cause;
  const label = b < a * 0.7 ? "getting better" : b > a * 1.3 ? "getting worse" : "about the same";
  const tone = b < a * 0.7 ? "text-heal" : b > a * 1.3 ? "text-dmg" : "text-muted";
  return (
    <span className="whitespace-nowrap text-xs" title="Deaths that mattered per pull, first half of the night → second half">
      <span className="num text-fg/85">
        {perPull(a)} → {perPull(b)}
      </span>{" "}
      <span className={tone}>{label}</span>
    </span>
  );
}

function DeathCauses({ night, code }: { night: RaidNight; code: string }) {
  const { deaths, abilities, tips } = night;
  if (!deaths.causes.length) return <p className="py-2 text-sm text-muted">No deaths on this boss.</p>;
  const shown = deaths.causes.filter((c) => c.mattered > 0).slice(0, 12);
  return (
    <>
      <p className="mb-2 text-sm text-muted">
        {deaths.mattered} of {deaths.total} deaths over {deaths.pullsCounted} pulls mattered: before the wipe, or among its first deaths.
        Deaths in the middle of a wipe or after it aren't counted. Each death is put down to what did the most damage in the
        seconds before it, not the killing blow.
        {deaths.firstDeathMedianMs != null && (
          <>
            {" "}
            The first death that mattered came at <span className="num text-fg">{fightTime(deaths.firstDeathMedianMs)}</span> in a typical
            pull.
          </>
        )}
      </p>
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-[11px] uppercase tracking-[0.07em] text-faint">
            <tr className="border-b border-line">
              <th className="pb-1 pr-3 font-medium">Died to</th>
              <th className="pb-1 pr-3 text-right font-medium">Deaths</th>
              <th className="pb-1 pr-3 text-right font-medium">Pulls</th>
              <th className="pb-1 pr-3 font-medium">Who</th>
              <th className="pb-1 font-medium">Per pull</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.abilityId} className="border-b border-line/40 align-top">
                <td className="py-1.5 pr-3">
                  <Ability id={c.abilityId} name={c.name} icon={abilities[c.abilityId]?.icon} />
                  {c.often && <span className="block text-xs text-muted">often with {c.often.name}</span>}
                  {tips[c.abilityId] && <span className="mt-0.5 block max-w-sm text-xs text-muted">{tips[c.abilityId]!.tip}</span>}
                </td>
                <td className="num py-1.5 pr-3 text-right text-fg" title={`${c.all} deaths in total, counting during and after the wipe`}>
                  {c.mattered}
                </td>
                <td className="num py-1.5 pr-3 text-right text-muted">{c.pulls}</td>
                <td className="py-1.5 pr-3 text-xs">
                  {c.players.slice(0, 4).map((p, i) => (
                    <span key={p.playerId}>
                      {i > 0 && ", "}
                      <Link href={`/r/${code}/${p.lastFight}/${p.playerId}#deaths`} className="hover:underline">
                        {p.name}
                      </Link>
                      {p.count > 1 && <span className="num text-faint"> ×{p.count}</span>}
                    </span>
                  ))}
                  {c.players.length > 4 && <span className="text-faint"> +{c.players.length - 4} more</span>}
                </td>
                <td className="py-1.5">
                  <Trend cause={c} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const VERDICT: Record<DpsCheck["verdict"], { title: string; tone: string }> = {
  enough: { title: "Your damage is enough", tone: "text-heal" },
  close: { title: "Your damage is close", tone: "text-warn" },
  short: { title: "You're short on damage", tone: "text-dmg" },
  unknown: { title: "Not enough kill data to judge damage yet", tone: "text-muted" },
};

function DamageCheck({ night, code }: { night: RaidNight; code: string }) {
  const { check, deaths, pulls } = night;
  if (night.kill) {
    return (
      <p className="py-2 text-sm text-heal">
        Killed on pull {night.kill.pull}. The damage check is for bosses you haven't killed yet.
      </p>
    );
  }
  if (!check || check.projectedKillMs == null) return <p className="py-2 text-sm text-muted">Not enough pulls to check damage yet.</p>;
  const v = VERDICT[check.verdict];
  const ref = check.reference;
  const pullNo = (id: number) => pulls.find((p) => p.id === id)?.pull;
  const firstDeath = deaths.firstDeathMedianMs;
  return (
    <>
      <p className={`text-lg font-semibold ${v.tone}`}>{v.title}</p>
      <p className="mt-1 max-w-2xl text-sm text-fg/85">
        At the damage your best pulls did to the boss, it would die at about{" "}
        <span className="num text-fg">{fightTime(check.projectedKillMs)}</span>.
        {ref && (
          <>
            {" "}
            Raids that kill it take <span className="num text-fg">{fightTime(ref.median)}</span> (median of {ref.n} kills), and the slower
            quarter of kills still finish by <span className="num text-fg">{fightTime(ref.p75)}</span>.
          </>
        )}
        {check.verdict === "short" && check.neededIncrease != null && (
          <> To kill it at that pace, the raid needs about {percent(check.neededIncrease)} more damage on the boss.</>
        )}
        {check.verdict === "close" && check.neededIncrease != null && (
          <> A few percent more ({percent(check.neededIncrease)}) gets you there: fewer deaths alone could cover it.</>
        )}
        {check.verdict === "enough" && <> The wipes are about mechanics: see what people die to above.</>}
        {firstDeath != null && check.projectedKillMs > firstDeath && (
          <>
            {" "}
            People typically start dying at <span className="num text-fg">{fightTime(firstDeath)}</span>, before that point.
          </>
        )}
      </p>
      <div className="-mx-4 mt-3 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[520px] max-w-2xl text-sm">
          <thead className="text-left text-[11px] uppercase tracking-[0.07em] text-faint">
            <tr className="border-b border-line">
              <th className="pb-1 pr-3 font-medium">Pull</th>
              <th className="pb-1 pr-3 text-right font-medium">Boss left</th>
              <th className="pb-1 pr-3 text-right font-medium">Length</th>
              <th className="pb-1 pr-3 text-right font-medium">Raid DPS on boss</th>
              <th className="pb-1 text-right font-medium">Would kill at</th>
            </tr>
          </thead>
          <tbody>
            {check.pulls.map((p) => (
              <tr key={p.pullId} className="border-b border-line/40">
                <td className="py-1.5 pr-3">
                  <Link href={`/r/${code}/${p.pullId}`} className={linkClass}>
                    Pull {pullNo(p.pullId)}
                  </Link>
                </td>
                <td className="num py-1.5 pr-3 text-right">{p.bossPercentage.toFixed(1)}%</td>
                <td className="num py-1.5 pr-3 text-right text-muted">{fightTime(p.durationMs)}</td>
                <td className="num py-1.5 pr-3 text-right">{compact(p.bossDps)}</td>
                <td className="num py-1.5 text-right">{p.projectedKillMs ? fightTime(p.projectedKillMs) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-faint">
        Boss health is estimated from how much damage took off how much health ({check.bossHealth ? compact(check.bossHealth) : "–"}
        {" "}in total; on council fights all bosses together). Kill times come from the top players' kills we've downloaded, so they
        lean towards stronger raids. The projection assumes the raid keeps doing the same damage for the whole fight.
      </p>
    </>
  );
}

function Players({ night, code }: { night: RaidNight; code: string }) {
  const { players, bestPull } = night;
  if (!bestPull || !players.length) return null;
  return (
    <Section title={`Players in your best pull (pull ${bestPull.pull}, ${bestPull.bossPercentage?.toFixed(1)}%)`}>
      <p className="mb-2 text-sm text-muted">
        DPS compared with top players of the same spec whose kills were closest in length. Lower numbers spread over the raid point to
        gear or strategy; a few low ones point to those players.
      </p>
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[520px] max-w-3xl text-sm">
          <thead className="text-left text-[11px] uppercase tracking-[0.07em] text-faint">
            <tr className="border-b border-line">
              <th className="pb-1 pr-3 font-medium">Player</th>
              <th className="pb-1 pr-3 text-right font-medium">DPS</th>
              <th className="pb-1 pr-3 text-right font-medium">vs top</th>
              <th className="pb-1 text-right font-medium">On boss</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.id} className="border-b border-line/40">
                <td className="py-1.5 pr-3">
                  <Link href={`/r/${code}/${bestPull.id}/${p.id}`} className="hover:underline" style={{ color: classColor(p.classSlug) }}>
                    {p.name}
                  </Link>{" "}
                  <span className="text-xs text-faint">{specLabel(p.specKey, p.classSlug)}</span>
                </td>
                <td className="num py-1.5 pr-3 text-right">{compact(p.dps)}</td>
                <td
                  className={`num py-1.5 pr-3 text-right ${p.ratio != null && p.ratio < 0.8 ? "text-dmg" : "text-fg/85"}`}
                  title={p.reference ? `Top players' median: ${compact(p.reference)}` : "Healers are ranked by healing, or no benchmark yet"}
                >
                  {p.ratio != null ? percent(p.ratio) : "–"}
                </td>
                <td className="num py-1.5 text-right text-muted">{percent(p.bossShare)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export default async function RaidNightPage({ params }: { params: Promise<{ code: string; boss: string }> }) {
  const { code, boss } = await params;
  const [encounterId, difficulty] = boss.split("-").map(Number);
  if (!encounterId || !difficulty) return <NotFoundPanel what="Boss" />;

  let night: RaidNight | null;
  try {
    night = await getRaidNight(code, encounterId, difficulty);
  } catch (error) {
    return <ErrorPanel error={error} />;
  }
  if (!night) return <NotFoundPanel what="Boss" />;

  const best = [...night.pulls].sort((a, b) => (a.kill ? -1 : (a.bossPercentage ?? 100)) - (b.kill ? -1 : (b.bossPercentage ?? 100)))[0]!;
  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs
          items={[
            { label: "Home", href: "/" },
            { label: night.report.title, href: `/r/${code}` },
            { label: `${night.name} raid night` },
          ]}
        />
        <h1 className="text-2xl font-semibold text-fg">
          {night.name} · {difficultyName(night.difficulty)}
        </h1>
        <p className="text-sm text-muted">
          {night.pulls.length} pulls
          {night.deaths.resets > 0 && ` (${night.deaths.resets} under 30s skipped as resets)`} ·{" "}
          {night.kill ? <span className="text-heal">killed on pull {night.kill.pull}</span> : <>best {best.bossPercentage?.toFixed(1)}%</>}
        </p>
      </div>

      <Section title="What people die to">
        <DeathCauses night={night} code={code} />
      </Section>

      <Section title="Is the damage enough?">
        <DamageCheck night={night} code={code} />
      </Section>

      <Players night={night} code={code} />
    </div>
  );
}
