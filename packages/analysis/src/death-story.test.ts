import { describe, expect, it } from "vitest";
import pull56 from "../fixtures/pull56.json";
import cily from "../fixtures/pull56-cilyxb-death.json";
import { buildDeathStory } from "./index";

const id = (name: string) => pull56.abilities.find((a) => a.name === name)!.gameID;

// Real data: Cilyxb's death at 4:16 in pull #56. Healers kept them topped up until 2.2s before death,
// then Protovenom Eruption, Shifting Protovenom, Mark of Acid and Living Venom landed in 1.6 seconds.
describe("buildDeathStory on a real death", () => {
  const story = buildDeathStory(cily.death, cily.damage, cily.heals, cily.fightStartTime);

  it("finds the moment it went wrong: healthy at 81%, 2.2s before death", () => {
    expect(story.burst.startHp).toBeCloseTo(0.81, 2);
    expect(Math.round(story.burst.beforeDeathMs / 100) / 10).toBe(2.2);
  });

  it("names what did the damage in that burst", () => {
    const ids = story.burst.damage.map((a) => a.abilityId);
    expect(ids).toEqual(expect.arrayContaining([id("Protovenom Eruption"), id("Living Venom"), id("Shifting Protovenom")]));
    expect(story.burst.healing).toBeGreaterThan(0);
  });

  it("shows the killing blow was a small part of it", () => {
    expect(story.killingBlow?.abilityId).toBe(id("Shifting Protovenom"));
    expect(story.killingBlow!.shareOfBurst).toBeLessThan(0.15);
  });

  it("flags big hits (20%+ of max health)", () => {
    const big = story.entries.filter((e) => e.kind === "damage" && e.big);
    expect(big.some((e) => e.kind === "damage" && e.abilityId === id("Living Venom"))).toBe(true);
  });

  it("notices the abilities that kept ticking", () => {
    const ids = story.repeated.map((r) => r.abilityId);
    expect(ids.slice(0, 2)).toEqual(expect.arrayContaining([id("Shifting Protovenom"), id("Mark of Acid")]));
  });

  it("merges heals between hits into single rows, in time order", () => {
    for (let i = 1; i < story.entries.length; i++) {
      expect(story.entries[i]!.fightTimeMs).toBeGreaterThanOrEqual(story.entries[i - 1]!.fightTimeMs);
      expect(story.entries[i]!.kind === "healing" && story.entries[i - 1]!.kind === "healing").toBe(false);
    }
  });
});

describe("buildDeathStory edge cases", () => {
  const hit = (t: number, hp: number, amount = 100) => ({ timestamp: t, type: "damage", abilityGameID: 1, amount, hitPoints: hp, maxHitPoints: 1000 });

  it("says when you were low for the whole window", () => {
    const story = buildDeathStory({ timestamp: 10_000 }, [hit(1000, 500), hit(5000, 300), hit(10_000, 0)], [], 0);
    expect(story.lowWholeWindow).toBe(true);
    expect(story.burst.startHp).toBeNull();
    expect(story.entries.every((e) => e.inBurst)).toBe(true);
  });

  it("copes with no data", () => {
    const story = buildDeathStory({ timestamp: 10_000 }, [], [], 0);
    expect(story.entries).toEqual([]);
    expect(story.killingBlow).toBeNull();
    expect(story.lowWholeWindow).toBe(false);
  });
});
