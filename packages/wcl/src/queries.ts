import type { WclClient } from "./client";

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
        }
        masterData {
          actors(type: "Player") { id name server subType }
          abilities { gameID name icon }
        }
      }
    }
  }
`;

/** Fetches the fights, players and ability names for a report. Boss pulls only (no trash). */
export async function getReportOverview(client: WclClient, code: string): Promise<ReportOverview> {
  const data = await client.query<{
    reportData: {
      report: {
        code: string;
        title: string;
        zone: ReportOverview["zone"];
        fights: Fight[];
        masterData: { actors: PlayerActor[]; abilities: Ability[] };
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
  };
}

/** A raw WCL event. Fields vary by event type, so only the common ones are typed. */
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
  query Events($code: String!, $fightIDs: [Int]!, $dataType: EventDataType!, $startTime: Float!, $endTime: Float!, $sourceID: Int) {
    reportData {
      report(code: $code) {
        events(fightIDs: $fightIDs, dataType: $dataType, startTime: $startTime, endTime: $endTime, sourceID: $sourceID, limit: 10000) {
          data
          nextPageTimestamp
        }
      }
    }
  }
`;

/** Fetches all events of one type for a fight, following WCL's pagination. */
export async function getFightEvents(
  client: WclClient,
  code: string,
  fight: Pick<Fight, "id" | "startTime" | "endTime">,
  dataType: EventDataType,
  opts: { sourceID?: number } = {},
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

export async function getRateLimit(client: WclClient): Promise<RateLimit> {
  const data = await client.query<{ rateLimitData: RateLimit }>(RATE_LIMIT);
  return data.rateLimitData;
}
