import { useMemo, useState, type FormEvent } from "react";
import { Button, Notice, Segmented, TextField, errorMessage } from "@/components/ui";
import { addressOf, parseAddress, parsePrivateKey, type Network, type SignerMode } from "@/lib/account";
import { createVault } from "@/lib/session";

export const MIN_PASSWORD = 8;

export function Setup() {
  const [mode, setMode] = useState<SignerMode>("master");
  const [network, setNetwork] = useState<Network>("mainnet");
  const [key, setKey] = useState("");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const keyAddress = useMemo(() => {
    try {
      return addressOf(parsePrivateKey(key));
    } catch {
      return null;
    }
  }, [key]);

  const passwordError =
    password && password.length < MIN_PASSWORD
      ? `At least ${MIN_PASSWORD} characters`
      : confirm && confirm !== password
        ? "Passwords do not match"
        : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (passwordError || !password) return;
    setBusy(true);
    try {
      const parsedKey = parsePrivateKey(key);
      if (mode === "master") {
        await createVault({ address: addressOf(parsedKey), mode, network }, { masterKey: parsedKey }, password);
      } else {
        await createVault({ address: parseAddress(account), mode, network }, { agentKey: parsedKey }, password);
      }
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div>
        <h1 className="text-lg font-semibold">Set up Hyperextension</h1>
        <p className="mt-1 text-xs text-muted">
          Keys are encrypted with your password and never leave this browser. The extension only talks to
          Hyperliquid's API.
        </p>
      </div>

      <Segmented
        label="Signing key"
        value={mode}
        onChange={setMode}
        options={[
          { value: "master", label: "Master key" },
          { value: "agent", label: "API wallet" },
        ]}
      />

      {mode === "agent" && (
        <Notice tone="info">
          An API wallet can trade but cannot withdraw or move funds off the account. Approve it on Hyperliquid first, or
          import your master key now and create one later in Settings.
        </Notice>
      )}

      <TextField
        label={mode === "master" ? "Account private key" : "API wallet private key"}
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={key}
        onChange={(e) => setKey(e.target.value)}
        hint={keyAddress ? `Signer address ${keyAddress}` : "64 hex characters, with or without 0x"}
      />

      {mode === "agent" && (
        <TextField
          label="Account address (master)"
          autoComplete="off"
          spellCheck={false}
          placeholder="0x…"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          hint="Balances and positions are read from this address, not the API wallet's."
        />
      )}

      <Segmented
        label="Network"
        value={network}
        onChange={setNetwork}
        options={[
          { value: "mainnet", label: "Mainnet" },
          { value: "testnet", label: "Testnet" },
        ]}
      />

      <TextField
        label="Password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <TextField
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={passwordError}
      />

      {error && <Notice tone="error">{error}</Notice>}

      <Button
        type="submit"
        variant="primary"
        busy={busy}
        disabled={!key || !password || !confirm || Boolean(passwordError) || (mode === "agent" && !account)}
      >
        Encrypt and save
      </Button>
    </form>
  );
}
