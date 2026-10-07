import { describe, expect, it } from "vitest";
import {
  type CastMark,
  type SpecBenchmark,
  POTION_KEY,
  castGaps,
  compareToBenchmark,
  findPrecasts,
  minuteSpans,
  phaseSpans,
  reviewTimeline,
  timelineBenchmark,
} from "./index";

const PYRO = 11366;
const FIRE_BLAST = 108853;
const POTION = 1236616;
const COMBUSTION = 190319;

describe("findPrecasts", () => {
  // Qiano's real pull: a Pyroblast lands at 0.45s with no begincast; it's hardcast (1.7s) later in the fight.
  const events = [
    { fightTimeMs: 450, type: "cast", abilityId: PYRO },
    { fightTimeMs: 620, type: "cast", abilityId: POTION },
    { fightTimeMs: 1230, type: "cast", abilityId: FIRE_BLAST },
    { fightTimeMs: 2230, type: "begincast", abilityId: PYRO },
    { fightTimeMs: 2230, type: "cast", abilityId: PYRO },
    { fightTimeMs: 10_480, type: "begincast", abilityId: PYRO },
    { fightTimeMs: 12_190, type: "cast", abilityId: PYRO },
  ];

  it("finds a spell hardcast before the pull", () => {
    expect(findPrecasts(events)).toEqual([PYRO]);
  });

  it("ignores instants used right at the pull", () => {
    expect(findPrecasts(events.filter((e) => e.abilityId !== PYRO))).toEqual([]);
  });

  it("ignores a cast-time spell that was started after the pull", () => {
    expect(
      findPrecasts([
        { fightTimeMs: 100, type: "begincast", abilityId: PYRO },
        { fightTimeMs: 1300, type: "cast", abilityId: PYRO },
      ]),
    ).toEqual([]);
  });
});

describe("castGaps", () => {
  it("finds idle stretches, including at the start and until death", () => {
    const casts: CastMark[] = [[500, 1], [1500, 1], [9000, 1], [10_000, 1]];
    expect(castGaps(casts, 20_000)).toEqual([
      { startMs: 1500, endMs: 9000 },
      { startMs: 10_000, endMs: 20_000 },
    ]);
    expect(castGaps([[6000, 1]], 6500)).toEqual([{ startMs: 0, endMs: 6000 }]);
  });
});

describe("phaseSpans", () => {
  it("turns transitions into fight-relative spans with names", () => {
    const spans = phaseSpans(
      [
        { id: 1, startTime: 1000 },
        { id: 2, startTime: 186_000 },
        { id: 3, startTime: 307_000 },
      ],
      1000,
      420_000,
      [{ id: 2, name: "Intermission: Ritual of Awakening", isIntermission: true }],
    );
    expect(spans.map((s) => [s.id, s.startMs, s.endMs, s.intermission])).toEqual([
      [1, 0, 185_000, false],
      [2, 185_000, 306_000, true],
      [3, 306_000, 420_000, false],
    ]);
    expect(spans[1]!.name).toBe("Intermission: Ritual of Awakening");
    expect(phaseSpans(null, 0, 1000)).toEqual([]);
  });
});

/** One cast every `every` ms between `from` and `to`. */
const steady = (from: number, to: number, every: number, id = PYRO): CastMark[] => {
  const out: CastMark[] = [];
  for (let t = from; t < to; t += every) out.push([t, id]);
  return out;
};

