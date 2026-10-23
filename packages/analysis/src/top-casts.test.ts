import { describe, expect, it } from "vitest";
import { openerSteps, topPotionUse } from "./top-casts";

const top = (rank: number, casts: [number, number][], durationMs = 300_000) => ({ rank, name: `P${rank}`, durationMs, casts });

describe("openerSteps", () => {
  const tops = [top(1, [[0, 1], [1000, 2], [2000, 3]]), top(2, [[0, 1], [1200, 2], [2500, 4]]), top(3, [[0, 1], [900, 3], [2100, 2]])];

  it("lines up casts by position with the most common top choice", () => {
    const steps = openerSteps([[100, 1], [1500, 3], [3000, 9]], tops, { windowMs: 30_000, steps: 5, ignore: new Set() });
    expect(steps.map((s) => s.common)).toEqual([
      { abilityId: 1, share: 1 },
      { abilityId: 2, share: 2 / 3 },
      { abilityId: 3, share: 1 / 3 },
    ]);
    // Step 2: 1 of 3 top players also cast 3 there, which counts as a variation, not a mistake.
    expect(steps.map((s) => s.match)).toEqual([true, true, false]);
    expect(steps[0]!.top1).toEqual([0, 1]);
  });

  it("skips ignored spells and stops at the window", () => {
    const steps = openerSteps([[0, 50], [100, 1], [40_000, 2]], tops, { windowMs: 30_000, steps: 2, ignore: new Set([50]) });
    expect(steps).toHaveLength(2);
    expect(steps[0]!.you).toEqual([100, 1]);
    expect(steps[1]!.you).toBeNull();
    expect(steps[1]!.match).toBeNull();
  });
});

describe("topPotionUse", () => {
  it("counts potions, which one and when", () => {
    const potions = new Set([10, 11]);
    const r = topPotionUse(
      [top(2, [[1000, 10], [5000, 1]]), top(1, [[0, 10], [180_000, 10]]), top(3, [[2000, 11], [200_000, 11]])],
      potions,
    );
    expect(r.players).toBe(3);
    expect(r.usedAny).toBe(1);
    expect(r.usedTwo).toBeCloseTo(2 / 3);
    expect(r.first?.median).toBe(1000);
    expect(r.second?.median).toBe(190_000);
    expect(r.mostCommon).toEqual({ abilityId: 10, share: 2 / 3 });
    expect(r.rows.map((x) => x.rank)).toEqual([1, 2, 3]);
  });
});
