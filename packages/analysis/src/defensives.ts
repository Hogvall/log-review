/**
 * Personal defensives by class, matched by spell name (IDs change between patches, names rarely do).
 * Cooldowns are approximate base values; talents often shorten them, so "likely ready" is an estimate.
 * `core`: most players of the class have it, so it's worth mentioning even if they never pressed it.
 */
export interface Defensive {
  name: string;
  cooldownSec: number;
  core?: boolean;
}

export const DEFENSIVES: Record<string, Defensive[]> = {
  DeathKnight: [
    { name: "Icebound Fortitude", cooldownSec: 120, core: true },
    { name: "Anti-Magic Shell", cooldownSec: 60, core: true },
    { name: "Lichborne", cooldownSec: 120 },
    { name: "Death Pact", cooldownSec: 120 },
    { name: "Vampiric Blood", cooldownSec: 90 },
  ],
  DemonHunter: [
    { name: "Blur", cooldownSec: 60, core: true },
    { name: "Netherwalk", cooldownSec: 180 },
    { name: "Fiery Brand", cooldownSec: 60 },
  ],
  Druid: [
    { name: "Barkskin", cooldownSec: 60, core: true },
    { name: "Survival Instincts", cooldownSec: 180 },
    { name: "Frenzied Regeneration", cooldownSec: 36 },
    { name: "Renewal", cooldownSec: 90 },
  ],
  Evoker: [
    { name: "Obsidian Scales", cooldownSec: 90, core: true },
    { name: "Renewing Blaze", cooldownSec: 90 },
  ],
  Hunter: [
    { name: "Aspect of the Turtle", cooldownSec: 180, core: true },
    { name: "Exhilaration", cooldownSec: 120, core: true },
    { name: "Survival of the Fittest", cooldownSec: 90 },
  ],
  Mage: [
    { name: "Ice Block", cooldownSec: 240, core: true },
    { name: "Ice Cold", cooldownSec: 240 },
    { name: "Alter Time", cooldownSec: 60 },
    { name: "Mirror Image", cooldownSec: 120 },
    { name: "Greater Invisibility", cooldownSec: 120 },
  ],
  Monk: [
    { name: "Fortifying Brew", cooldownSec: 120, core: true },
    { name: "Diffuse Magic", cooldownSec: 90 },
    { name: "Dampen Harm", cooldownSec: 120 },
    { name: "Touch of Karma", cooldownSec: 90 },
  ],
  Paladin: [
    { name: "Divine Shield", cooldownSec: 300, core: true },
    { name: "Divine Protection", cooldownSec: 60 },
    { name: "Shield of Vengeance", cooldownSec: 90 },
    { name: "Lay on Hands", cooldownSec: 600 },
    { name: "Ardent Defender", cooldownSec: 120 },
    { name: "Guardian of Ancient Kings", cooldownSec: 180 },
  ],
  Priest: [
    { name: "Desperate Prayer", cooldownSec: 90, core: true },
    { name: "Fade", cooldownSec: 30 },
    { name: "Dispersion", cooldownSec: 120 },
    { name: "Vampiric Embrace", cooldownSec: 120 },
  ],
  Rogue: [
    { name: "Cloak of Shadows", cooldownSec: 120, core: true },
    { name: "Evasion", cooldownSec: 120 },
    { name: "Feint", cooldownSec: 15, core: true },
    { name: "Crimson Vial", cooldownSec: 30, core: true },
  ],
  Shaman: [
    { name: "Astral Shift", cooldownSec: 120, core: true },
    { name: "Stone Bulwark Totem", cooldownSec: 180 },
  ],
  Warlock: [
    { name: "Unending Resolve", cooldownSec: 180, core: true },
    { name: "Dark Pact", cooldownSec: 60 },
  ],
  Warrior: [
    { name: "Die by the Sword", cooldownSec: 120 },
    { name: "Enraged Regeneration", cooldownSec: 120 },
    { name: "Spell Reflection", cooldownSec: 25 },
    { name: "Shield Wall", cooldownSec: 180 },
    { name: "Last Stand", cooldownSec: 180 },
  ],
};

const isHealthstone = (name: string) => /healthstone/i.test(name) && !/^(create|soulburn)/i.test(name);
const isHealthPotion = (name: string) => /heal(ing|th) potion/i.test(name);
const isManaPotion = (name: string) => /mana potion/i.test(name);
/** Not combat potions, even when their name or icon looks like one. */
const NOT_COMBAT_POTION = /(flask|phial|elixir|tonic|cauldron|recycle|create|healthstone)/i;

/**
 * Damage/throughput potions. Names change every expansion and don't always say "potion" (Midnight's is
 * "Light's Potential"), so the icon counts too: potion icons are named like "…lightpotion…" or "inv_potion_…".
 * Some flasks use potion icons, which is why flasks and similar are excluded by name.
 */
