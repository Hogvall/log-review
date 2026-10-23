import { describe, expect, it } from "vitest";
import { meleeIsTankMechanic } from "./benchmark";
import { type PullDamageTaken, pullDamageTaken, raidDamageTaken } from "./raid-damage";

const hit = (targetID: number, abilityGameID: number, amount: number, absorbed = 0) => ({ type: "damage", targetID, abilityGameID, amount, absorbed });

describe("pullDamageTaken", () => {
  it("sums hits per player and ability, counting absorbs and skipping non-players", () => {
    const pull = pullDamageTaken(
      7,
      [hit(1, 100, 50, 10), hit(1, 100, 40), hit(2, 200, 30), hit(99, 100, 1000), { type: "absorbed", targetID: 1, abilityGameID: 100, amount: 5 }],
      new Set([1, 2]),
    );
    expect(pull).toEqual({ pullId: 7, byPlayer: { 1: { 100: { hits: 2, total: 100 } }, 2: { 200: { hits: 1, total: 30 } } } });
  });
});

describe("raidDamageTaken", () => {
  const pulls: PullDamageTaken[] = [
    { pullId: 1, byPlayer: { 1: { 100: { hits: 2, total: 100 }, 300: { hits: 1, total: 400 } }, 2: { 100: { hits: 1, total: 50 } } } },
    { pullId: 2, byPlayer: { 1: { 300: { hits: 1, total: 400 } }, 3: { 300: { hits: 1, total: 400 } } } },
  ];
  const avoidability = { 100: { classification: "avoidable" as const }, 300: { classification: "unavoidable" as const } };

  it("ranks abilities by damage and players by avoidable damage", () => {
    const r = raidDamageTaken(pulls, avoidability, avoidability, new Set());
    expect(r.total).toBe(1350);
    expect(r.avoidable).toBe(150);
    expect(r.abilities.map((a) => [a.abilityId, a.total, a.pulls])).toEqual([
      [300, 1200, 2],
      [100, 150, 1],
    ]);
    expect(r.abilities[1]!.players.map((p) => p.playerId)).toEqual([1, 2]);
    expect(r.players.map((p) => [p.playerId, p.avoidable, p.avoidableHits, p.pulls])).toEqual([
      [1, 100, 2, 2],
      [2, 50, 1, 1],
      [3, 0, 0, 1],
    ]);
    expect(r.players[0]!.avoidablePerPull).toBe(50);
  });

  it("judges tanks by the tank view", () => {
    const tank = { 100: { classification: "tank-mechanic" as const } };
    const r = raidDamageTaken(pulls, avoidability, tank, new Set([1]));
    expect(r.players.find((p) => p.playerId === 1)!.avoidable).toBe(0);
    expect(r.avoidable).toBe(50);
  });
});

describe("boss melee and tank-heavy abilities", () => {
  const avoidability = meleeIsTankMechanic({ 1: { classification: "avoidable" as const }, 200: { classification: "avoidable" as const } });
  const tank = meleeIsTankMechanic({ 1: { classification: "tank-mechanic" as const }, 200: { classification: "tank-mechanic" as const } });

  it("never counts boss melee as avoidable, even for a DPS (the tank was probably dead)", () => {
    expect(avoidability[1]!.classification).toBe("tank-mechanic");
    const r = raidDamageTaken([{ pullId: 1, byPlayer: { 5: { 1: { hits: 3, total: 900 } } } }], avoidability, tank, new Set());
    expect(r.avoidable).toBe(0);
    expect(r.abilities[0]!.classification).toBe("tank-mechanic");
  });

  it("labels an ability by the tanks' view when tanks took most of it, and counts only the avoidable part", () => {
    const r = raidDamageTaken(
      [{ pullId: 1, byPlayer: { 7: { 200: { hits: 10, total: 1000 } }, 5: { 200: { hits: 1, total: 100 } } } }],
      avoidability,
      tank,
      new Set([7]),
    );
    const a = r.abilities[0]!;
    expect(a.classification).toBe("tank-mechanic");
    expect(a.tankShare).toBeCloseTo(1000 / 1100);
    // The DPS standing in the tank buster still counts.
    expect(a.avoidable).toBe(100);
  });
});
