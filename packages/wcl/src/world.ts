import type { WclQuerier } from "./client";

export interface Zone {
  id: number;
  name: string;
  encounters: { id: number; name: string }[];
  partitions: { id: number; name: string; default: boolean }[];
}

export async function getZone(client: WclQuerier, id: number): Promise<Zone> {
  const data = await client.query<{ worldData: { zone: Zone | null } }>(
    `query($id: Int!) { worldData { zone(id: $id) { id name encounters { id name } partitions { id name default } } } }`,
    { id },
  );
  if (!data.worldData.zone) throw new Error(`Zone ${id} not found`);
  return data.worldData.zone;
}

/** The partition WCL shows by default, which is the current patch's rankings. */
export function currentPartition(zone: Zone): number {
  const partition = zone.partitions.find((p) => p.default) ?? zone.partitions.at(-1);
  if (!partition) throw new Error(`Zone ${zone.id} has no partitions`);
  return partition.id;
}

export interface WowClass {
  slug: string;
  name: string;
  specs: { slug: string; name: string }[];
}

export async function getClasses(client: WclQuerier): Promise<WowClass[]> {
  const data = await client.query<{ gameData: { classes: WowClass[] } }>(
    `{ gameData { classes { slug name specs { slug name } } } }`,
  );
  return data.gameData.classes;
}

export const Difficulty = { Heroic: 4, Mythic: 5 } as const;

export interface CharacterRanking {
  name: string;
  class: string;
  spec: string;
  amount: number;
  duration: number;
  /** Absolute epoch ms when the fight started. */
  startTime: number;
  report: { code: string; fightID: number; startTime: number };
  server: { name: string; region: string };
  bracketData?: number;
  talents?: { talentID: number; points: number }[];
  gear?: { id: number; itemLevel: string | number; slot?: number }[];
}

export interface CharacterRankingsArgs {
  encounterId: number;
  className: string;
  specName: string;
  difficulty: number;
  metric: "dps" | "hps";
  partition?: number;
  includeCombatantInfo?: boolean;
}

/** One page (up to 100 players, best first) of a spec's rankings on a boss. */
export async function getCharacterRankings(client: WclQuerier, args: CharacterRankingsArgs): Promise<CharacterRanking[]> {
  const data = await client.query<{
    worldData: { encounter: { characterRankings: { rankings: CharacterRanking[] } | null } | null };
  }>(
    `query($id: Int!, $className: String!, $specName: String!, $difficulty: Int!, $metric: CharacterRankingMetricType!, $partition: Int, $combatant: Boolean) {
      worldData { encounter(id: $id) {
        characterRankings(className: $className, specName: $specName, difficulty: $difficulty, metric: $metric, partition: $partition, includeCombatantInfo: $combatant)
      } }
    }`,
    {
      id: args.encounterId,
      className: args.className,
      specName: args.specName,
      difficulty: args.difficulty,
      metric: args.metric,
      partition: args.partition,
      combatant: args.includeCombatantInfo ?? false,
    },
  );
  return data.worldData.encounter?.characterRankings?.rankings ?? [];
}

export type TableDataType = "Casts" | "Buffs" | "DamageTaken" | "DamageDone" | "Healing" | "Deaths";

/** WCL filter expression that keeps only damage dealt by enemies (drops players' self-damage). */
export const ENEMY_SOURCES = 'source.disposition = "enemy"';

/**
 * A WCL summary table for one fight. Without `sourceID` it covers every player in one query;
 * the shape depends on the data type, so callers type the result.
 */
export async function getFightTable<T>(
  client: WclQuerier,
  code: string,
  fightId: number,
  dataType: TableDataType,
  opts: { sourceID?: number; filterExpression?: string } = {},
): Promise<T> {
  const data = await client.query<{ reportData: { report: { table: { data: T } } } }>(
    `query($code: String!, $fightIDs: [Int]!, $dataType: TableDataType!, $sourceID: Int, $filter: String) {
      reportData { report(code: $code) { table(fightIDs: $fightIDs, dataType: $dataType, sourceID: $sourceID, filterExpression: $filter) } }
    }`,
    { code, fightIDs: [fightId], dataType, sourceID: opts.sourceID, filter: opts.filterExpression },
  );
  return data.reportData.report.table.data;
}

/** A WCL summary table over several fights at once (e.g. a whole night of pulls). Deaths tables stop at 200 entries. */
export async function getTableForFights<T>(client: WclQuerier, code: string, fightIds: number[], dataType: TableDataType): Promise<T> {
  const data = await client.query<{ reportData: { report: { table: { data: T } } } }>(
    `query($code: String!, $fightIDs: [Int]!, $dataType: TableDataType!) {
      reportData { report(code: $code) { table(fightIDs: $fightIDs, dataType: $dataType) } }
    }`,
    { code, fightIDs: fightIds, dataType },
  );
  return data.reportData.report.table.data;
}