export const isCombatPotion = (name: string, icon = "") =>
  /(potion|draught)/i.test(`${name} ${icon}`) && !isHealthPotion(name) && !isManaPotion(name) && !NOT_COMBAT_POTION.test(name);

export interface ConsumableCounts {
  combatPotions: number;
  healthPotions: number;
  manaPotions: number;
  healthstones: number;
}

/**
 * Consumables used over the pull, counted from casts by name and icon. (WCL's playerDetails potion and
 * healthstone counts read 0 for everyone in current logs, so they can't be trusted.)
 */
export function countConsumables(
  casts: [number, number][],
  names: Record<number, string>,
  icons: Record<number, string> = {},
): ConsumableCounts {
  const counts: ConsumableCounts = { combatPotions: 0, healthPotions: 0, manaPotions: 0, healthstones: 0 };
  for (const [, id] of casts) {
    const name = names[id];
    if (!name) continue;
    if (isHealthstone(name)) counts.healthstones++;
    else if (isHealthPotion(name)) counts.healthPotions++;
    else if (isManaPotion(name)) counts.manaPotions++;
    else if (isCombatPotion(name, icons[id])) counts.combatPotions++;
  }
  return counts;
}

export interface DefensiveUse {
  name: string;
  abilityId: number;
  fightTimeMs: number;
}

export interface DefensiveStatus {
  name: string;
  cooldownSec: number;
  /** Uses before this death in the pull. */
  uses: number;
  lastUsedMs: number | null;
  /** Never used, or the base cooldown has passed since the last use. An estimate: talents change cooldowns. */
  likelyReady: boolean;
  /** We know the player has it: they used it this pull, or most top players of their spec do. */
  confirmed: boolean;
}

export interface ConsumableStatus {
  /** Fight time of each use before this death. */
  usesMs: number[];
  /** Used within the window before death. */
  inWindow: boolean;
}

export interface DefensiveReview {
  /** Defensives used in the window before death, oldest first. */
  usedInWindow: (DefensiveUse & { beforeDeathMs: number })[];
  /** Defensives not used in the window, ready-looking first. */
  notUsed: DefensiveStatus[];
  healthstone: ConsumableStatus;
  healthPotion: ConsumableStatus;
}

/**
 * What the player did to survive before a death: defensives and consumables used in the window,
 * and which defensives they likely still had available.
 */
export function reviewDefensives(opts: {
  classSlug: string;
  /** Every cast the player made in the fight: [fightTimeMs, abilityId]. */
  casts: [number, number][];
  /** Self-heal events in the window, to catch healthstones/potions that only show up as heals. */
  windowHeals?: { fightTimeMs: number; abilityId: number }[];
  names: Record<number, string>;
  deathFightTimeMs: number;
  windowMs: number;
  /** Ability names most top players of the spec cast (from the benchmark), to confirm talents. */
  commonForSpec?: Set<string>;
}): DefensiveReview {
  const { casts, names, deathFightTimeMs, windowMs } = opts;
  const before = casts.filter(([t]) => t <= deathFightTimeMs);
  const inWindow = (t: number) => t >= deathFightTimeMs - windowMs;
  const list = DEFENSIVES[opts.classSlug] ?? [];

  const usedInWindow: DefensiveReview["usedInWindow"] = [];
  const notUsed: DefensiveStatus[] = [];
  for (const d of list) {
    const uses = before.filter(([, id]) => names[id] === d.name);
    const inWin = uses.filter(([t]) => inWindow(t));
    for (const [t, id] of inWin) usedInWindow.push({ name: d.name, abilityId: id, fightTimeMs: t, beforeDeathMs: deathFightTimeMs - t });
    if (inWin.length) continue;
    const lastUsedMs = uses.length ? uses.at(-1)![0] : null;
    notUsed.push({
      name: d.name,
      cooldownSec: d.cooldownSec,
      uses: uses.length,
      lastUsedMs,
      likelyReady: lastUsedMs == null || deathFightTimeMs - lastUsedMs >= d.cooldownSec * 1000,
      confirmed: uses.length > 0 || (opts.commonForSpec?.has(d.name) ?? false),
    });
  }
  // Keep defensives we can't confirm only if they're core to the class.
  const shown = notUsed.filter((d) => d.confirmed || list.find((x) => x.name === d.name)?.core);
  shown.sort((a, b) => Number(b.likelyReady) - Number(a.likelyReady) || Number(b.confirmed) - Number(a.confirmed));
  usedInWindow.sort((a, b) => a.fightTimeMs - b.fightTimeMs);

  const consumable = (match: (name: string) => boolean): ConsumableStatus => {
    const times = new Set<number>();
    for (const [t, id] of before) if (names[id] && match(names[id]!)) times.add(t);
    // Heals from the same item within a second are the same use.
    for (const h of opts.windowHeals ?? []) {
      if (names[h.abilityId] && match(names[h.abilityId]!) && ![...times].some((t) => Math.abs(t - h.fightTimeMs) < 1000)) times.add(h.fightTimeMs);
    }
    const usesMs = [...times].sort((a, b) => a - b);
    return { usesMs, inWindow: usesMs.some(inWindow) };
  };

  return {
    usedInWindow,
    notUsed: shown,
    healthstone: consumable(isHealthstone),
    healthPotion: consumable(isHealthPotion),
  };
}

