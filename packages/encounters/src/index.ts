import type { AbilityTip, Boss } from "./types";
import { VENOMOUS_ABYSS } from "./venomous-abyss";

export type { AbilityTip, Boss } from "./types";

const BOSSES = new Map<number, Boss>(VENOMOUS_ABYSS.map((b) => [b.encounterId, b]));

export function getBoss(encounterId: number): Boss | null {
  return BOSSES.get(encounterId) ?? null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** True when the boss notes list this ability as aimed at chosen players. Matched like getAbilityTip. */
export function isTargetedAbility(encounterId: number, abilityName: string | undefined): boolean {
  const targeted = BOSSES.get(encounterId)?.targeted;
  if (!targeted || !abilityName) return false;
  const key = norm(abilityName);
  return targeted.some((name) => norm(name) === key);
}

/** Tip for an ability on a boss, matched by name, ignoring case and punctuation differences. */
export function getAbilityTip(encounterId: number, abilityName: string | undefined): AbilityTip | null {
  const boss = BOSSES.get(encounterId);
  if (!boss || !abilityName) return null;
  const key = norm(abilityName);
  for (const [name, tip] of Object.entries(boss.tips)) if (norm(name) === key) return tip;
  return null;
}
