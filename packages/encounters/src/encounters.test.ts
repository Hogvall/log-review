import { describe, expect, it } from "vitest";
import { getAbilityTip, getBoss } from "./index";

describe("encounters", () => {
  it("covers the Venomous Abyss bosses with guide links", () => {
    expect(getBoss(3445)?.name).toBe("Entombed Sentinels");
    expect(getBoss(3445)?.guideUrl).toMatch(/^https:\/\/www\.mythictrap\.com\//);
    expect(getBoss(999)).toBeNull();
  });

  it("matches ability names loosely", () => {
    expect(getAbilityTip(3445, "Helical Toxins")?.tip).toContain("4");
    expect(getAbilityTip(3445, "helical toxins")).not.toBeNull();
    expect(getAbilityTip(3470, "Soul Transfer")).not.toBeNull();
    expect(getAbilityTip(3445, "Something Else")).toBeNull();
    expect(getAbilityTip(3445, undefined)).toBeNull();
  });
});