describe("reviewTimeline", () => {
  const phases = [
    { id: 1, name: "Stage One", intermission: false, startMs: 0, endMs: 100_000 },
    { id: 2, name: "Intermission", intermission: true, startMs: 100_000, endMs: 130_000 },
    { id: 1, name: "Stage One", intermission: false, startMs: 130_000, endMs: 200_000 },
  ];
  const top = {
    durationMs: 200_000,
    phases,
    casts: [...steady(0, 200_000, 1000), [1500, COMBUSTION] as CastMark],
  };

  it("flags a cooldown pressed much later than #1 in the opener", () => {
    const r = reviewTimeline({
      casts: [...steady(0, 200_000, 1000), [20_800, COMBUSTION]],
      precasts: [PYRO],
      durationMs: 200_000,
      aliveMs: 200_000,
      amount: 180_000,
      phases,
      top,
      cooldownIds: [COMBUSTION],
    });
    expect(r.precasts).toEqual([PYRO]);
    expect(r.opener.firstUses).toEqual([{ abilityId: COMBUSTION, player: 20_800, top: 1500, median: null }]);
    expect(r.findings).toEqual([{ kind: "late-cooldown", abilityId: COMBUSTION, playerMs: 20_800, topMs: 1500, basis: "top1" }]);
  });

  it("treats different combat potions as the same for first use", () => {
    const OTHER_POTION = 1236994;
    const r = reviewTimeline({
      casts: [[620, POTION]],
      precasts: [],
      durationMs: 200_000,
      aliveMs: 200_000,
      amount: 1,
      phases: [],
      top: { ...top, casts: [[4100, OTHER_POTION]] },
      cooldownIds: [POTION, OTHER_POTION],
      potionIds: [POTION, OTHER_POTION],
    });
    expect(r.opener.firstUses).toEqual([{ abilityId: POTION, player: 620, top: 4100, median: null }]);
  });

  it("merges repeated phases and flags idle time beyond #1's", () => {
    // Idle for 20s in the middle of the first stage; #1 never stops.
    const casts = [...steady(0, 40_000, 1000), ...steady(60_000, 200_000, 1000), [1500, COMBUSTION] as CastMark];
    const r = reviewTimeline({ casts, precasts: [], durationMs: 200_000, aliveMs: 200_000, amount: 180_000, phases, top, cooldownIds: [] });

    expect(r.byPhase).toBe(true);
    expect(r.phases.map((p) => p.name)).toEqual(["Stage One", "Intermission"]);
    expect(r.phases[0]!.you).toMatchObject({ durationMs: 170_000, idleMs: 21_000 });
    expect(r.phases[0]!.top).toMatchObject({ durationMs: 170_000, idleMs: 0 });
    expect(r.gaps).toEqual([{ startMs: 39_000, endMs: 60_000 }]);

    const idle = r.findings.find((f) => f.kind === "idle-time");
    expect(idle).toMatchObject({ playerMs: 21_000, topMs: 0 });
    // 21s more idle than #1 over 179s of casting: about 12% more damage.
    expect(idle?.kind === "idle-time" && idle.estDpsGain).toBeCloseTo((180_000 * 21_000) / 179_000);
  });

  it("uses minute windows when the boss has no phases, and works without #1", () => {
    const r = reviewTimeline({
      casts: steady(0, 150_000, 1000),
      precasts: [],
      durationMs: 150_000,
      aliveMs: 150_000,
      amount: null,
      phases: [],
      top: null,
      cooldownIds: [COMBUSTION],
    });
    expect(r.byPhase).toBe(false);
    expect(r.phases.map((p) => p.name)).toEqual(["Minute 1", "Minute 2", "Minute 3"]);
    expect(r.phases.every((p) => p.top === null)).toBe(true);
    expect(r.topIdleMs).toBeNull();
    expect(r.findings).toEqual([]);
    expect(minuteSpans(150_000).at(-1)).toMatchObject({ startMs: 120_000, endMs: 150_000 });
  });

  it("doesn't count phases the player was dead for", () => {
    const r = reviewTimeline({ casts: steady(0, 90_000, 1000), precasts: [], durationMs: 200_000, aliveMs: 90_000, amount: 1, phases, top, cooldownIds: [] });
    expect(r.phases[0]!.you?.durationMs).toBe(90_000);
    expect(r.phases[1]!.you).toBeNull();
  });
});

