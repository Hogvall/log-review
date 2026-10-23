/**
 * Raid-wide damage taken for raid leaders: which boss abilities hurt the raid, which of that was avoidable,
 * and who takes it, over one pull or a set of pulls.
 */
import type { Avoidability } from "./benchmark";

/** One pull's damage taken from enemies, per player and ability. Small enough to cache per pull. */
export interface PullDamageTaken {
  pullId: number;
  /** playerId → abilityId → hits and damage (absorbed included). */
  byPlayer: Record<string, Record<string, { hits: number; total: number }>>;
}

/** Sums damage-taken events (enemy sources only) per player and ability. */
export function pullDamageTaken(
  pullId: number,
  events: { type: string; targetID?: number; abilityGameID?: number; amount?: number; absorbed?: number }[],
  playerIds: Set<number>,
): PullDamageTaken {
  const byPlayer: PullDamageTaken["byPlayer"] = {};
  for (const e of events) {
    if (e.type !== "damage" || e.targetID == null || !e.abilityGameID || !playerIds.has(e.targetID)) continue;
    const amount = (e.amount ?? 0) + (e.absorbed ?? 0);
    if (amount <= 0) continue;
    const player = (byPlayer[e.targetID] ??= {});
    const a = (player[e.abilityGameID] ??= { hits: 0, total: 0 });
    a.hits++;
    a.total += amount;
  }
  return { pullId, byPlayer };
}

export type AvoidabilityLookup = Record<number, { classification: Avoidability }>;

export interface RaidAbilityDamage {
  abilityId: number;
  /** The tanks' label when tanks took most of it (tank busters), everyone else's otherwise. */
  classification: Avoidability | null;
  total: number;
  hits: number;
  /** The part that was avoidable for whoever took it (tanks judged by the tanks' labels). */
  avoidable: number;
  /** Share of its damage that tanks took. */
  tankShare: number;
  /** Share of all damage the raid took in these pulls. */
  share: number;
  /** Pulls in which anyone took it. */
  pulls: number;
  /** Who took it, most damage first. */
  players: { playerId: number; total: number; hits: number }[];
}

export interface RaidPlayerDamage {
  playerId: number;
  total: number;
  avoidable: number;
  avoidableHits: number;
  /** Pulls this player was in (had any damage taken). */
  pulls: number;
  /** Avoidable damage per pull they were in. */
  avoidablePerPull: number;
}

export interface RaidDamageTaken {
  pulls: number;
  total: number;
  avoidable: number;
  abilities: RaidAbilityDamage[];
  players: RaidPlayerDamage[];
}

/**
 * Adds up damage taken over pulls. Tanks are judged by the tanks' view (boss melee and tank busters are
 * their job), so they look the classification up in `tankAvoidability`.
 */
export function raidDamageTaken(
  pulls: PullDamageTaken[],
  avoidability: AvoidabilityLookup,
  tankAvoidability: AvoidabilityLookup,
  tankIds: Set<number>,
): RaidDamageTaken {
  const abilities = new Map<number, RaidAbilityDamage & { tankTotal: number; pullIds: Set<number>; byPlayer: Map<number, { total: number; hits: number }> }>();
  const players = new Map<number, RaidPlayerDamage & { pullIds: Set<number> }>();
  let total = 0;
  let avoidable = 0;

  for (const pull of pulls) {
    for (const [pid, byAbility] of Object.entries(pull.byPlayer)) {
      const playerId = Number(pid);
      const lookup = tankIds.has(playerId) ? tankAvoidability : avoidability;
      const p = players.get(playerId) ?? { playerId, total: 0, avoidable: 0, avoidableHits: 0, pulls: 0, avoidablePerPull: 0, pullIds: new Set() };
      p.pullIds.add(pull.pullId);
      for (const [aid, d] of Object.entries(byAbility)) {
        const abilityId = Number(aid);
        const a =
          abilities.get(abilityId) ??
          { abilityId, classification: null, total: 0, hits: 0, avoidable: 0, tankShare: 0, tankTotal: 0, share: 0, pulls: 0, players: [], pullIds: new Set(), byPlayer: new Map() };
        a.total += d.total;
        a.hits += d.hits;
        if (tankIds.has(playerId)) a.tankTotal += d.total;
        a.pullIds.add(pull.pullId);
        const ap = a.byPlayer.get(playerId) ?? { total: 0, hits: 0 };
        ap.total += d.total;
        ap.hits += d.hits;
        a.byPlayer.set(playerId, ap);
        abilities.set(abilityId, a);

        total += d.total;
        p.total += d.total;
        if (lookup[abilityId]?.classification === "avoidable") {
          avoidable += d.total;
          a.avoidable += d.total;
          p.avoidable += d.total;
          p.avoidableHits += d.hits;
        }
      }
      players.set(playerId, p);
    }
  }

  return {
    pulls: pulls.length,
    total,
    avoidable,
    abilities: [...abilities.values()]
      .map(({ pullIds, byPlayer, tankTotal, ...a }) => ({
        ...a,
        tankShare: a.total ? tankTotal / a.total : 0,
        classification:
          (a.total && tankTotal / a.total >= 0.5 ? tankAvoidability[a.abilityId] : avoidability[a.abilityId])?.classification ?? null,
        share: total ? a.total / total : 0,
        pulls: pullIds.size,
        players: [...byPlayer].map(([playerId, d]) => ({ playerId, ...d })).sort((x, y) => y.total - x.total),
      }))
      .sort((a, b) => b.total - a.total),
    players: [...players.values()]
      .map(({ pullIds, ...p }) => ({ ...p, pulls: pullIds.size, avoidablePerPull: pullIds.size ? p.avoidable / pullIds.size : 0 }))
      .sort((a, b) => b.avoidable - a.avoidable || b.total - a.total),
  };
}
