import { describe, expect, it } from "vitest";
import {
  type CohortMember,
  type PlayerMetrics,
  classifyAvoidability,
  encounterAvoidability,
  tankAvoidability,
  extractFightMetrics,
  median,
  quantile,
  roleOf,
  specBenchmark,
  summarizeMaps,
} from "./index";

describe("stats", () => {
  it("computes medians for odd and even lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNaN();
  });

  it("interpolates quantiles", () => {
    expect(quantile([0, 10], 0.25)).toBe(2.5);
  });

  it("treats missing keys as zero and drops rarely used keys", () => {
    const out = summarizeMaps([{ a: 10, b: 1 }, { a: 20 }, { a: 30 }]);
    expect(out.a?.median).toBe(20);
    expect(out.b).toBeUndefined(); // used by 1/3 < 0.5
  });
});

describe("roleOf", () => {
  it("disambiguates shared spec names by class", () => {
    expect(roleOf("Paladin-Protection")).toBe("tank");
    expect(roleOf("Paladin-Holy")).toBe("healer");
    expect(roleOf("Mage-Fire")).toBe("dps");
  });
});

describe("extractFightMetrics", () => {
  const [mage, priest] = extractFightMetrics({
    durationMs: 120_000,
    fightStartTime: 1000,
    players: [
      { id: 1, name: "Mage", icon: "Mage-Fire", activeTime: 108_000 },
      { id: 2, name: "Priest", icon: "Priest-Holy", activeTime: 60_000 },
    ],
    castEvents: [
      ...Array.from({ length: 60 }, (_, i) => ({ timestamp: 1000 + i, type: "cast", sourceID: 1, abilityGameID: 100 })),
      { timestamp: 2000, type: "begincast", sourceID: 1, abilityGameID: 100 }, // not a completed cast
    ],
    damageTakenEvents: [
      { type: "damage", targetID: 1, abilityGameID: 900, amount: 100_000, absorbed: 20_000 },
      { type: "damage", targetID: 1, abilityGameID: 900, amount: 120_000 },
    ],
    damageDone: [{ id: 1, total: 1000, targets: [{ name: "Boss", total: 750 }, { name: "Add", total: 250 }] }],
    deaths: [
      { timestamp: 91_000, targetID: 2 },
      { timestamp: 31_000, targetID: 2 },
    ],
  });

  it("computes rates per minute and per second", () => {
    expect(mage?.cpm[100]).toBe(30);
    expect(mage?.dtps[900]).toBe(2000); // absorbed damage counts
    expect(mage?.hits[900]).toBe(2);
    expect(mage?.damageTakenPerSec).toBe(2000);
    expect(mage?.activeTimePct).toBeCloseTo(0.9);
    expect(mage?.targetShare).toEqual({ Boss: 0.75, Add: 0.25 });
  });

  it("counts every death (battle res) and reports the first in fight time", () => {
    expect(mage?.deaths).toBe(0);
    expect(priest?.deaths).toBe(2);
    expect(priest?.firstDeathMs).toBe(30_000);
  });
});

function player(overrides: Partial<PlayerMetrics>): PlayerMetrics {
  return {
    actorId: 1,
    name: "p",
    specKey: "Mage-Fire",
    durationMs: 300_000,
    activeTimePct: 0.9,
    cpm: {},
    dtps: {},
    hits: {},
    damageTakenPerSec: 0,
    targetShare: {},
    deaths: 0,
    firstDeathMs: null,
    ...overrides,
  };
}

describe("specBenchmark", () => {
  const cohort: CohortMember[] = [100, 200, 300, 400, 500].map((amount, i) => ({
    amount,
    itemLevel: 330,
    metrics: player({ cpm: { 100: 10 + i }, dtps: i === 0 ? { 900: 50 } : {}, deaths: i === 4 ? 1 : 0 }),
    buffUptime: { 77: 0.5 },
  }));

  it("uses medians and keeps rare damage-taken abilities", () => {
    const b = specBenchmark(cohort);
    expect(b.insufficient).toBe(false);
    expect(b.amount.median).toBe(300);
    expect(b.cpm[100]?.median).toBe(12);
    expect(b.dtps[900]?.usedBy).toBe(0.2);
    expect(b.buffUptime[77]?.median).toBe(0.5);
    expect(b.deathRate).toBe(0.2);
  });

  it("flags small samples", () => {
    expect(specBenchmark(cohort.slice(0, 3)).insufficient).toBe(true);
  });
});

