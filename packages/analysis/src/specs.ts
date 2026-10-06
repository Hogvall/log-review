/** Spec keys are "<ClassSlug>-<SpecSlug>", matching WCL's actor icons, e.g. "DeathKnight-Blood". */
export type SpecKey = string;
export type Role = "tank" | "healer" | "dps";

const TANKS = new Set([
  "DeathKnight-Blood",
  "DemonHunter-Vengeance",
  "Druid-Guardian",
  "Monk-Brewmaster",
  "Paladin-Protection",
  "Warrior-Protection",
]);

const HEALERS = new Set([
  "Druid-Restoration",
  "Evoker-Preservation",
  "Monk-Mistweaver",
  "Paladin-Holy",
  "Priest-Discipline",
  "Priest-Holy",
  "Shaman-Restoration",
]);

export function specKey(classSlug: string, specSlug: string): SpecKey {
  return `${classSlug}-${specSlug}`;
}

export function roleOf(spec: SpecKey): Role {
  if (TANKS.has(spec)) return "tank";
  if (HEALERS.has(spec)) return "healer";
  return "dps";
}

/** The WCL ranking metric used to pick a spec's top players. */
export function rankingMetric(spec: SpecKey): "dps" | "hps" {
  return roleOf(spec) === "healer" ? "hps" : "dps";
}
