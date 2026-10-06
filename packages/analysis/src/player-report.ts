import type { Avoidability } from "./benchmark";
import {
  type AbilityDamage,
  type ClassifiedDeath,
  type DamageTakenEvent,
  type DeathRecap,
  type RaidDeath,
  type WipeEvent,
  classifyDeaths,
  damageByAbility,
  deathRecap,
} from "./deaths";

/** Avoidability of boss abilities for this boss and difficulty, from the weekly snapshot. */
export type AvoidabilityMap = Record<string, { classification: Avoidability; zeroShare: number }>;

export interface PlayerDeath extends ClassifiedDeath {
  recap: DeathRecap;
  killingAvoidability: Avoidability | null;
}

export interface AbilityDamageTaken extends AbilityDamage {
  /** Share of this player's total damage taken (0..1). */
  share: number;
  classification: Avoidability | null;
  /** Share of top players that took none of this ability, when known. */
  zeroShare: number | null;
}

export type Severity = "high" | "medium" | "low";

export type Finding =
  | { kind: "death"; severity: Severity; death: PlayerDeath }
  | { kind: "avoidable-damage"; severity: Severity; ability: AbilityDamageTaken };

export interface PlayerReport {
  raidDeaths: ClassifiedDeath[];
  wipe: WipeEvent | null;
  deaths: PlayerDeath[];
  damageTaken: AbilityDamageTaken[];
  totalDamageTaken: number;
  /** Ranked most important first. The UI shows the top three as "Fix these first". */
  findings: Finding[];
  /** False when there's no snapshot data for this boss and difficulty yet. */
  hasAvoidabilityData: boolean;
}

export interface PlayerReportInput {
  playerId: number;
  fightStartTime: number;
  raidSize: number;
  kill: boolean;
  raidDeaths: RaidDeath[];
  /** This player's damage taken, enemy sources only. */
  damageTaken: DamageTakenEvent[];
  avoidability: AvoidabilityMap;
}

const DEATH_SEVERITY: Record<ClassifiedDeath["category"], Severity | null> = {
  early: "high",
  "wipe-start": "high",
  wipe: "low",
  "after-wipe": null,
};

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export function buildPlayerReport(input: PlayerReportInput): PlayerReport {
  const { deaths: raidDeaths, wipe } = classifyDeaths(input.raidDeaths, {
    fightStartTime: input.fightStartTime,
    raidSize: input.raidSize,
    kill: input.kill,
  });
  const lookup = (id: number | undefined) => (id ? (input.avoidability[id] ?? null) : null);

  const deaths: PlayerDeath[] = raidDeaths
    .filter((d) => d.targetID === input.playerId)
    .map((d) => ({
      ...d,
      recap: deathRecap(d, input.damageTaken, input.fightStartTime),
      killingAvoidability: lookup(d.killingAbilityGameID)?.classification ?? null,
    }));

  const byAbility = damageByAbility(input.damageTaken);
  const totalDamageTaken = byAbility.reduce((sum, a) => sum + a.total, 0);
  const damageTaken = byAbility.map((a) => ({
    ...a,
    share: totalDamageTaken ? a.total / totalDamageTaken : 0,
    classification: lookup(a.abilityId)?.classification ?? null,
    zeroShare: lookup(a.abilityId)?.zeroShare ?? null,
  }));

  const findings: Finding[] = [];
  for (const death of deaths) {
    const severity = DEATH_SEVERITY[death.category];
    if (severity) findings.push({ kind: "death", severity, death });
  }
  const killedBy = new Set(deaths.map((d) => d.killingAbilityGameID));
  for (const ability of damageTaken) {
    // An avoidable ability that killed you is already covered by the death finding.
    if (ability.classification !== "avoidable" || killedBy.has(ability.abilityId)) continue;
    const severity: Severity = ability.hits >= 3 || ability.share >= 0.1 ? "medium" : "low";
    findings.push({ kind: "avoidable-damage", severity, ability });
  }
  findings.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (a.kind === "death" && b.kind === "death" ? a.death.timestamp - b.death.timestamp : 0) ||
      (a.kind === "avoidable-damage" && b.kind === "avoidable-damage" ? b.ability.total - a.ability.total : 0) ||
      (a.kind === "death" ? -1 : 1),
  );

  return {
    raidDeaths,
    wipe,
    deaths,
    damageTaken,
    totalDamageTaken,
    findings,
    hasAvoidabilityData: Object.keys(input.avoidability).length > 0,
  };
}
