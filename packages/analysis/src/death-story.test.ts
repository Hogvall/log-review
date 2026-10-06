import { describe, expect, it } from "vitest";
import pull56 from "../fixtures/pull56.json";
import cily from "../fixtures/pull56-cilyxb-death.json";
import { buildDeathStory, replayDebuffs } from "./index";

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

describe("healer details", () => {
  const story = buildDeathStory(cily.death, cily.damage, cily.heals, cily.fightStartTime);
  const name = (id: number) => pull56.players.find((p) => p.id === id)?.name;

  it("lists who healed you, biggest first, with burst and window totals", () => {
    expect(story.healers.length).toBeGreaterThan(1);
    for (let i = 1; i < story.healers.length; i++) {
      expect(story.healers[i - 1]!.windowAmount).toBeGreaterThanOrEqual(story.healers[i]!.windowAmount);
    }
    for (const h of story.healers) expect(h.burstAmount).toBeLessThanOrEqual(h.windowAmount);
    // Cilyxb is a Holy Paladin: most of their healing in the window was their own.
    expect(name(story.healers[0]!.sourceId)).toBe("Cilyxb");
  });

  it("includes shields and keeps them apart from heals", () => {
    expect(story.healers.some((h) => h.spells.some((sp) => sp.shield))).toBe(true);
  });

  it("totals the healing eaten by heal-absorbs", () => {
    expect(story.healAbsorbed.window).toBeGreaterThan(0);
    expect(story.healAbsorbed.burst).toBeLessThanOrEqual(story.healAbsorbed.window);
  });

  it("attributes every healing row to its sources", () => {
    for (const e of story.entries) {
      if (e.kind !== "healing") continue;
      expect(e.sources.reduce((sum, src) => sum + src.amount, 0)).toBeCloseTo(e.amount);
    }
  });

  it("burst healing matches the healers' burst totals", () => {
    expect(story.healers.reduce((sum, h) => sum + h.burstAmount, 0)).toBeCloseTo(story.burst.healing);
  });
});

describe("debuff stacks", () => {
  const story = buildDeathStory(cily.death, cily.damage, cily.heals, cily.fightStartTime, {}, cily.debuffs);
  const debuff = (name: string) => story.debuffs?.find((d) => d.abilityId === id(name));

  it("lists boss debuffs from the window, most stacks first", () => {
    const stacks = story.debuffs!.map((d) => d.maxStacks);
    expect(stacks).toEqual([...stacks].sort((a, b) => b - a));
  });

  it("keeps a debuff that fell off just before death, with its peak stacks", () => {
    // Real data: Mark of Acid reached 12 stacks, then fell off 0.1s before Cilyxb died.
    const acid = debuff("Mark of Acid")!;
    expect(acid.maxStacks).toBe(12);
    expect(acid.stacksAtDeath).toBe(0);
    expect(acid.removedBeforeDeathMs).toBeLessThan(500);
  });

  it("adds timestamped debuff rows inside the window without changing the health story", () => {
    const rows = story.entries.filter((e) => e.kind === "debuff");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.beforeDeathMs).toBeLessThanOrEqual(story.windowMs);
    expect(story.burst.startHp).toBeCloseTo(0.81, 2);
    for (let i = 1; i < story.entries.length; i++) {
      expect(story.entries[i]!.fightTimeMs).toBeGreaterThanOrEqual(story.entries[i - 1]!.fightTimeMs);
    }
  });

  it("is null when debuffs weren't fetched", () => {
    expect(buildDeathStory(cily.death, cily.damage, cily.heals, cily.fightStartTime).debuffs).toBeNull();
  });

  it("replays applications, stacks and removals", () => {
    const ev = [
      { timestamp: 100, type: "applydebuff", abilityGameID: 1 },
      { timestamp: 200, type: "applydebuffstack", abilityGameID: 1, stack: 2 },
      { timestamp: 300, type: "applydebuffstack", abilityGameID: 1, stack: 3 },
      { timestamp: 300, type: "applydebuff", abilityGameID: 2 },
      { timestamp: 400, type: "removedebuff", abilityGameID: 2 },
      { timestamp: 450, type: "removedebuffstack", abilityGameID: 1, stack: 2 },
    ];
    const { debuffs, changes } = replayDebuffs(ev, 500, 0, 1000);
    expect(debuffs).toEqual([
      { abilityId: 1, maxStacks: 3, stacksAtDeath: 2, removedBeforeDeathMs: null },
      { abilityId: 2, maxStacks: 1, stacksAtDeath: 0, removedBeforeDeathMs: 100 },
    ]);
    expect(changes.map((c) => `${c.abilityId}:${c.change}:${c.stacks}`)).toEqual(["1:applied:1", "1:stacked:2", "1:stacked:3", "2:applied:1", "2:removed:0"]);
  });

  it("counts stacks built up before the window", () => {
    const ev = [
      { timestamp: 100, type: "applydebuff", abilityGameID: 1 },
      { timestamp: 200, type: "applydebuffstack", abilityGameID: 1, stack: 5 },
      { timestamp: 9_000, type: "applydebuffstack", abilityGameID: 1, stack: 6 },
    ];
    const { debuffs, changes } = replayDebuffs(ev, 10_000, 0, 2_000);
    expect(debuffs[0]).toMatchObject({ maxStacks: 6, stacksAtDeath: 6 });
    expect(changes).toHaveLength(1);
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
