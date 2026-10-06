import type { AbilityDamage } from "./deaths";

/** A damage or heal event fetched with includeResources, so it carries the player's health afterwards. */
export interface HpEvent {
  timestamp: number;
  type: string;
  sourceID?: number;
  abilityGameID?: number;
  amount?: number;
  absorbed?: number;
  overkill?: number;
  hitPoints?: number;
  maxHitPoints?: number;
}

export type StoryEntry =
  | {
      kind: "damage";
      fightTimeMs: number;
      beforeDeathMs: number;
      abilityId: number;
      /** Damage including what shields absorbed. */
      amount: number;
      hpAfter: number | null;
      /** A single hit worth at least `bigHitShare` of max health. */
      big: boolean;
      killingBlow: boolean;
      /** Part of the final drop from healthy to dead. */
      inBurst: boolean;
    }
  | {
      kind: "healing";
      fightTimeMs: number;
      beforeDeathMs: number;
      amount: number;
      /** Heals merged into this row (everything between two hits). */
      count: number;
      /** When the last heal in this row landed; health after the row is as of this moment. */
      endBeforeDeathMs: number;
      hpAfter: number | null;
      inBurst: boolean;
    };

export interface DeathStory {
  windowMs: number;
  maxHp: number | null;
  entries: StoryEntry[];
  /** The final drop: from the last moment you were healthy until death. */
  burst: {
    beforeDeathMs: number;
    /** Health when the drop started, or null if you were never healthy in the window. */
    startHp: number | null;
    damage: AbilityDamage[];
    totalDamage: number;
    healing: number;
  };
  /** You were below the healthy threshold for the whole window: the problem started earlier. */
  lowWholeWindow: boolean;
  killingBlow: { abilityId: number; amount: number; shareOfBurst: number } | null;
  /** Abilities that kept hitting you through the window (e.g. a stacking DoT). */
  repeated: { abilityId: number; hits: number }[];
}

export interface StoryOptions {
  windowMs?: number;
  /** Health share counted as "healthy"; the burst starts after the last time you were at or above it. */
  healthyHp?: number;
  bigHitShare?: number;
  repeatedHits?: number;
}

const hpOf = (e: HpEvent) => (e.maxHitPoints ? (e.hitPoints ?? 0) / e.maxHitPoints : null);

/** Turns the seconds before a death into a readable story: when it went wrong and what did it. */
export function buildDeathStory(
  death: { timestamp: number; killingAbilityGameID?: number },
  damage: HpEvent[],
  heals: HpEvent[],
  fightStartTime: number,
  { windowMs = 15_000, healthyHp = 0.75, bigHitShare = 0.2, repeatedHits = 4 }: StoryOptions = {},
): DeathStory {
  const inWindow = (e: HpEvent) => e.timestamp <= death.timestamp && e.timestamp >= death.timestamp - windowMs;
  const events = [
    ...damage.filter((e) => e.type === "damage" && e.abilityGameID && inWindow(e)),
    ...heals.filter((e) => e.type === "heal" && (e.amount ?? 0) > 0 && inWindow(e)),
  ].sort((a, b) => a.timestamp - b.timestamp);
  const maxHp = events.find((e) => e.maxHitPoints)?.maxHitPoints ?? null;
  const lastDamage = events.findLast((e) => e.type === "damage");

  const entries: StoryEntry[] = [];
  for (const e of events) {
    const base = { fightTimeMs: e.timestamp - fightStartTime, beforeDeathMs: death.timestamp - e.timestamp, inBurst: false };
    const hpAfter = hpOf(e);
    if (e.type === "heal") {
      const prev = entries.at(-1);
      if (prev?.kind === "healing") {
        prev.amount += e.amount ?? 0;
        prev.count++;
        prev.hpAfter = hpAfter ?? prev.hpAfter;
        prev.endBeforeDeathMs = base.beforeDeathMs;
      } else entries.push({ kind: "healing", ...base, amount: e.amount ?? 0, count: 1, hpAfter, endBeforeDeathMs: base.beforeDeathMs });
      continue;
    }
    const amount = (e.amount ?? 0) + (e.absorbed ?? 0);
    entries.push({
      kind: "damage",
      ...base,
      abilityId: e.abilityGameID!,
      amount,
      hpAfter,
      big: maxHp ? amount >= maxHp * bigHitShare : false,
      killingBlow: e === lastDamage,
    });
  }

  // The burst starts right after the last moment you were healthy.
  const lastHealthy = entries.findLastIndex((e) => e.hpAfter != null && e.hpAfter >= healthyHp);
  const hasHp = entries.some((e) => e.hpAfter != null);
  for (let i = lastHealthy + 1; i < entries.length; i++) entries[i]!.inBurst = true;

  const healthyEntry = entries[lastHealthy];
  const burstEntries = entries.slice(lastHealthy + 1);
  const byAbility = new Map<number, AbilityDamage>();
  let healing = 0;
  for (const e of burstEntries) {
    if (e.kind === "healing") {
      healing += e.amount;
      continue;
    }
    const a = byAbility.get(e.abilityId) ?? { abilityId: e.abilityId, total: 0, hits: 0 };
    a.total += e.amount;
    a.hits++;
    byAbility.set(e.abilityId, a);
  }
  const burstDamage = [...byAbility.values()].sort((a, b) => b.total - a.total);
  const totalDamage = burstDamage.reduce((sum, a) => sum + a.total, 0);

  const hits = new Map<number, number>();
  for (const e of entries) if (e.kind === "damage") hits.set(e.abilityId, (hits.get(e.abilityId) ?? 0) + 1);

  const killing = entries.findLast((e) => e.kind === "damage" && e.killingBlow);
  return {
    windowMs,
    maxHp,
    entries,
    burst: {
      beforeDeathMs: !healthyEntry
        ? windowMs
        : healthyEntry.kind === "healing"
          ? healthyEntry.endBeforeDeathMs
          : healthyEntry.beforeDeathMs,
      startHp: healthyEntry?.hpAfter ?? null,
      damage: burstDamage,
      totalDamage,
      healing,
    },
    lowWholeWindow: hasHp && lastHealthy < 0,
    killingBlow:
      killing?.kind === "damage"
        ? { abilityId: killing.abilityId, amount: killing.amount, shareOfBurst: totalDamage ? killing.amount / totalDamage : 1 }
        : null,
    repeated: [...hits]
      .filter(([, n]) => n >= repeatedHits)
      .map(([abilityId, n]) => ({ abilityId, hits: n }))
      .sort((a, b) => b.hits - a.hits),
  };
}
