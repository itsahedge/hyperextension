import { describe, expect, it } from "vitest";
import { floorSize, parsePositive, sizeAtFraction, toPlain, usdToBase } from "./sizing";

describe("sizing", () => {
  it("floors to the lot size and returns null instead of throwing at zero", () => {
    expect(floorSize(12.3456789, 3)).toBe("12.345");
    expect(floorSize(0.001, 2)).toBeNull();
    expect(floorSize(0, 2)).toBeNull();
    expect(floorSize(Number.NaN, 2)).toBeNull();
  });

  it("never emits exponent notation", () => {
    expect(toPlain(1e-7)).toBe("0.0000001");
    expect(toPlain(123456789.5)).toBe("123456789.5");
  });

  it("parses only positive finite numbers", () => {
    expect(parsePositive(" 1.5 ")).toBe(1.5);
    expect(parsePositive("")).toBeNull();
    expect(parsePositive("0")).toBeNull();
    expect(parsePositive("-2")).toBeNull();
    expect(parsePositive("abc")).toBeNull();
  });

  it("sizes a clamped fraction of the max", () => {
    expect(sizeAtFraction(10, 0.333, 2)).toBe("3.33");
    expect(sizeAtFraction(10, 2, 2)).toBe("10");
    expect(sizeAtFraction(10, 0, 2)).toBe("");
  });

  it("converts USD to base at a price", () => {
    expect(usdToBase(1000, 40, 2)).toBe("25");
    expect(usdToBase(1000, 0, 2)).toBe("");
  });
});
