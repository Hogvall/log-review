import { describe, expect, it } from "vitest";
import {
  type PlayerPerformance,
  type SpecBenchmark,
  aliveTime,
  buildPlayerReport,
  compareToBenchmark,
  rankFixes,
} from "./index";

const s = (median: number, p25 = median * 0.9, p75 = median * 1.1, usedBy = 1) => ({ median, p25, p75, n: 15, usedBy });

const bench: SpecBenchmark = {
  sampleSize: 15,
  insufficient: false,
  amount: s(200_000),
  durationMs: s(300_000),
  itemLevel: s(330),
  activeTimePct: s(0.98, 0.97, 0.99),
  cpm: {
    100: s(30), // filler
    200: s(1, 0.95, 1.05), // big cooldown
    300: s(2, 1.8, 2.2, 0.9), // talented cooldown most people take (has a buff)
    400: s(0.5, 0.45, 0.55), // movement spell: no damage, no meaningful buff
  },
  buffUptime: { 200: s(0.25, 0.22, 0.28), 300: s(0.2, 0.18, 0.22), 999: s(0.1, 0.05, 0.15) },
  dtps: {},
  targetShare: { Boss: s(0.8), Add: s(0.2, 0.15, 0.25) },
  deathRate: 0,
};

const player: PlayerPerformance = {
  amount: 150_000,
  durationMs: 300_000,
  aliveMs: 300_000,
  itemLevel: 325,
  activeTimeMs: 0.88 * 300_000,
  casts: { 100: 150, 200: 2 }, // 30 cpm filler (fine), 0.4 cpm cooldown (low), never cast 300
  damageByAbility: { 100: 15_000_000, 200: 6_000_000 },
  buffUptime: { 200: 0.1, 999: 0 },
  targetShare: { Boss: 0.97, Add: 0.03 },
};

describe("compareToBenchmark", () => {
  const c = compareToBenchmark(player, bench);
  const ability = (id: number) => c.abilities.find((a) => a.abilityId === id)!;

  it("compares DPS against the median", () => {
    expect(c.amount?.ratio).toBe(0.75);
  });

  it("flags a cooldown cast far less often, with an estimated gain", () => {
    expect(ability(100).status).toBe("ok");
    expect(ability(200).status).toBe("low");
    // 0.6 missed casts/min × 5 min = 3 casts × 3M per cast / 300 s = 30,000 DPS
    expect(ability(200).estDpsGain).toBeCloseTo(30_000);
  });

  it("flags an ability nearly every top player casts but you never did", () => {
    expect(ability(300).status).toBe("missing");
    expect(c.findings.some((f) => f.kind === "missing-ability" && f.ability.abilityId === 300)).toBe(true);
  });

  it("leaves utility spells out of the findings but still shows them", () => {
    expect(ability(400).status).toBe("missing");
    expect(c.findings.some((f) => (f.kind === "missing-ability" || f.kind === "low-casts") && f.ability.abilityId === 400)).toBe(false);
  });

  it("flags low active time with an estimate", () => {
    const f = c.findings.find((x) => x.kind === "low-active-time");
    expect(f?.kind === "low-active-time" && f.estDpsGain).toBeCloseTo(150_000 * (0.98 / 0.88 - 1));
  });

  it("only calls out uptime on buffs you cast yourself", () => {
    expect(c.findings.some((f) => f.kind === "low-buff-uptime" && f.buff.abilityId === 200)).toBe(true);
    expect(c.buffs.find((b) => b.abilityId === 999)?.selfCast).toBe(false);
    expect(c.findings.some((f) => f.kind === "low-buff-uptime" && f.buff.abilityId === 999)).toBe(false);
  });

  it("flags neglected adds but never the main boss", () => {
    expect(c.targets.find((t) => t.target === "Boss")?.status).toBe("ok");
    expect(c.findings.some((f) => f.kind === "low-target-share" && f.target.target === "Add")).toBe(true);
  });

  it("orders findings by estimated gain", () => {
    // Missed cooldowns (~30k) outweigh downtime (~17k).
    expect(c.findings.map((f) => f.kind).slice(0, 2)).toEqual(["low-casts", "low-active-time"]);
  });

  it("judges casts against time alive", () => {
    const dead = compareToBenchmark({ ...player, aliveMs: 60_000, casts: { 100: 30, 200: 1, 300: 2 } }, bench);
    expect(dead.abilities.find((a) => a.abilityId === 100)?.status).toBe("ok");
  });
});

describe("aliveTime", () => {
  it("counts until the last death", () => {
    expect(aliveTime(300_000, [])).toBe(300_000);
    expect(aliveTime(300_000, [100_000, 250_000])).toBe(250_000);
  });
});

describe("rankFixes", () => {
  it("puts deaths first, then big DPS gains, then avoidable damage", () => {
    const report = buildPlayerReport({
      playerId: 1,
      fightStartTime: 0,
      raidSize: 20,
      kill: true,
      raidDeaths: [{ timestamp: 100_000, targetID: 1, killingAbilityGameID: 5 }],
      damageTaken: [1, 2, 3].map((i) => ({ timestamp: i * 1000, type: "damage", abilityGameID: 7, amount: 1000 })),
      avoidability: { 7: { classification: "avoidable", zeroShare: 0.95 } },
    });
    const fixes = rankFixes(report, compareToBenchmark(player, bench));
    expect(fixes[0]).toMatchObject({ source: "report", finding: { kind: "death" } });
    expect(fixes[1]).toMatchObject({ source: "perf", finding: { kind: "low-casts" } });
    expect(fixes[2]).toMatchObject({ source: "perf", finding: { kind: "low-active-time" } });
    const avoidableIndex = fixes.findIndex((f) => f.source === "report" && f.finding.kind === "avoidable-damage");
    const missingIndex = fixes.findIndex((f) => f.source === "perf" && f.finding.kind === "missing-ability");
    expect(avoidableIndex).toBeLessThan(missingIndex);
  });
});
