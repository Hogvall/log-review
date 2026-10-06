import { describe, expect, it } from "vitest";
import pull56 from "../fixtures/pull56.json";
import { buildPlayerReport, classifyDeaths, deathRecap } from "./index";

// Real data: pull #56 on Entombed Sentinels (report qxNVmdX26zP8py3A), a wipe at 34.1%.
const name = new Map(pull56.players.map((p) => [p.id, p.name]));
const abilityName = new Map(pull56.abilities.map((a) => [a.gameID, a.name]));
const opts = { fightStartTime: pull56.fight.startTime, raidSize: pull56.players.length, kill: false };

describe("classifyDeaths on a real wipe", () => {
  const { deaths, wipe } = classifyDeaths(pull56.deaths, opts);
  const categoryOf = (player: string) => deaths.filter((d) => name.get(d.targetID!) === player).map((d) => d.category);

  it("finds the raid wipe at ~4:15", () => {
    expect(wipe).not.toBeNull();
    expect(Math.round(wipe!.startMs / 100) / 10).toBe(255.6);
    expect(wipe!.deaths).toBe(15);
  });

  it("treats the lone death long before the wipe as early", () => {
    // Rentatotem died at 2:27, got a battle res, then died again in the wipe.
    expect(categoryOf("Rentatotem")).toEqual(["early", "wipe"]);
  });

  it("marks the first deaths of the wipe as possible causes", () => {
    expect(categoryOf("Cilyxb")).toEqual(["wipe-start"]);
    expect(categoryOf("Elydrieth")).toEqual(["wipe-start"]);
    expect(categoryOf("Ombreknight")).toEqual(["wipe"]);
  });

  it("ignores deaths after the wipe is over", () => {
    expect(categoryOf("Araê")).toEqual(["after-wipe"]);
  });

  it("numbers deaths in order", () => {
    expect(deaths.map((d) => d.order)).toEqual(deaths.map((_, i) => i + 1));
  });

  it("never reports a wipe on a kill", () => {
    expect(classifyDeaths(pull56.deaths, { ...opts, kill: true }).wipe).toBeNull();
  });
});

describe("deathRecap", () => {
  it("shows what hit Cilyxb before they died, including the killing ability", () => {
    const death = pull56.deaths.find((d) => d.targetID === pull56.cilyxb.id)!;
    const recap = deathRecap(death, pull56.cilyxb.damageTaken, pull56.fight.startTime);
    expect(recap.total).toBeGreaterThan(0);
    expect(recap.abilities.map((a) => a.abilityId)).toContain(death.killingAbilityGameID);
    expect(recap.lastHits.length).toBeLessThanOrEqual(5);
    expect(recap.lastHits.at(-1)!.fightTimeMs).toBeLessThanOrEqual(death.timestamp - pull56.fight.startTime);
    expect(abilityName.get(death.killingAbilityGameID!)).toBe("Shifting Protovenom");
  });
});

describe("buildPlayerReport", () => {
  const killing = pull56.deaths.find((d) => d.targetID === pull56.cilyxb.id)!.killingAbilityGameID!;
  const otherAbility = pull56.cilyxb.damageTaken.find((e) => e.abilityGameID !== killing)!.abilityGameID!;
  const report = buildPlayerReport({
    playerId: pull56.cilyxb.id,
    fightStartTime: pull56.fight.startTime,
    raidSize: pull56.players.length,
    kill: false,
    raidDeaths: pull56.deaths,
    damageTaken: pull56.cilyxb.damageTaken,
    avoidability: {
      [killing]: { classification: "avoidable", zeroShare: 0.9 },
      [otherAbility]: { classification: "avoidable", zeroShare: 0.95 },
    },
  });

  it("puts the death first and doesn't double-count the ability that killed them", () => {
    expect(report.findings[0]).toMatchObject({ kind: "death", severity: "high" });
    const avoidableIds = report.findings.flatMap((f) => (f.kind === "avoidable-damage" ? [f.ability.abilityId] : []));
    expect(avoidableIds).not.toContain(killing);
    expect(avoidableIds).toContain(otherAbility);
  });

  it("labels the killing blow with its avoidability", () => {
    expect(report.deaths[0]!.killingAvoidability).toBe("avoidable");
  });

  it("adds up damage shares to 100%", () => {
    expect(report.damageTaken.reduce((s, a) => s + a.share, 0)).toBeCloseTo(1);
  });

  it("says when there's no snapshot data", () => {
    const empty = buildPlayerReport({ ...report, playerId: 1, fightStartTime: 0, raidSize: 20, kill: false, raidDeaths: [], damageTaken: [], avoidability: {} });
    expect(empty.hasAvoidabilityData).toBe(false);
  });
});
