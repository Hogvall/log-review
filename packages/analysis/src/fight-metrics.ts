import type { SpecKey } from "./specs";

/** Minimal shapes of WCL `table` entries; only the fields we read are typed. */
/**
 * A player entry from the all-players Casts table. Its `abilities` list is cut to the top 5,
 * so we only use it for identity and WCL's active time; cast counts come from events.
 */
export interface CastsTableEntry {
  id: number;
  name: string;
  /** "<Class>-<Spec>", e.g. "Mage-Fire". */
  icon: string;
  activeTime: number;
}

export interface DamageDoneTableEntry {
  id: number;
  total: number;
  targets: { name: string; total: number }[];
}

export interface DeathEvent {
  timestamp: number;
  targetID?: number;
}

/** WCL cast event (dataType Casts). Only `type === "cast"` counts as a cast. */
export interface CastEvent {
  timestamp: number;
  type: string;
  sourceID?: number;
  abilityGameID?: number;
}

/** WCL damage event from the DamageTaken stream, filtered to enemy sources. */
export interface DamageEvent {
  type: string;
  targetID?: number;
  abilityGameID?: number;
  amount?: number;
  absorbed?: number;
}

/** Spec-agnostic numbers for one player in one fight. Rates are per minute or per second. */
export interface PlayerMetrics {
  actorId: number;
  name: string;
  specKey: SpecKey;
  durationMs: number;
  /** Share of the fight spent casting, as computed by WCL (0..1). */
  activeTimePct: number;
  /** Ability ID → casts per minute. */
  cpm: Record<string, number>;
  /** Ability ID → damage taken per second (including absorbed damage). */
  dtps: Record<string, number>;
  /** Ability ID → number of hits taken. */
  hits: Record<string, number>;
  damageTakenPerSec: number;
  /** Target name → share of the player's damage done (0..1). Names because WCL tables don't give target IDs. */
  targetShare: Record<string, number>;
  deaths: number;
  /** Milliseconds from fight start to the player's first death, or null if they survived. */
  firstDeathMs: number | null;
}

export interface FightTables {
  durationMs: number;
  /** Report-relative fight start, to turn death timestamps into fight time. */
  fightStartTime: number;
  players: CastsTableEntry[];
  castEvents: CastEvent[];
  damageTakenEvents: DamageEvent[];
  damageDone: DamageDoneTableEntry[];
  deaths: DeathEvent[];
}

const perMinute = (count: number, durationMs: number) => (count * 60_000) / durationMs;
const perSecond = (amount: number, durationMs: number) => (amount * 1000) / durationMs;

type Counts = Map<number, Map<number, number>>;

function bump(counts: Counts, actor: number, ability: number, by: number) {
  const perActor = counts.get(actor) ?? new Map<number, number>();
  perActor.set(ability, (perActor.get(ability) ?? 0) + by);
  counts.set(actor, perActor);
}

function rates(counts: Map<number, number> | undefined, scale: (n: number) => number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [ability, n] of counts ?? []) out[ability] = scale(n);
  return out;
}

/** Turns one fight's WCL data into metrics for every player in it. */
export function extractFightMetrics(t: FightTables): PlayerMetrics[] {
  const casts: Counts = new Map();
  for (const e of t.castEvents) {
    if (e.type === "cast" && e.sourceID !== undefined && e.abilityGameID) bump(casts, e.sourceID, e.abilityGameID, 1);
  }
  const damage: Counts = new Map();
  const hitCounts: Counts = new Map();
  for (const e of t.damageTakenEvents) {
    if (e.type !== "damage" || e.targetID === undefined || !e.abilityGameID) continue;
    bump(damage, e.targetID, e.abilityGameID, (e.amount ?? 0) + (e.absorbed ?? 0));
    bump(hitCounts, e.targetID, e.abilityGameID, 1);
  }
  const done = new Map(t.damageDone.map((e) => [e.id, e]));

  return t.players.map((c) => {
    const cpm = rates(casts.get(c.id), (n) => perMinute(n, t.durationMs));
    const dtps = rates(damage.get(c.id), (n) => perSecond(n, t.durationMs));
    const hits = rates(hitCounts.get(c.id), (n) => n);

    const dd = done.get(c.id);
    const targetShare: Record<string, number> = {};
    if (dd && dd.total > 0) for (const target of dd.targets) targetShare[target.name] = target.total / dd.total;

    const deaths = t.deaths.filter((d) => d.targetID === c.id).map((d) => d.timestamp - t.fightStartTime);

    return {
      actorId: c.id,
      name: c.name,
      specKey: c.icon,
      durationMs: t.durationMs,
      activeTimePct: Math.min(1, c.activeTime / t.durationMs),
      cpm,
      dtps,
      hits,
      damageTakenPerSec: Object.values(dtps).reduce((a, b) => a + b, 0),
      targetShare,
      deaths: deaths.length,
      firstDeathMs: deaths.length ? Math.min(...deaths) : null,
    };
  });
}

/** Aura ID → uptime share (0..1), from a per-player WCL Buffs table. */
export function buffUptimes(auras: { guid: number; totalUptime: number }[], durationMs: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of auras) out[a.guid] = Math.min(1, a.totalUptime / durationMs);
  return out;
}