/** Movement spells: casting them more often or earlier doesn't raise damage. */
const MOVEMENT = new Set([
  "Blink", "Shimmer", "Ice Floes", "Displacement",
  "Disengage", "Aspect of the Cheetah",
  "Fel Rush", "Vengeful Retreat", "Glide",
  "Heroic Leap", "Charge", "Intervene",
  "Roll", "Chi Torpedo", "Tiger's Lust", "Transcendence: Transfer",
  "Dash", "Tiger Dash", "Wild Charge", "Stampeding Roar",
  "Sprint", "Shadowstep", "Grappling Hook",
  "Hover", "Soar", "Skyward Ascent", "Surge Forward",
  "Spiritwalker's Grace", "Ghost Wolf", "Gust of Wind",
  "Demonic Circle: Teleport", "Burning Rush",
  "Death's Advance", "Wraith Walk", "Death Grip",
  "Divine Steed",
  "Angelic Feather", "Leap of Faith", "Levitate",
  "Door of Shadows",
]);

/** Raid-wide buffs one player covers for the whole group. */
const RAID_UTILITY = new Set(["Bloodlust", "Heroism", "Time Warp", "Primal Rage", "Fury of the Aspects"]);

/** Defensive barriers that aren't in the death-review list (they're used on cooldown, not saved). */
const BARRIERS = /^(Ice|Blazing|Prismatic|Mass) Barrier$/;

const ALL_DEFENSIVES = new Set(Object.values(DEFENSIVES).flatMap((list) => list.map((d) => d.name)));

export const isRaidUtility = (name: string) => RAID_UTILITY.has(name);

/**
 * Spells that don't raise damage when cast more often or earlier: movement, defensives, raid-wide utility
 * and consumables. They stay in the tables for context but never become DPS findings.
 */
export function isUtilitySpell(name: string, icon = ""): boolean {
  return (
    MOVEMENT.has(name) ||
    ALL_DEFENSIVES.has(name) ||
    BARRIERS.test(name) ||
    RAID_UTILITY.has(name) ||
    isCombatPotion(name, icon) ||
    isHealthstone(name) ||
    isHealthPotion(name) ||
    isManaPotion(name)
  );
}

/**
 * Execute spells: usable mostly while the target is at low health (plus the odd proc), so how often you
 * can cast them depends on how long the boss spends there. A wipe before the execute phase, or a longer
 * fight, says nothing about the rotation.
 */
const EXECUTES: Record<string, ExecuteThreshold> = {
  "Kill Shot": 20,
  Execute: 20,
  Condemn: 20,
  "Shadow Word: Death": 20,
  "Soul Reaper": 35,
  "Touch of Death": 15,
  "Hammer of Wrath": 20,
  "Black Arrow": 20,
};

/** Boss health (%) below which execute spells work. Talents can raise some (e.g. Massacre); these are the base values. */
export const EXECUTE_THRESHOLDS = [15, 20, 35] as const;
export type ExecuteThreshold = (typeof EXECUTE_THRESHOLDS)[number];

export const isExecuteSpell = (name: string) => name in EXECUTES;
export const executeThresholdOf = (name: string): ExecuteThreshold | null => EXECUTES[name] ?? null;

/**
 * AoE fillers: worth casting only with several enemies up, so how often top players cast them depends on
 * the add waves and strategy in their kills, not on the rotation. Spells that are also part of the
 * single-target rotation (Explosive Shot, Blade Dance, …) aren't here.
 */
const AOE_FILLERS = new Set([
  "Multi-Shot",
  "Blizzard", "Flamestrike", "Arcane Explosion", "Cone of Cold",
  "Rain of Fire", "Seed of Corruption", "Implosion",
  "Earthquake", "Chain Lightning",
  "Fan of Knives", "Crimson Tempest", "Shuriken Storm", "Black Powder",
  "Cleave",
  "Divine Storm",
  "Holy Nova",
  "Epidemic",
  "Swipe",
  "Spinning Crane Kick",
  "Pyre",
]);

export const isAoeSpell = (name: string) => AOE_FILLERS.has(name);

/** Below this share of an ability's damage, a target doesn't count toward "hit several enemies". */
const AOE_TARGET_SHARE = 0.15;

/**
 * An ability that spread its damage over 3+ enemies (each taking at least 15% of it) in this pull: an AoE
 * spell even if it isn't in the list. From the player's DamageDone table, so only for spells they cast.
 */
export function hitsSeveralTargets(targets: { total: number }[] | undefined): boolean {
  const total = (targets ?? []).reduce((sum, t) => sum + t.total, 0);
  return total > 0 && (targets ?? []).filter((t) => t.total / total >= AOE_TARGET_SHARE).length >= 3;
}