describe("compareToBenchmark: big damage abilities", () => {
  const s = (median: number, p25 = median * 0.93, p75 = median * 1.05) => ({ median, p25, p75, n: 15, usedBy: 1 });
  const bench: SpecBenchmark = {
    sampleSize: 15,
    insufficient: false,
    amount: s(218_800),
    durationMs: s(421_000),
    itemLevel: s(325),
    activeTimePct: s(1, 1, 1),
    cpm: { [PYRO]: s(29.1), [FIRE_BLAST]: s(21.2) },
    buffUptime: {},
    dtps: {},
    targetShare: {},
    deathRate: 0,
  };

  it("flags the main nuke at 90% of the median casts when the gap is worth 2%+ DPS", () => {
    // Qiano: 184 Pyroblasts (26.3/min) for 29.1M over 7:00, 185K DPS.
    const c = compareToBenchmark(
      {
        amount: 185_100,
        durationMs: 420_000,
        aliveMs: 420_000,
        itemLevel: 326,
        activeTimeMs: 420_000,
        casts: { [PYRO]: 184, [FIRE_BLAST]: 132 },
        damageByAbility: { [PYRO]: 29_143_469, [FIRE_BLAST]: 3_635_703 },
        buffUptime: {},
        targetShare: {},
      },
      bench,
    );
    const pyro = c.abilities.find((a) => a.abilityId === PYRO)!;
    expect(pyro.status).toBe("low");
    expect(pyro.estDpsGain).toBeGreaterThan(7000);
    // Fire Blast's gap is under 2% of DPS and above 85% of the median: still fine.
    expect(c.abilities.find((a) => a.abilityId === FIRE_BLAST)!.status).toBe("ok");
    expect(c.findings[0]).toMatchObject({ kind: "low-casts", ability: { abilityId: PYRO } });
  });
});

describe("timelineBenchmark", () => {
  const phases = [
    { id: 1, name: "Stage One", intermission: false, startMs: 0, endMs: 100_000 },
    { id: 2, name: "Intermission", intermission: true, startMs: 100_000, endMs: 200_000 },
  ];
  // Five top players: Combustion at 1–5s, one drinks a different potion, one never precasts.
  const members = [1, 2, 3, 4, 5].map((i) => ({
    casts: [...steady(0, 200_000, 1000), [i * 1000 + 500, COMBUSTION] as CastMark, [600, i === 5 ? 999 : POTION] as CastMark],
    precasts: i === 5 ? [] : [PYRO],
    durationMs: 200_000,
    phases,
  }));
  const bench = timelineBenchmark(members, [COMBUSTION], new Set([POTION, 999]))!;

  it("summarizes first uses, precasts and phases", () => {
    expect(bench.sampleSize).toBe(5);
    expect(bench.firstUse[COMBUSTION]).toMatchObject({ median: 3500, usedBy: 1 });
    expect(bench.firstUse[POTION_KEY]).toMatchObject({ median: 600, usedBy: 1 });
    expect(bench.precast).toEqual({ share: 0.8, abilityId: PYRO });
    expect(bench.phases[1]!.cpm.median).toBeCloseTo(61.2, 1);
    expect(bench.phases[2]!.idleShare.median).toBe(0);
    expect(bench.idleShare.median).toBe(0);
    expect(timelineBenchmark(members.slice(0, 2), [COMBUSTION], new Set())).toBeNull();
  });

  it("judges the opener and idle time against the medians, not #1", () => {
    // #1 pressed Combustion at 0.5s; the median is 3.5s. At 9s you're 5.5s behind the median: not flagged.
    const top = { casts: [[500, COMBUSTION]] as CastMark[], durationMs: 200_000, phases };
    const base = { precasts: [], durationMs: 200_000, aliveMs: 200_000, amount: 100_000, phases, top, benchmark: bench, cooldownIds: [COMBUSTION] };
    const onTime = reviewTimeline({ ...base, casts: [...steady(0, 200_000, 1000), [9000, COMBUSTION]] });
    expect(onTime.findings).toEqual([]);
    expect(onTime.opener.firstUses[0]).toMatchObject({ top: 500, median: { median: 3500 } });
    expect(onTime.phases[0]!.median?.cpm.median).toBeCloseTo(61.2, 1);
    expect(onTime.topPrecast).toEqual({ share: 0.8, abilityId: PYRO });

    const late = reviewTimeline({ ...base, casts: [...steady(0, 200_000, 1000), [20_000, COMBUSTION]] });
    expect(late.findings).toEqual([{ kind: "late-cooldown", abilityId: COMBUSTION, playerMs: 20_000, topMs: 3500, basis: "median" }]);

    const idle = reviewTimeline({ ...base, casts: [...steady(0, 50_000, 1000), ...steady(80_000, 200_000, 1000), [3000, COMBUSTION]] });
    expect(idle.findings).toMatchObject([{ kind: "idle-time", playerMs: 31_000, topMs: 0, basis: "median" }]);
  });
});
