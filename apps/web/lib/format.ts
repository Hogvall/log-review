export function fightTime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function compact(n: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function percent(share: number, digits = 0): string {
  return `${(share * 100).toFixed(digits)}%`;
}

export function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

const DIFFICULTIES: Record<number, string> = { 1: "LFR", 3: "Normal", 4: "Heroic", 5: "Mythic" };
export const difficultyName = (d: number | null) => (d ? (DIFFICULTIES[d] ?? `Difficulty ${d}`) : "");

/** Standard in-game class colors. */
const CLASS_COLORS: Record<string, string> = {
  DeathKnight: "#C41E3A",
  DemonHunter: "#A330C9",
  Druid: "#FF7C0A",
  Evoker: "#33937F",
  Hunter: "#AAD372",
  Mage: "#3FC7EB",
  Monk: "#00FF98",
  Paladin: "#F48CBA",
  Priest: "#FFFFFF",
  Rogue: "#FFF468",
  Shaman: "#0070DD",
  Warlock: "#8788EE",
  Warrior: "#C69B6D",
};
export const classColor = (classSlug: string) => CLASS_COLORS[classSlug] ?? "#cbd5e1";

/** "DeathKnight-Blood" → "Blood Death Knight". */
export function specLabel(specKey: string | null, classSlug: string): string {
  const spaced = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2");
  const spec = specKey?.split("-")[1];
  return spec ? `${spaced(spec)} ${spaced(classSlug)}` : spaced(classSlug);
}

export const abilityIconUrl = (icon: string) => `https://assets.rpglogs.com/img/warcraft/abilities/${icon}`;
export const wowheadSpellUrl = (id: number) => `https://www.wowhead.com/spell=${id}`;

/** Fight time with tenths, e.g. "4:13.7". */
export function fightTimePrecise(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
}

/** Time before death, e.g. "−2.2s". */
export const beforeDeath = (ms: number) => `−${(ms / 1000).toFixed(1)}s`;