describe("encounterAvoidability", () => {
  it("classifies by how many players avoid the ability entirely", () => {
    const players = Array.from({ length: 20 }, (_, i) =>
      player({ dtps: { raidwide: 100, pool: i === 0 ? 500 : 0, soak: i < 8 ? 200 : 0 } }),
    );
    const out = encounterAvoidability([players]);
    expect(out.raidwide?.classification).toBe("unavoidable");
    expect(out.pool?.classification).toBe("avoidable");
    expect(out.pool?.medianDtpsWhenHit).toBe(500);
    expect(out.soak?.classification).toBe("situational");
  });

  it("skips abilities that never did damage", () => {
    expect(encounterAvoidability([[player({ dtps: { immune: 0 } })]]).immune).toBeUndefined();
  });

  // 20 fights of 18 players, shaped like the W41 Mythic sample.
  const fights = Array.from({ length: 20 }, (_, f) =>
    Array.from({ length: 18 }, (_, i) =>
      player({
        dtps: {
          // Unchecked Rage: the tank left melee in 2 kills, and everyone took it.
          ...(f < 2 ? { rage: 1000 } : {}),
          // Grasping Fangs: a tether on exactly 3 players every kill.
          ...(i < 3 ? { tether: 300 } : {}),
          // Mighty Thud: a soak most of the raid shares, in 19 of 20 kills.
          ...(f > 0 && i < 16 ? { thud: 400 } : {}),
          // A swirl one or two players clip in some kills.
          ...(i < (f % 3 === 0 ? 2 : f % 3 === 1 ? 1 : 0) ? { swirl: 200 } : {}),
          raid: 500,
        },
      }),
    ),
  );

  it("labels what only hits the raid after a missed mechanic as raid-wide, not avoidable", () => {
    const out = encounterAvoidability(fights);
    expect(out.rage).toMatchObject({ classification: "raid-wide", fightShare: 0.1, raidBreadth: 1 });
    expect(out.rage!.zeroShare).toBeGreaterThan(0.85);
    expect(out.swirl?.classification).toBe("avoidable");
    expect(out.raid?.classification).toBe("unavoidable");
  });

  it("labels abilities that hit the same few players every kill as targeted", () => {
    const out = encounterAvoidability(fights);
    expect(out.tether?.classification).toBe("targeted");
    // The swirl's victims vary from kill to kill, and a soak for everyone isn't aimed at anyone.
    expect(out.swirl?.classification).toBe("avoidable");
    expect(out.thud?.classification).toBe("situational");
  });

  it("takes targeted abilities from the boss notes, but never relabels unavoidable ones", () => {
    const out = encounterAvoidability(fights, new Set(["swirl", "raid", "rage"]));
    expect(out.swirl?.classification).toBe("targeted");
    expect(out.raid?.classification).toBe("unavoidable");
    expect(out.rage?.classification).toBe("raid-wide");
  });

  it("gives tanks the same raid-wide and targeted labels", () => {
    const tanks = Array.from({ length: 12 }, (_, i) => player({ dtps: { rage: i < 2 ? 1000 : 0, tether: i === 0 ? 300 : 0 } }));
    const out = tankAvoidability(tanks, encounterAvoidability(fights));
    expect(out.rage?.classification).toBe("raid-wide");
    expect(out.tether?.classification).toBe("targeted");
  });

  it("doesn't trust per-fight patterns from a handful of fights", () => {
    expect(encounterAvoidability(fights.slice(0, 2)).rage?.classification).toBe("unavoidable");
    expect(encounterAvoidability(fights.slice(0, 2)).tether?.classification).not.toBe("targeted");
  });

  it("uses inclusive thresholds", () => {
    expect(classifyAvoidability(0.85)).toBe("avoidable");
    expect(classifyAvoidability(0.1)).toBe("unavoidable");
  });
});
