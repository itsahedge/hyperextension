import { describe, expect, it } from "vitest";
import { agentDaysError, agentName, agentNameError, checkApproveAddress, MAX_AGENT_DAYS } from "./agents";

const account = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const extensionAgent = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const webAgent = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const agents = [
  { address: extensionAgent, name: "hyperext", validUntil: 1 },
  { address: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65", name: "iphone", validUntil: 1 },
];
const base = { account, activeAgent: extensionAgent, agents };

describe("agent form validation", () => {
  it("formats the approveAgent name with its expiry", () => {
    expect(agentName("  web ", 1_700_000_000_000)).toBe("web valid_until 1700000000000");
  });

  it("limits names to Hyperliquid's 16 characters", () => {
    expect(agentNameError("web")).toBeNull();
    expect(agentNameError("  ")).toMatch(/1 to 16/);
    expect(agentNameError("x".repeat(17))).toMatch(/1 to 16/);
  });

  it("limits expiry to whole days up to Hyperliquid's 180", () => {
    expect(agentDaysError(String(MAX_AGENT_DAYS))).toBeNull();
    expect(agentDaysError("0")).toMatch(/Whole days/);
    expect(agentDaysError("1.5")).toMatch(/Whole days/);
    expect(agentDaysError("181")).toMatch(/Whole days/);
  });
});

describe("checkApproveAddress", () => {
  it("accepts a new address under a new name", () => {
    expect(checkApproveAddress({ ...base, address: webAgent, name: "web" })).toEqual({ error: null, replaces: null });
  });

  it("rejects an invalid address", () => {
    expect(checkApproveAddress({ ...base, address: "0x123", name: "web" }).error).toMatch(/Invalid address/);
  });

  it("rejects the account's own address", () => {
    expect(checkApproveAddress({ ...base, address: account.toLowerCase(), name: "web" }).error).toMatch(/account itself/);
  });

  it("rejects this extension's own API wallet", () => {
    expect(checkApproveAddress({ ...base, address: extensionAgent, name: "web" }).error).toMatch(/already this extension's/);
  });

  // Approving under a name in use deregisters the wallet holding it.
  it("rejects the name this extension's API wallet is approved under", () => {
    expect(checkApproveAddress({ ...base, address: webAgent, name: " hyperext " }).error).toMatch(/would replace this extension's/);
  });

  it("reports which API wallet a reused name replaces", () => {
    expect(checkApproveAddress({ ...base, address: webAgent, name: "iphone" })).toEqual({
      error: null,
      replaces: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
    });
  });

  it("rejects an address that is already approved", () => {
    expect(checkApproveAddress({ ...base, address: "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65", name: "web" }).error).toMatch(
      /already approved as "iphone"/,
    );
  });
});
