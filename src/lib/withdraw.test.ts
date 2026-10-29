import { describe, expect, it } from "vitest";
import { addAllowed, assertWithdrawDestination, isAllowedDestination, removeAllowed, withdrawDestinations } from "./withdraw";

const OWN = "0x1111111111111111111111111111111111111111" as const;
const COLD = "0x2222222222222222222222222222222222222222";
const OTHER = "0x3333333333333333333333333333333333333333";

describe("withdrawal allowlist", () => {
  it("always allows the account's own address and nothing else by default", () => {
    expect(withdrawDestinations(OWN)).toEqual([{ address: OWN, label: "This account" }]);
    expect(isAllowedDestination(OWN.toUpperCase().replace("0X", "0x"), OWN)).toBe(true);
    expect(isAllowedDestination(COLD, OWN)).toBe(false);
  });

  it("allows added addresses, case-insensitively, and returns checksummed", () => {
    const list = addAllowed([], OWN, { address: COLD, label: " Cold wallet " }, 5);
    expect(list).toEqual([{ address: COLD, label: "Cold wallet", addedAt: 5 }]);
    expect(assertWithdrawDestination(COLD.toUpperCase().replace("0X", "0x"), OWN, list)).toBe(COLD);
    expect(() => assertWithdrawDestination(OTHER, OWN, list)).toThrow(/not on the withdrawal allowlist/);
  });

  it("rejects bad input, duplicates, and the own address", () => {
    const list = addAllowed([], OWN, { address: COLD, label: "Cold" });
    expect(() => addAllowed(list, OWN, { address: "0xnope", label: "x" })).toThrow(/Invalid/);
    expect(() => addAllowed(list, OWN, { address: COLD, label: "again" })).toThrow(/already/);
    expect(() => addAllowed(list, OWN, { address: OWN, label: "me" })).toThrow(/always allowed/);
    expect(() => addAllowed(list, OWN, { address: OTHER, label: "" })).toThrow(/Label/);
    expect(() => assertWithdrawDestination("0xnope", OWN, list)).toThrow(/Invalid/);
  });

  it("removes by address", () => {
    const list = addAllowed(addAllowed([], OWN, { address: COLD, label: "Cold" }), OWN, { address: OTHER, label: "Other" });
    expect(removeAllowed(list, COLD.toLowerCase()).map((a) => a.label)).toEqual(["Other"]);
  });
});
