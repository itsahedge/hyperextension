import { createContext, use, useEffect, useState, type ReactNode } from "react";
import { signerKey, type AccountConfig } from "@/lib/account";
import { loadSession, type SessionState } from "@/lib/session";
import { configItem, unlockedItem, vaultItem } from "@/lib/storage";
import type { Secrets } from "@/lib/vault";

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState | null>(null);

  useEffect(() => {
    const refresh = () => void loadSession().then(setState);
    refresh();
    // Storage is the source of truth; every write anywhere re-derives state.
    const unwatch = [vaultItem.watch(refresh), configItem.watch(refresh), unlockedItem.watch(refresh)];
    return () => unwatch.forEach((stop) => stop());
  }, []);

  if (!state) return null;
  return <SessionContext value={state}>{children}</SessionContext>;
}

export function useSession(): SessionState {
  const state = use(SessionContext);
  if (!state) throw new Error("useSession outside SessionProvider");
  return state;
}

export interface Unlocked {
  config: AccountConfig;
  secrets: Secrets;
  signer: ReturnType<typeof signerKey>;
  canUserSign: boolean;
}

// For screens rendered only while unlocked.
export function useUnlocked(): Unlocked {
  const state = useSession();
  if (state.status !== "unlocked") throw new Error("Vault is locked");
  return {
    config: state.config,
    secrets: state.secrets,
    signer: signerKey(state.config, state.secrets),
    // User-signed EIP-712 actions (withdraw, usdClassTransfer, approveAgent)
    // need the master key regardless of the active signing mode.
    canUserSign: Boolean(state.secrets.masterKey),
  };
}
