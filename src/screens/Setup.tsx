import { useMemo, useState, type FormEvent } from "react";
import { generatePrivateKey } from "viem/accounts";
import { Button, Notice, Segmented, TextField, errorMessage } from "@/components/ui";
import { addressOf, parseAddress, parsePrivateKey, type Network, type SignerMode } from "@/lib/account";
import { createPasskeyVault, createVault } from "@/lib/session";
import { platform } from "@/platform";

export const MIN_PASSWORD = 8;

export function Setup() {
  // The web app stores only an API wallet (session.validateVault).
  const [mode, setMode] = useState<SignerMode>(platform.storesMasterKey ? "master" : "agent");
  const [generated, setGenerated] = useState(false);
  const [network, setNetwork] = useState<Network>("mainnet");
  const [key, setKey] = useState("");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  // Passkey-only setup (web app): the passkey's name in Settings and the password manager.
  const [passkeyLabel, setPasskeyLabel] = useState("This device");
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
    if (!platform.passwordless && (passwordError || !password)) return;
    setBusy(true);
    try {
      const parsedKey = parsePrivateKey(key);
      if (platform.passwordless) {
        await createPasskeyVault({ address: parseAddress(account), mode, network }, { agentKey: parsedKey }, passkeyLabel.trim());
      } else if (mode === "master") {
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
          Keys are encrypted with your {platform.passwordless ? "passkey" : "password"} and never leave this browser. {platform.kind === "web" ? "This app" : "The extension"}{" "}
          only talks to Hyperliquid's API.
        </p>
      </div>

      {platform.storesMasterKey ? (
        <Segmented
          label="Signing key"
          value={mode}
          onChange={setMode}
          options={[
            { value: "master", label: "Master key" },
            { value: "agent", label: "API wallet" },
          ]}
        />
      ) : (
        <Notice tone="info">
          This app holds only an API wallet: it can trade but cannot withdraw or move funds off the account. Generate one
          here and approve its address in the extension (Settings → API wallet → Approve an API wallet address), so the
          key never leaves this device.
        </Notice>
      )}

      {mode === "agent" && platform.storesMasterKey && (
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
        onChange={(e) => {
          setKey(e.target.value);
          setGenerated(false);
        }}
        hint={keyAddress ? `Signer address ${keyAddress}` : "64 hex characters, with or without 0x"}
      />

      {!platform.storesMasterKey && (
        <Button
          type="button"
          onClick={() => {
            setKey(generatePrivateKey());
            setGenerated(true);
          }}
        >
          Generate a new API wallet
        </Button>
      )}
      {generated && keyAddress && (
        <Notice tone="warn">
          Approve {keyAddress} in the extension before trading. Until then Hyperliquid rejects its orders.
        </Notice>
      )}

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

      {platform.passwordless ? (
        <TextField
          label="Passkey name"
          autoComplete="off"
          value={passkeyLabel}
          onChange={(e) => setPasskeyLabel(e.target.value)}
          hint="Unlock with Face ID, Touch ID or another passkey; there is no password. Needs a provider with PRF support, such as iCloud Keychain or Google Password Manager. If you lose the passkey, reset and set up a new API wallet."
        />
      ) : (
        <>
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
        </>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      <Button
        type="submit"
        variant="primary"
        busy={busy}
        disabled={
          !key ||
          (mode === "agent" && !account) ||
          (platform.passwordless ? !passkeyLabel.trim() : !password || !confirm || Boolean(passwordError))
        }
      >
        {platform.passwordless ? "Create passkey and save" : "Encrypt and save"}
      </Button>
    </form>
  );
}
