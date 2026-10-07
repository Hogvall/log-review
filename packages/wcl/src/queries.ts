import type { WclQuerier } from "./client";

export interface Fight {
  id: number;
  encounterID: number;
  name: string;
  difficulty: number | null;
  kill: boolean | null;
  /** Boss health percentage remaining when the pull ended (0 on kills). */
  bossPercentage: number | null;
  /** Report-relative timestamps in milliseconds. */
  startTime: number;
  endTime: number;
  friendlyPlayers: number[] | null;
  /** Boss phase changes, report-relative. A phase can repeat (e.g. alternating stage and intermission). */
  phaseTransitions: { id: number; startTime: number }[] | null;
}

export interface EncounterPhases {
  encounterID: number;
  phases: { id: number; name: string; isIntermission: boolean | null }[];
}

export interface PlayerActor {
  id: number;
  name: string;
  server: string | null;
  /** Class name, e.g. "Mage". */
  subType: string;
}

export interface Ability {
  gameID: number;
  name: string;
  icon: string;
}

export interface ReportOverview {
  code: string;
  title: string;
  zone: { id: number; name: string } | null;
  fights: Fight[];
  players: PlayerActor[];
  abilities: Ability[];
  /** Phase names per boss, for reading `phaseTransitions`. */
  phases: EncounterPhases[];
}

const REPORT_OVERVIEW = /* GraphQL */ `
  query ReportOverview($code: String!) {
    reportData {
      report(code: $code) {
        code
        title
        zone { id name }
        fights(killType: Encounters) {
          id encounterID name difficulty kill bossPercentage startTime endTime friendlyPlayers
          phaseTransitions { id startTime }
        }
        phases { encounterID phases { id name isIntermission } }
        masterData {
          actors(type: "Player") { id name server subType }
          abilities { gameID name icon }
        }
      }
    }
  }
`;

/** Fetches the fights, players and ability names for a report. Boss pulls only (no trash). */
export async function getReportOverview(client: WclQuerier, code: string): Promise<ReportOverview> {
  const data = await client.query<{
    reportData: {
      report: {
        code: string;
        title: string;
        zone: ReportOverview["zone"];
        fights: Fight[];
        masterData: { actors: PlayerActor[]; abilities: Ability[] };
        phases: EncounterPhases[] | null;
      } | null;
    };
  }>(REPORT_OVERVIEW, { code });

  const report = data.reportData.report;
  if (!report) throw new Error(`Report ${code} not found`);
  return {
    code: report.code,
    title: report.title,
    zone: report.zone,
    fights: report.fights,
    players: report.masterData.actors,
    abilities: report.masterData.abilities,
    phases: report.phases ?? [],
  };
}

/**
 * A raw WCL event. Fields vary by event type, so only the common ones are typed.
 * With includeResources, damage and heal events also carry the target's hitPoints/maxHitPoints after the event.
 */
export interface WclEvent {
  timestamp: number;
  type: string;
  sourceID?: number;
  targetID?: number;
  abilityGameID?: number;
  fight: number;
  [key: string]: unknown;
}

export type EventDataType = "Deaths" | "DamageTaken" | "Casts" | "Buffs" | "Debuffs" | "Healing" | "DamageDone";

const EVENTS = /* GraphQL */ `
  query Events($code: String!, $fightIDs: [Int]!, $dataType: EventDataType!, $startTime: Float!, $endTime: Float!, $sourceID: Int, $targetID: Int, $filter: String, $resources: Boolean) {
    reportData {
      report(code: $code) {
        events(fightIDs: $fightIDs, dataType: $dataType, startTime: $startTime, endTime: $endTime, sourceID: $sourceID, targetID: $targetID, filterExpression: $filter, includeResources: $resources, limit: 10000) {
          data
          nextPageTimestamp
        }
      }
    }
  }
`;

/** Fetches all events of one type for a fight, following WCL's pagination. */
export async function getFightEvents(
  client: WclQuerier,
  code: string,
  fight: Pick<Fight, "id" | "startTime" | "endTime">,
  dataType: EventDataType,
  opts: { sourceID?: number; targetID?: number; filterExpression?: string; includeResources?: boolean } = {},
): Promise<WclEvent[]> {
  const events: WclEvent[] = [];
  let startTime: number | null = fight.startTime;
  while (startTime !== null) {
    const data: {
      reportData: { report: { events: { data: WclEvent[]; nextPageTimestamp: number | null } } };
    } = await client.query(EVENTS, {
      code,
      fightIDs: [fight.id],
      dataType,
      startTime,
      endTime: fight.endTime,
      sourceID: opts.sourceID,
      targetID: opts.targetID,
      filter: opts.filterExpression,
      resources: opts.includeResources,
    });
    const page = data.reportData.report.events;
    events.push(...page.data);
    startTime = page.nextPageTimestamp;
  }
  return events;
}

