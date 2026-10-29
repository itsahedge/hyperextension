import { describe, expect, it } from "vitest";
import { fmtPct, fmtPrice, fmtRate, fmtSignedUsd, fmtSize, fmtUsd, shortAddress, toneOf } from "./format";

describe("format", () => {
  it("formats USD from API decimal strings", () => {
    expect(fmtUsd("1234.567")).toBe("$1,234.57");
    expect(fmtSignedUsd("-12.5")).toBe("-$12.50");
    expect(fmtSignedUsd("3")).toBe("+$3.00");
    expect(fmtSignedUsd("0")).toBe("$0.00");
  });

  it("formats fractions as signed percentages", () => {
    expect(fmtPct("0.0125")).toBe("+1.25%");
    expect(fmtPct(-0.5)).toBe("-50%");
  });

  it("keeps funding precision", () => {
    expect(fmtRate("0.0000125")).toBe("+0.0013%");
    expect(fmtRate("-0.0001")).toBe("-0.0100%");
    expect(fmtRate("0")).toBe("0.0000%");
  });

  it("keeps small prices readable", () => {
    expect(fmtPrice("0.000012345678")).toBe("0.0000123457");
    expect(fmtPrice("97123.456")).toBe("97,123.5");
    expect(fmtPrice("abc")).toBe("-");
  });

  it("formats sizes and addresses", () => {
    expect(fmtSize("0.123456789")).toBe("0.123457");
    expect(shortAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
  });

  it("maps sign to tone classes", () => {
    expect(toneOf("1")).toBe("text-up");
    expect(toneOf("-1")).toBe("text-down");
    expect(toneOf("0")).toBe("text-muted");
  });
});
