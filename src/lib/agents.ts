import { isAddress, isAddressEqual, type Address } from "viem";

// Hyperliquid caps API wallet expiry at 180 days and names at 16 characters.
export const MAX_AGENT_DAYS = 180;
export const MAX_AGENT_NAME = 16;
export const DAY_MS = 86_400_000;

// approveAgent's name field carries the expiry: "<name> valid_until <ms>".
export const agentName = (name: string, validUntil: number) => `${name.trim()} valid_until ${validUntil}`;

export function agentNameError(name: string): string | null {
  const n = name.trim().length;
  return n === 0 || n > MAX_AGENT_NAME ? `1 to ${MAX_AGENT_NAME} characters` : null;
}

export function agentDaysError(days: string): string | null {
  const d = Number(days);
  return !Number.isInteger(d) || d < 1 || d > MAX_AGENT_DAYS ? `Whole days, 1 to ${MAX_AGENT_DAYS}` : null;
}

export interface ApprovedAgent {
  address: string;
  name: string;
}

// Approving an API wallet whose key lives elsewhere (the web app generates
// its own and shows only the address). Approving under a name already in use
// deregisters the wallet that holds it, so this extension's own name is refused
// and any other reuse is reported.
export function checkApproveAddress(input: {
  address: string;
  name: string;
  account: Address;
  activeAgent: Address | null;
  agents: ApprovedAgent[];
}): { error: string | null; replaces: string | null } {
  const fail = (error: string) => ({ error, replaces: null });
  const address = input.address.trim();
  if (!isAddress(address, { strict: false })) return fail("Invalid address");
  if (isAddressEqual(address, input.account)) return fail("That is the trading account itself, not an API wallet");
  if (input.activeAgent && isAddressEqual(address, input.activeAgent)) return fail("That is already this extension's API wallet");
  const existing = input.agents.find((a) => isAddressEqual(a.address as Address, address));
  if (existing) return fail(`That address is already approved as "${existing.name}"`);
  const name = input.name.trim();
  const own = input.agents.find((a) => input.activeAgent && isAddressEqual(a.address as Address, input.activeAgent));
  if (own && own.name === name) return fail(`"${name}" would replace this extension's API wallet; pick another name`);
  return { error: null, replaces: input.agents.find((a) => a.name === name)?.address ?? null };
}
