import { ErrorPanel, NotFoundPanel } from "@/components/error-panel";
import { type PickerPlayer, PlayerPicker } from "@/components/player-picker";
import { Breadcrumbs } from "@/components/ui";
import { getFight, getPlayers } from "@/lib/data";
import { difficultyName, fightTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function FightPage({ params }: { params: Promise<{ code: string; fight: string }> }) {
  const { code, fight: fightParam } = await params;
  const fightId = Number(fightParam);

  let found, details;
  try {
    found = await getFight(code, fightId);
    if (!found) return <NotFoundPanel what="Pull" />;
    details = await getPlayers(code, fightId);
  } catch (error) {
    return <ErrorPanel error={error} />;
  }
  const { report, fight } = found;
  const pull = report.fights.filter((f) => f.encounterID === fight.encounterID && f.difficulty === fight.difficulty && f.id <= fight.id).length;

  const toPicker = (list: typeof details.dps): PickerPlayer[] =>
    list.map((p) => ({ id: p.id, name: p.name, classSlug: p.type, specKey: p.icon })).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-5">
      <div>
        <Breadcrumbs
          items={[
            { label: "Home", href: "/" },
            { label: report.title, href: `/r/${code}?view=personal` },
            { label: `${fight.name} pull ${pull}` },
          ]}
        />
        <h1 className="text-2xl font-semibold text-fg">
          {fight.name} <span className="text-muted">{difficultyName(fight.difficulty)}</span>
        </h1>
        <p className="text-sm text-muted">
          pull {pull} · {fight.kill ? <span className="text-heal">kill</span> : <span className="text-warn">wipe {fight.bossPercentage?.toFixed(1)}%</span>} ·{" "}
          <span className="num">{fightTime(fight.endTime - fight.startTime)}</span>
        </p>
      </div>
      <PlayerPicker
        baseHref={`/r/${code}/${fightId}`}
        groups={[
          { label: "Tanks", players: toPicker(details.tanks) },
          { label: "Healers", players: toPicker(details.healers) },
          { label: "Damage", players: toPicker(details.dps) },
        ]}
      />
    </div>
  );
}
