import { describe, expect, it } from "vitest";
import { parseReportUrl } from "./url";

const CODE = "AbCdEf1234567890";

describe("parseReportUrl", () => {
  it("accepts a bare code", () => {
    expect(parseReportUrl(`  ${CODE} `)).toEqual({ code: CODE });
  });

  it("reads fight and source from the hash", () => {
    expect(parseReportUrl(`https://www.warcraftlogs.com/reports/${CODE}#fight=5&source=12&type=damage-done`)).toEqual({
      code: CODE,
      fight: 5,
      source: 12,
    });
  });

  it("reads fight=last from the query string", () => {
    expect(parseReportUrl(`https://www.warcraftlogs.com/reports/${CODE}?fight=last`)).toEqual({ code: CODE, fight: "last" });
  });

  it("accepts links without a scheme", () => {
    expect(parseReportUrl(`warcraftlogs.com/reports/${CODE}`)).toEqual({ code: CODE });
  });

  it("rejects other sites and malformed codes", () => {
    expect(parseReportUrl(`https://example.com/reports/${CODE}`)).toBeNull();
    expect(parseReportUrl("https://www.warcraftlogs.com/reports/short")).toBeNull();
    expect(parseReportUrl("hello")).toBeNull();
  });
});