const RATE_LIMIT = /* GraphQL */ `
  query { rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn } }
`;

export interface RateLimit {
  limitPerHour: number;
  pointsSpentThisHour: number;
  /** Seconds until the budget resets. */
  pointsResetIn: number;
}

export async function getRateLimit(client: WclQuerier): Promise<RateLimit> {
  const data = await client.query<{ rateLimitData: RateLimit }>(RATE_LIMIT);
  return data.rateLimitData;
}

export interface PlayerDetail {
  id: number;
  name: string;
  /** Class slug, e.g. "DeathKnight". */
  type: string;
  /** "<Class>-<Spec>", e.g. "DeathKnight-Blood". */
  icon: string;
  minItemLevel?: number;
  maxItemLevel?: number;
}

export interface PlayerDetails {
  tanks: PlayerDetail[];
  healers: PlayerDetail[];
  dps: PlayerDetail[];
}

/** Players in a fight grouped by role, with their spec. */
export async function getPlayerDetails(client: WclQuerier, code: string, fightId: number): Promise<PlayerDetails> {
  const data = await client.query<{
    reportData: { report: { playerDetails: { data: { playerDetails: Partial<PlayerDetails> } } } };
  }>(`query($code: String!, $fightIDs: [Int]!) { reportData { report(code: $code) { playerDetails(fightIDs: $fightIDs) } } }`, {
    code,
    fightIDs: [fightId],
  });
  const details = data.reportData.report.playerDetails.data.playerDetails;
  return { tanks: details.tanks ?? [], healers: details.healers ?? [], dps: details.dps ?? [] };
}

export interface FightMeta {
  /** Report-relative fight start. */
  startTime: number;
  phaseTransitions: { id: number; startTime: number }[] | null;
  /** Phase names for this fight's boss. */
  phases: EncounterPhases["phases"];
  /** Every ability in the report, for names (cast events only carry IDs). */
  abilities: Ability[];
  /** Each enemy's health over the fight (for execute windows). */
  health: HealthGraphSeries[];
}

/** One enemy's health from WCL's Resources graph: [report time, health %] points. */
export interface HealthGraphSeries {
  name?: string;
  /** "Boss" or "NPC". */
  type?: string;
  data?: [number, number][];
}

/** Health over time of every enemy in a fight: Resources graph, ability 1000 = hit points. */
const HEALTH_GRAPH = `graph(fightIDs: $fightIDs, dataType: Resources, hostilityType: Enemies, abilityID: 1000)`;

/** Health over a fight for every enemy, from WCL's Resources graph (1 query). */
export async function getHealthGraph(client: WclQuerier, code: string, fightId: number): Promise<HealthGraphSeries[]> {
  const data = await client.query<{ reportData: { report: { graph: { data?: { series?: HealthGraphSeries[] } } } | null } }>(
    `query($code: String!, $fightIDs: [Int]!) { reportData { report(code: $code) { ${HEALTH_GRAPH} } } }`,
    { code, fightIDs: [fightId] },
  );
  return data.reportData.report?.graph.data?.series ?? [];
}

/** One fight's phase timings, enemy health and the report's ability names, in one query. */
export async function getFightMeta(client: WclQuerier, code: string, fightId: number): Promise<FightMeta | null> {
  const data = await client.query<{
    reportData: {
      report: {
        fights: { encounterID: number; startTime: number; phaseTransitions: FightMeta["phaseTransitions"] }[];
        phases: EncounterPhases[] | null;
        masterData: { abilities: Ability[] };
        graph: { data?: { series?: HealthGraphSeries[] } };
      } | null;
    };
  }>(
    `query($code: String!, $fightIDs: [Int]!) { reportData { report(code: $code) {
      ${HEALTH_GRAPH}
      fights(fightIDs: $fightIDs) { encounterID startTime phaseTransitions { id startTime } }
      phases { encounterID phases { id name isIntermission } }
      masterData { abilities { gameID name icon } }
    } } }`,
    { code, fightIDs: [fightId] },
  );
  const report = data.reportData.report;
  const fight = report?.fights[0];
  if (!report || !fight) return null;
  return {
    startTime: fight.startTime,
    phaseTransitions: fight.phaseTransitions,
    phases: report.phases?.find((p) => p.encounterID === fight.encounterID)?.phases ?? [],
    abilities: report.masterData.abilities,
    health: report.graph.data?.series ?? [],
  };
}
