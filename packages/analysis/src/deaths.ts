/** A WCL death event (dataType Deaths). */
export interface RaidDeath {
  timestamp: number;
  targetID?: number;
  killingAbilityGameID?: number;
  killerID?: number;
}

/**
 * - early: died before any raid wipe. These are the deaths that matter most.
 * - wipe-start: among the first deaths of the raid wipe, so possibly what set it off.
 * - wipe: died in the middle of the raid wipe. Usually not this player's fault.
 * - after-wipe: died after the wipe was already over (e.g. while running back or soloing). Ignored.
 */
export type DeathCategory = "early" | "wipe-start" | "wipe" | "after-wipe";

export interface ClassifiedDeath extends RaidDeath {
  /** 1-based position among all raid deaths in the pull. */
  order: number;
  fightTimeMs: number;
  category: DeathCategory;
}

export interface WipeEvent {
  startMs: number;
  endMs: number;
  deaths: number;
}

export interface DeathOptions {
  fightStartTime: number;
  raidSize: number;
  /** Kills have no wipe; every death is treated as "early". */
  kill: boolean;
  /** A wipe is at least this share of the raid (and at least 3 players) dying within `windowMs`. */
  minShare?: number;
  windowMs?: number;
  /** Deaths keep belonging to the wipe while each follows the previous within this gap. */
  chainGapMs?: number;
}

/** Groups a pull's deaths into early deaths, the raid wipe, and deaths after it. */
export function classifyDeaths(
  deaths: RaidDeath[],
  opts: DeathOptions,
): { deaths: ClassifiedDeath[]; wipe: WipeEvent | null } {
  const { fightStartTime, raidSize, kill, minShare = 0.25, windowMs = 5_000, chainGapMs = 2_000 } = opts;
  const sorted = [...deaths].sort((a, b) => a.timestamp - b.timestamp);
  const threshold = Math.max(3, Math.ceil(raidSize * minShare));

  let start = -1;
  if (!kill) {
    start = sorted.findIndex((d, i) => {
      let n = 0;
      for (let j = i; j < sorted.length && sorted[j]!.timestamp - d.timestamp <= windowMs; j++) n++;
      return n >= threshold;
    });
  }

  let end = start;
  if (start >= 0) {
    // Everything inside the window, then anyone dying in quick succession after it.
    while (end + 1 < sorted.length && sorted[end + 1]!.timestamp - sorted[start]!.timestamp <= windowMs) end++;
    while (end + 1 < sorted.length && sorted[end + 1]!.timestamp - sorted[end]!.timestamp <= chainGapMs) end++;
  }
  // The first two deaths of the wipe, plus anyone dying at the same moment as the second.
  const startCutoff = start >= 0 ? sorted[Math.min(start + 1, end)]!.timestamp : -1;

  const classified = sorted.map((d, i): ClassifiedDeath => {
    let category: DeathCategory = "early";
    if (start >= 0 && i >= start) {
      if (i > end) category = "after-wipe";
      else category = d.timestamp <= startCutoff ? "wipe-start" : "wipe";
    }
    return { ...d, order: i + 1, fightTimeMs: d.timestamp - fightStartTime, category };
  });

  const wipe =
    start >= 0
      ? {
          startMs: sorted[start]!.timestamp - fightStartTime,
          endMs: sorted[end]!.timestamp - fightStartTime,
          deaths: end - start + 1,
        }
      : null;
  return { deaths: classified, wipe };
}

/** A damage event from one player's DamageTaken stream. */
export interface DamageTakenEvent {
  timestamp: number;
  type: string;
  abilityGameID?: number;
  amount?: number;
  absorbed?: number;
}

export interface AbilityDamage {
  abilityId: number;
  total: number;
  hits: number;
}

/**
 * Sums damage per ability, largest first. Absorbed damage counts: it's still damage you took, and a hit a
 * shield soaked was still a hit. Hits that did nothing (immunities, misses) don't count at all: an
 * immunity used on a mechanic dealt with it.
 */
export function damageByAbility(events: DamageTakenEvent[]): AbilityDamage[] {
  const byAbility = new Map<number, AbilityDamage>();
  for (const e of events) {
    const amount = (e.amount ?? 0) + (e.absorbed ?? 0);
    if (e.type !== "damage" || !e.abilityGameID || amount <= 0) continue;
    const entry = byAbility.get(e.abilityGameID) ?? { abilityId: e.abilityGameID, total: 0, hits: 0 };
    entry.total += amount;
    entry.hits++;
    byAbility.set(e.abilityGameID, entry);
  }
  return [...byAbility.values()].sort((a, b) => b.total - a.total);
}

export interface DeathRecap {
  windowMs: number;
  /** Damage taken in the window before death, by ability. */
  abilities: AbilityDamage[];
  total: number;
  /** The last few hits, oldest first, in fight time. */
  lastHits: { fightTimeMs: number; abilityId: number; amount: number }[];
}

/** What hit a player in the seconds before they died. */
export function deathRecap(
  death: { timestamp: number },
  damageTaken: DamageTakenEvent[],
  fightStartTime: number,
  windowMs = 10_000,
): DeathRecap {
  const window = damageTaken.filter(
    (e) => e.type === "damage" && e.timestamp <= death.timestamp && e.timestamp >= death.timestamp - windowMs,
  );
  const abilities = damageByAbility(window);
  return {
    windowMs,
    abilities,
    total: abilities.reduce((sum, a) => sum + a.total, 0),
    lastHits: window
      .filter((e) => e.abilityGameID)
      .slice(-5)
      .map((e) => ({
        fightTimeMs: e.timestamp - fightStartTime,
        abilityId: e.abilityGameID!,
        amount: (e.amount ?? 0) + (e.absorbed ?? 0),
      })),
  };
}
