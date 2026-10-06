import { describe, expect, it } from "vitest";
import { countConsumables, reviewDefensives } from "./index";

const names: Record<number, string> = { 1: "Ice Block", 2: "Mirror Image", 3: "Fireball", 4: "Healthstone", 5: "Silvermoon Health Potion", 6: "Alter Time", 7: "Create Healthstone" };

describe("reviewDefensives", () => {
  const review = reviewDefensives({
    classSlug: "Mage",
    casts: [
      [10_000, 2], // Mirror Image early
      [50_000, 3],
      [95_000, 6], // Alter Time 5s before death
      [100_000, 7], // not a real healthstone use
      [120_000, 1], // after death: ignored
    ],
    windowHeals: [{ fightTimeMs: 97_000, abilityId: 5 }],
    names,
    deathFightTimeMs: 100_000,
    windowMs: 15_000,
  });

  it("lists defensives used in the window", () => {
    expect(review.usedInWindow.map((u) => u.name)).toEqual(["Alter Time"]);
    expect(review.usedInWindow[0]!.beforeDeathMs).toBe(5_000);
  });

  it("flags core defensives never pressed as ready, and estimates cooldowns of used ones", () => {
    const iceBlock = review.notUsed.find((d) => d.name === "Ice Block")!;
    expect(iceBlock).toMatchObject({ uses: 0, likelyReady: true, confirmed: false });
    const mirror = review.notUsed.find((d) => d.name === "Mirror Image")!;
    // Used 90s before death, 120s cooldown: probably not back yet.
    expect(mirror).toMatchObject({ uses: 1, likelyReady: false, confirmed: true });
    expect(review.notUsed[0]!.likelyReady).toBe(true);
  });

  it("hides talent-only defensives the player never showed having", () => {
    expect(review.notUsed.some((d) => d.name === "Greater Invisibility")).toBe(false);
  });

  it("confirms talents from what top players of the spec use", () => {
    const r = reviewDefensives({ classSlug: "Mage", casts: [], names, deathFightTimeMs: 100_000, windowMs: 15_000, commonForSpec: new Set(["Greater Invisibility"]) });
    expect(r.notUsed.find((d) => d.name === "Greater Invisibility")?.confirmed).toBe(true);
  });

  it("tracks healthstones and health potions, ignoring Create Healthstone", () => {
    expect(review.healthstone).toEqual({ usesMs: [], inWindow: false });
    expect(review.healthPotion).toEqual({ usesMs: [97_000], inWindow: true });
  });
});

describe("countConsumables", () => {
  it("sorts real potion and healthstone names into kinds", () => {
    const names: Record<number, string> = {
      1: "Potion of Recklessness",
      2: "Draught of Rampant Abandon",
      3: "Silvermoon Health Potion",
      4: "Concentrated Silvermoon Health Potion",
      5: "Lightfused Mana Potion",
      6: "Healthstone",
      7: "Demonic Healthstone",
      8: "Create Healthstone",
      9: "Recycle Potions",
      10: "Fireball",
    };
    const casts: [number, number][] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((id) => [id * 1000, id]);
    expect(countConsumables(casts, names)).toEqual({ combatPotions: 2, healthPotions: 2, manaPotions: 1, healthstones: 2 });
  });
});
