import { describe, expect, it } from "vitest";
import { type NightDeath, type NightPull, bestPulls, deathCause, dpsCheck, nightDeaths } from "./index";

const MARK_BLOOD = { id: 1284506, name: "Mark of Blood" };
const MARK_ACID = { id: 1284500, name: "Mark of Acid" };
const DROPLETS = { id: 1284451, name: "Toxic Droplets" };
const BLOOD_VENOM = { id: 1284210, name: "Blood Venom" };

const pull = (id: number, startTime: number, durationMs: number, bossPercentage: number): NightPull => ({
  id,
  startTime,
  endTime: startTime + durationMs,
  kill: false,
  bossPercentage,
  raidSize: 20,
});

const death = (fight: number, timestamp: number, playerId: number, window: { id: number; name: string; total: number }[], killingBlow = window[0]!): NightDeath => ({
  fight,
  timestamp,
  playerId,
  name: `P${playerId}`,
  killingBlow: { id: killingBlow.id, name: killingBlow.name },
  window,
});

describe("deathCause", () => {
  it("is what did the most damage, not the killing blow", () => {
    // Ombreknight (pull 34): killed by a Blood Venom tick, but Mark of Blood did most of the damage.
    const d = death(48, 0, 7, [{ ...BLOOD_VENOM, total: 58_866 }, { ...MARK_BLOOD, total: 680_540 }]);
    expect(deathCause(d)).toEqual(MARK_BLOOD);
    expect(deathCause({ ...d, window: [] })).toEqual(BLOOD_VENOM);
  });

  it("adds up a spell logged under two IDs before picking the biggest", () => {
    const d = death(48, 0, 7, [{ ...MARK_BLOOD, total: 500_000 }, { id: 1, name: "Cultivated Burst", total: 300_000 }, { id: 2, name: "Cultivated Burst", total: 300_000 }]);
    expect(deathCause(d)?.name).toBe("Cultivated Burst");
  });
});

describe("nightDeaths", () => {
  // Four real pulls and one reset. Each real pull: an early Marks death, then a wipe of 6 at the end.
  const pulls = [pull(1, 0, 20_000, 90), ...[2, 3, 4, 5].map((id) => pull(id, id * 1_000_000, 300_000, 40 - id * 5))];
  const deaths: NightDeath[] = [];
  for (const p of pulls.slice(1)) {
    const marks = [{ ...MARK_BLOOD, total: 700_000 }, { ...MARK_ACID, total: 300_000 }];
    deaths.push(death(p.id, p.startTime + 120_000, 1, marks));
    // Pull 5: a droplet death too, early.
    if (p.id === 5) deaths.push(death(p.id, p.startTime + 150_000, 2, [{ ...DROPLETS, total: 900_000 }]));
    for (let i = 0; i < 6; i++) deaths.push(death(p.id, p.startTime + 290_000 + i * 500, 10 + i, [{ ...MARK_ACID, total: 500_000 }]));
  }
  deaths.push(death(1, 10_000, 3, [{ ...DROPLETS, total: 1 }])); // in the reset: ignored
  const night = nightDeaths(pulls, deaths);

  it("skips resets and counts deaths that mattered", () => {
    expect(night.pullsCounted).toBe(4);
    expect(night.resets).toBe(1);
    expect(night.total).toBe(4 + 1 + 24);
  });

  it("ranks causes by deaths that mattered, with who, how often, the paired mechanic and the trend", () => {
    // Mark of Acid starts every wipe, so its first deaths there outrank one early Mark of Blood death per pull.
    expect(night.causes.map((c) => c.abilityId).slice(0, 2)).toEqual([MARK_ACID.id, MARK_BLOOD.id]);
    const top = night.causes.find((c) => c.abilityId === MARK_BLOOD.id)!;
    expect(top).toMatchObject({ abilityId: MARK_BLOOD.id, mattered: 4, pulls: 4 });
    expect(top.players).toEqual([{ playerId: 1, name: "P1", count: 4, lastFight: 5 }]);
    expect(top.often).toMatchObject({ abilityId: MARK_ACID.id, count: 4 });
    expect([top.firstHalfRate, top.secondHalfRate]).toEqual([1, 1]);

    // Mark of Acid: 24 deaths in the wipes, of which only the first deaths of each wipe matter.
    const acid = night.causes.find((c) => c.abilityId === MARK_ACID.id)!;
    expect(acid.all).toBe(24);
    expect(acid.mattered).toBeGreaterThan(4);
    expect(acid.mattered).toBeLessThan(24);

    const droplets = night.causes.find((c) => c.abilityId === DROPLETS.id)!;
    expect([droplets.mattered, droplets.firstHalfRate, droplets.secondHalfRate]).toEqual([1, 0, 0.5]);
    expect(night.firstDeathMedianMs).toBe(120_000);
  });
});

describe("dpsCheck", () => {
  // Boss with 1,000M health. Best pulls: 7:12 at 3%, 6:44 at 7%, 4:37 at 34%.
  const health = 1_000_000_000;
  const at = (pullId: number, durationMs: number, bossPercentage: number) => ({
    pullId,
    durationMs,
    bossPercentage,
    bossDamage: health * (1 - bossPercentage / 100),
  });
  const pulls = [at(34, 432_000, 3), at(41, 404_000, 7), at(42, 277_000, 34)];
  const kills = (median: number) => Array.from({ length: 20 }, (_, i) => median - 50_000 + i * 5000);

  it("estimates boss health and projects a kill time from each pull's damage rate", () => {
    const c = dpsCheck(pulls, kills(330_000));
    expect(c.bossHealth).toBeCloseTo(health, -3);
    expect(c.pulls[0]!.projectedKillMs).toBeCloseTo(432_000 / 0.97, -2);
    expect(c.projectedKillMs).toBeCloseTo(c.pulls[1]!.projectedKillMs!, -2);
  });

  it("says short, close or enough against the slower quarter of real kills", () => {
    // Projected ~7:14 (434s). Kills: median 5:57, p75 ~6:20 → short by ~14%.
    const short = dpsCheck(pulls, kills(357_000));
    expect(short.verdict).toBe("short");
    expect(short.neededIncrease).toBeCloseTo(434_400 / short.reference!.p75 - 1, 2);
    expect(dpsCheck(pulls, kills(400_000)).verdict).toBe("close");
    expect(dpsCheck(pulls, kills(450_000))).toMatchObject({ verdict: "enough", neededIncrease: null });
    expect(dpsCheck(pulls, kills(450_000).slice(0, 5)).verdict).toBe("unknown");
  });

  it("checks the furthest real pulls", () => {
    const night = [pull(1, 0, 20_000, 1), pull(2, 1e6, 300_000, 40), pull(3, 2e6, 400_000, 7), pull(4, 3e6, 430_000, 3)];
    expect(bestPulls(night, 2).map((p) => p.id)).toEqual([4, 3]);
  });
});
