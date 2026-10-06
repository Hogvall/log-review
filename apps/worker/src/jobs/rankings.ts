import { rankingMetric, specKey } from "@log-review/analysis";
import { type Db, rankingEntries } from "@log-review/db";
import { type CharacterRanking, type WclQuerier, getCharacterRankings } from "@log-review/wcl";
import { type NewJob, enqueue } from "../queue";
import type { FightJobPayload } from "./fight";

export interface RankingsJobPayload {
  encounterId: number;
  difficulty: number;
  classSlug: string;
  specSlug: string;
  partition: number;
}

/** Average equipped item level, ignoring shirts and tabards (item level 1). */
function averageItemLevel(r: CharacterRanking): number | null {
  const levels = (r.gear ?? []).map((g) => Number(g.itemLevel)).filter((l) => l > 1);
  if (levels.length) return levels.reduce((a, b) => a + b, 0) / levels.length;
  return r.bracketData ?? null;
}

/** Fetches a spec's top players on one boss and queues their fights for download. */
export async function runRankingsJob(db: Db, wcl: WclQuerier, snapshotId: number, p: RankingsJobPayload, topN: number) {
  const spec = specKey(p.classSlug, p.specSlug);
  const rankings = (
    await getCharacterRankings(wcl, {
      encounterId: p.encounterId,
      className: p.classSlug,
      specName: p.specSlug,
      difficulty: p.difficulty,
      metric: rankingMetric(spec),
      partition: p.partition,
      includeCombatantInfo: true,
    })
  ).slice(0, topN);
  if (!rankings.length) return;

  await db
    .insert(rankingEntries)
    .values(
      rankings.map((r, i) => ({
        snapshotId,
        encounterId: p.encounterId,
        difficulty: p.difficulty,
        specKey: spec,
        rank: i + 1,
        name: r.name,
        serverName: r.server?.name ?? null,
        region: r.server?.region ?? null,
        amount: r.amount,
        durationMs: r.duration,
        itemLevel: averageItemLevel(r),
        reportCode: r.report.code,
        fightId: r.report.fightID,
        talents: r.talents ?? null,
        gear: r.gear?.map((g) => ({ id: g.id, itemLevel: Number(g.itemLevel) })) ?? null,
      })),
    )
    .onConflictDoNothing();

  const fightJobs: NewJob[] = rankings.map((r) => {
    // Ranking times are absolute; WCL report queries want times relative to the report start.
    const fightStartTime = r.startTime - r.report.startTime;
    const payload: FightJobPayload = {
      reportCode: r.report.code,
      fightId: r.report.fightID,
      encounterId: p.encounterId,
      difficulty: p.difficulty,
      fightStartTime,
      fightEndTime: fightStartTime + r.duration,
    };
    return {
      snapshotId,
      kind: "fight",
      key: `fight:${snapshotId}:${r.report.code}:${r.report.fightID}`,
      // Mythic before Heroic, and always after every rankings job (priority 0–1).
      priority: p.difficulty === 5 ? 10 : 20,
      payload,
    };
  });
  await enqueue(db, fightJobs);
}
