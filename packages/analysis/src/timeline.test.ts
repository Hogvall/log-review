import { describe, expect, it } from "vitest";
import {
  type CastMark,
  type SpecBenchmark,
  POTION_KEY,
  castGaps,
  executeRate,
  executeStarts,
  compareToBenchmark,
  findPrecasts,
  isExecuteSpell,
  isUtilitySpell,
  minuteSpans,
  phaseSpans,
  reviewTimeline,
  similarLengthAmount,
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
    expect(r.gaps).toEqual([{ startMs: 39_000, endMs: 60_000, phase: "Stage One" }]);

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

  it("expects idle time phase by phase, so a pull with more intermission isn't blamed for it", () => {
    // #1's kill: 100s of stage one fully active, then a 20s intermission half idle (stunned).
    const refPhases = [
      { id: 1, name: "Stage One", intermission: false, startMs: 0, endMs: 100_000 },
      { id: 2, name: "Intermission", intermission: true, startMs: 100_000, endMs: 120_000 },
    ];
    const refCasts = [...steady(0, 100_000, 1000), ...steady(110_000, 120_000, 1000)];
    // Your wipe: same stage one, but 60s of intermission, half of it idle like #1's.
    const yourPhases = [
      { id: 1, name: "Stage One", intermission: false, startMs: 0, endMs: 100_000 },
      { id: 2, name: "Intermission", intermission: true, startMs: 100_000, endMs: 160_000 },
    ];
    const yourCasts = [...steady(0, 100_000, 1000), ...steady(130_000, 160_000, 1000)];
    const r = reviewTimeline({
      casts: yourCasts,
      precasts: [],
      durationMs: 160_000,
      aliveMs: 160_000,
      amount: 100_000,
      phases: yourPhases,
      top: { casts: refCasts, durationMs: 120_000, phases: refPhases },
      cooldownIds: [],
    });
    expect(r.idleMs).toBe(31_000);
    // Scaling #1's whole-fight share (11s of 120s) would expect ~14.7s; per phase it's 1s + 30s.
    expect(r.topIdleMs).toBeCloseTo(31_000, -2);
    expect(r.findings).toEqual([]);
    expect(r.gaps).toEqual([{ startMs: 99_000, endMs: 130_000, phase: "Intermission" }]);
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

describe("compareToBenchmark: utility and tiny gains", () => {
  const RETREAT = 198793;
  const LUST = 80353;
  const s = (median: number) => ({ median, p25: median * 0.9, p75: median * 1.1, n: 15, usedBy: 1 });
  const bench: SpecBenchmark = {
    sampleSize: 15,
    insufficient: false,
    amount: s(240_000),
    durationMs: s(337_000),
    itemLevel: s(331),
    activeTimePct: s(1),
    cpm: { [RETREAT]: s(2.4), [POTION]: s(0.35), [LUST]: s(0.17), [PYRO]: s(29.1) },
    buffUptime: {},
    dtps: {},
    targetShare: {},
    deathRate: 0,
  };
  const player = {
    amount: 170_000,
    durationMs: 432_000,
    aliveMs: 432_000,
    itemLevel: 323,
    activeTimeMs: 432_000,
    // Vengeful Retreat does a little damage, so it gets a (tiny) estimate.
    casts: { [RETREAT]: 14, [POTION]: 2, [PYRO]: 160 },
    damageByAbility: { [RETREAT]: 400_000, [PYRO]: 25_000_000 },
    buffUptime: {},
    targetShare: {},
  };

  it("keeps movement, potions and tiny gains out of the findings, and hides raid utility", () => {
    const c = compareToBenchmark(player, bench, { utilityIds: new Set([RETREAT, POTION, LUST]), hiddenIds: new Set([LUST]) });
    expect(c.abilities.map((a) => a.abilityId).sort()).toEqual([PYRO, RETREAT, POTION].sort());
    expect(c.abilities.find((a) => a.abilityId === RETREAT)!.status).toBe("low");
    expect(c.findings.map((f) => f.kind === "low-casts" && f.ability.abilityId)).toEqual([PYRO]);
  });

  it("drops a non-utility finding worth under 0.5% of DPS", () => {
    const c = compareToBenchmark(player, bench);
    const ids = c.findings.flatMap((f) => (f.kind === "low-casts" ? [f.ability.abilityId] : []));
    expect(ids).toContain(PYRO);
    expect(ids).not.toContain(RETREAT); // ~+20 dps
    expect(isUtilitySpell("Glide")).toBe(true);
    expect(isUtilitySpell("Eye Beam")).toBe(false);
  });
});

describe("compareToBenchmark: executes", () => {
  const KILL_SHOT = 53351;
  const s = (median: number) => ({ median, p25: median * 0.9, p75: median * 1.1, n: 15, usedBy: 1 });
  const bench: SpecBenchmark = {
    sampleSize: 15, insufficient: false, amount: s(270_000), durationMs: s(332_000), itemLevel: s(328), activeTimePct: s(1),
    cpm: { [KILL_SHOT]: s(1.2) }, buffUptime: {}, dtps: {}, targetShare: {}, deathRate: 0,
  };
  it("never judges an execute: a wipe before the execute phase isn't a rotation problem", () => {
    // Aomine: 3 Kill Shots in a 7:12 wipe vs 1.2/min in kills.
    const c = compareToBenchmark(
      { amount: 193_700, durationMs: 432_000, aliveMs: 420_000, itemLevel: 328, activeTimeMs: 400_000, casts: { [KILL_SHOT]: 3 }, damageByAbility: { [KILL_SHOT]: 3_000_000 }, buffUptime: {}, targetShare: {} },
      bench,
      { executeIds: new Map([[KILL_SHOT, 20 as const]]) },
    );
    expect(c.abilities[0]).toMatchObject({ role: "execute", status: "execute", estDpsGain: null });
    expect(c.findings).toEqual([]);
    expect(isExecuteSpell("Kill Shot")).toBe(true);
  });
});

describe("fight length (RAI-1)", () => {
  const VOLLEY = 260243;
  const s = (median: number, p25 = median * 0.9, p75 = median * 1.1) => ({ median, p25, p75, n: 15, usedBy: 1 });
  const phases: { id: number; name: string; intermission: boolean; startMs: number; endMs: number }[] = [];
  // Top players press Volley at ~17s and then every ~45s; kills last 5:00–6:00.
  const members = [300_000, 315_000, 330_000, 345_000, 360_000].map((durationMs, i) => {
    const casts: CastMark[] = [];
    for (let t = 17_000 + i * 500; t < durationMs; t += 45_000) casts.push([t, VOLLEY]);
    return { casts, precasts: [], durationMs, phases };
  });
  const timeline = timelineBenchmark(members, [VOLLEY], new Set())!;

  it("learns each cooldown's pace from top players' timelines", () => {
    expect(timeline.firstUse[VOLLEY]!.median).toBe(18_000);
    expect(timeline.cadence![VOLLEY]!.median).toBe(45_000);
  });

  const bench: SpecBenchmark = {
    sampleSize: 15,
    insufficient: false,
    amount: s(270_000),
    durationMs: s(330_000),
    itemLevel: s(328),
    activeTimePct: s(1),
    cpm: { [VOLLEY]: s(1.3) },
    buffUptime: {},
    dtps: {},
    targetShare: {},
    deathRate: 0,
    timeline,
    // Longer kills, lower DPS: the closest kill lengths to a 7:12 pull are the slow ones.
    amountPoints: [290, 285, 282, 280, 276, 272, 270, 268, 262, 258, 255, 250, 248, 245, 240].map((k, i) => ({ amount: k * 1000, durationMs: 290_000 + i * 6000 })),
  };
  const player = (casts: number) => ({
    amount: 193_700,
    durationMs: 432_000,
    aliveMs: 420_000,
    itemLevel: 328,
    activeTimeMs: 400_000,
    casts: { [VOLLEY]: casts },
    damageByAbility: { [VOLLEY]: casts * 1_500_000 },
    buffUptime: {},
    targetShare: {},
  });

  it("expects as many cooldown casts as top players' pace fits in your time alive", () => {
    // 0:18, then every 45s until 7:00: 9 casts. Per minute, 5 casts in 7:00 (0.71/min) looked 45% low;
    // by count it's 4 short.
    const low = compareToBenchmark(player(5), bench).abilities[0]!;
    expect(low.expected).toEqual({ casts: 9, firstMs: 18_000, everyMs: 45_000 });
    expect(low.status).toBe("low");
    expect(low.estDpsGain).toBeCloseTo((4 * 1_500_000) / 432, 0);

    // 8 of 9 is one short and under 15%: fine, even though 8 in 7:00 is "only" 1.14/min vs 1.3/min.
    expect(compareToBenchmark(player(8), bench).abilities[0]!.status).toBe("ok");
  });

  it("compares DPS with the top players whose kills were closest in length", () => {
    const c = compareToBenchmark(player(9), bench);
    expect(c.amount!.similar).toEqual({ median: 248_000, n: 5, minMs: 350_000, maxMs: 374_000 });
    expect(c.amount!.ratio).toBeCloseTo(193_700 / 248_000);
    expect(similarLengthAmount(bench.amountPoints!.slice(0, 5), 432_000)).toBeNull();
  });
});

describe("execute windows (RAI-2)", () => {
  const KILL_SHOT = 53351;
  const start = 1_000_000;
  // Two bosses (council): the earliest one to reach a threshold opens the window. Adds don't count.
  const series = [
    { name: "Blood of Ula'tek", type: "Boss", data: [[start, 100], [start + 300_000, 30], [start + 380_000, 19], [start + 430_000, 2]] as [number, number][] },
    { name: "Breath of Ula'tek", type: "Boss", data: [[start, 100], [start + 300_000, 34], [start + 400_000, 18], [start + 430_000, 4]] as [number, number][] },
    { name: "Venom Coagulation", type: "NPC", data: [[start + 10_000, 100], [start + 20_000, 1]] as [number, number][] },
  ];

  it("finds when the first boss reached each threshold", () => {
    expect(executeStarts(series, start, 432_000)).toEqual({ 15: 430_000, 20: 380_000, 35: 300_000 });
    expect(executeRate([370_000, 385_000, 400_000, 420_000], 380_000, 420_000)).toEqual({ casts: 3, windowMs: 40_000, perMin: 4.5 });
  });

  // Top players: kills with a ~70s window under 20%, Kill Shot every ~12s in it (5/min), a proc earlier.
  const members = [0, 1, 2, 3, 4].map((i) => {
    const durationMs = 320_000 + i * 5000;
    const windowStart = durationMs - 70_000;
    const casts: CastMark[] = [[100_000, KILL_SHOT]];
    for (let t = windowStart + 2000; t < durationMs; t += 12_000) casts.push([t, KILL_SHOT]);
    return { casts, precasts: [], durationMs, phases: [], executeStarts: { 15: null, 20: windowStart, 35: durationMs - 110_000 } };
  });
  const timeline = timelineBenchmark(members, [], new Set(), new Map([[KILL_SHOT, 20 as const]]))!;
  const s = (median: number) => ({ median, p25: median * 0.9, p75: median * 1.1, n: 15, usedBy: 1 });
  const bench: SpecBenchmark = {
    sampleSize: 15, insufficient: false, amount: s(270_000), durationMs: s(330_000), itemLevel: s(328), activeTimePct: s(1),
    cpm: { [KILL_SHOT]: s(1.2) }, buffUptime: {}, dtps: {}, targetShare: {}, deathRate: 0, timeline,
  };
  const pull = (castTimes: number[], starts: Record<number, number | null>, aliveMs = 420_000) =>
    compareToBenchmark(
      {
        amount: 193_700, durationMs: 432_000, aliveMs, itemLevel: 328, activeTimeMs: 400_000,
        casts: { [KILL_SHOT]: castTimes.length }, damageByAbility: { [KILL_SHOT]: castTimes.length * 1_000_000 },
        buffUptime: {}, targetShare: {},
        castTimes: castTimes.map((t) => [t, KILL_SHOT] as [number, number]),
        executeStarts: starts,
      },
      bench,
      { executeIds: new Map([[KILL_SHOT, 20 as const]]) },
    ).abilities[0]!;

  it("learns top players' casts per minute inside the execute window", () => {
    expect(timeline.execute![KILL_SHOT]!.thresholdPct).toBe(20);
    expect(timeline.execute![KILL_SHOT]!.perMin.median).toBeCloseTo((6 * 60) / 70, 1);
  });

  it("judges your casts only inside your own window", () => {
    // Boss under 20% from 5:00 until you died at 7:00: 2 minutes, top players' pace fits ~10; you cast 3.
    const low = pull([28_000, 310_000, 400_000, 415_000], { 15: null, 20: 300_000, 35: 250_000 });
    expect(low.executeWindow).toMatchObject({ thresholdPct: 20, startMs: 300_000, windowMs: 120_000, casts: 3 });
    expect(low.executeWindow!.expected).toBeCloseTo(10.3, 1);
    expect(low.status).toBe("low");
    expect(low.estDpsGain).toBeGreaterThan(0);
    expect(low.status === "low" && low.role).toBe("execute");

    // On pace inside the window: fine, however few casts that is per minute of the whole fight.
    const onPace = pull([310_000, 322_000, 334_000, 346_000, 358_000, 370_000, 382_000, 394_000, 406_000, 418_000], { 15: null, 20: 300_000, 35: 250_000 });
    expect(onPace.status).toBe("ok");
  });

  it("doesn't judge an execute when the boss never got low while you were alive", () => {
    const never = pull([28_000, 201_000], { 15: null, 20: null, 35: 380_000 });
    expect(never.status).toBe("execute");
    expect(never.executeWindow).toMatchObject({ startMs: null, windowMs: 0 });
    expect(never.estDpsGain).toBeNull();
    // Window opened 10s before you died: too short to judge.
    expect(pull([28_000], { 15: null, 20: 410_000, 35: 380_000 }).status).toBe("execute");
  });
});
