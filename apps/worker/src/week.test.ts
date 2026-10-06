import { describe, expect, it } from "vitest";
import { isoWeek } from "./week";

describe("isoWeek", () => {
  it("labels mid-year dates", () => {
    expect(isoWeek(new Date("2026-10-07T06:00:00Z"))).toBe("2026-W41");
  });

  it("handles weeks that cross the year boundary", () => {
    expect(isoWeek(new Date("2027-01-01T00:00:00Z"))).toBe("2026-W53");
    expect(isoWeek(new Date("2025-12-29T00:00:00Z"))).toBe("2026-W01");
  });
});
