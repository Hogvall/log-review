import type { AbilityTip, Boss } from "./types";
import { VENOMOUS_ABYSS } from "./venomous-abyss";

export type { AbilityTip, Boss } from "./types";

const BOSSES = new Map<number, Boss>(VENOMOUS_ABYSS.map((b) => [b.encounterId, b]));

export function getBoss(encounterId: number): Boss | null {
  return BOSSES.get(encounterId) ?? null;
}

/** Tip for an ability on a boss, matched by name, ignoring case and punctuation differences. */
export function getAbilityTip(encounterId: number, abilityName: string | undefined): AbilityTip | null {
  const boss = BOSSES.get(encounterId);
  if (!boss || !abilityName) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const key = norm(abilityName);
  for (const [name, tip] of Object.entries(boss.tips)) if (norm(name) === key) return tip;
  return null;
}
