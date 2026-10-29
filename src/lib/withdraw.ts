import { getAddress, isAddress, type Address } from "viem";

export interface AllowedAddress {
  address: Address;
  label: string;
  addedAt: number;
}

export const MAX_LABEL = 24;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// Where withdrawals may go: the account's own address, then the allowlist.
// The allowlist lives in the encrypted vault, so changing it requires a
// passkey or password (updateVault).
export function withdrawDestinations(own: Address, list: AllowedAddress[] = []): { address: Address; label: string }[] {
  return [{ address: own, label: "This account" }, ...list.filter((a) => !same(a.address, own))];
}

export function isAllowedDestination(destination: string, own: Address, list: AllowedAddress[] = []): boolean {
  return withdrawDestinations(own, list).some((d) => same(d.address, destination));
}

// Checked again at send time, independent of the UI.
export function assertWithdrawDestination(destination: string, own: Address, list: AllowedAddress[] = []): Address {
  if (!isAddress(destination)) throw new Error("Invalid address");
  if (!isAllowedDestination(destination, own, list)) {
    throw new Error("Destination is not on the withdrawal allowlist. Add it in Settings first.");
  }
  return getAddress(destination);
}

export function addAllowed(list: AllowedAddress[], own: Address, input: { address: string; label: string }, now = Date.now()): AllowedAddress[] {
  const address = input.address.trim();
  const label = input.label.trim();
  if (!isAddress(address)) throw new Error("Invalid address");
  if (same(address, own)) throw new Error("This account's address is always allowed");
  if (list.some((a) => same(a.address, address))) throw new Error("Address is already on the allowlist");
  if (label.length === 0 || label.length > MAX_LABEL) throw new Error(`Label must be 1 to ${MAX_LABEL} characters`);
  return [...list, { address: getAddress(address), label, addedAt: now }];
}

export function removeAllowed(list: AllowedAddress[], address: string): AllowedAddress[] {
  return list.filter((a) => !same(a.address, address));
}
