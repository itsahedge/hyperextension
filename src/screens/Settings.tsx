import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { generatePrivateKey } from "viem/accounts";
import { AuthorizeDialog } from "@/components/AuthorizeDialog";
import { Badge, Button, Card, ConfirmDialog, Empty, Loading, Notice, Segmented, TextField, errorMessage } from "@/components/ui";
import { useAgents, usePrefs } from "@/hooks/queries";
import { useUnlocked } from "@/hooks/session";
import { addressOf, parseAddress, parsePrivateKey, type Network, type SignerMode } from "@/lib/account";
import { agentDaysError, agentName, agentNameError, checkApproveAddress, DAY_MS, MAX_AGENT_DAYS } from "@/lib/agents";
import { AUTO_LOCK_CHOICES } from "@/lib/autolock";
import { fmtTime, shortAddress } from "@/lib/format";
import { updatePrefs } from "@/lib/prefs";
import { addAllowed, MAX_LABEL, removeAllowed, type AllowedAddress } from "@/lib/withdraw";
import { exchangeClient } from "@/lib/hyperliquid";
import { enrollPasskey, lock, removePasskey, setSigningMode, updateConfig, updateVault, wipe, withMasterKey, type Auth } from "@/lib/session";
import { platform } from "@/platform";
import { VpnCard } from "./settings/VpnCard";

// The web app holds no master key, so it has no withdrawals to allowlist.
const appName = platform.kind === "web" ? "app" : "extension";

export function Settings() {
  return (
    <div className="flex flex-col gap-3">
      <AccountCard />
      <PasskeyCard />
      {platform.storesMasterKey && <WithdrawAllowlistCard />}
      {platform.vpn && <VpnCard />}
      <AgentCard />
      <SecurityCard />
    </div>
  );
}

function AccountCard() {
  const { config, secrets, canUserSign } = useUnlocked();
  const [error, setError] = useState<string | null>(null);
  const [toMaster, setToMaster] = useState(false);
  const apply = (patch: { network?: Network; mode?: SignerMode }) => {
    setError(null);
    // In API-wallet mode the master key is not in the session; master mode
    // loads it there as the signer, so that switch re-authorizes.
    if (patch.mode === "master" && !secrets.masterKey) {
      setToMaster(true);
      return;
    }
    updateConfig(patch).catch((err) => setError(errorMessage(err)));
  };

  return (
    <Card title="Account">
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-[11px] text-muted">Trading account</p>
          <p className="font-mono text-[11px] break-all">{config.address}</p>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">Network</span>
          <Segmented
            label="Network"
            value={config.network}
            onChange={(network) => apply({ network })}
            options={[
              { value: "mainnet", label: "Mainnet" },
              { value: "testnet", label: "Testnet" },
            ]}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">Sign trades with</span>
          <Segmented
            label="Signing mode"
            value={config.mode}
            onChange={(mode) => apply({ mode })}
            options={[
              { value: "master", label: "Master key", disabled: !canUserSign },
              { value: "agent", label: "API wallet", disabled: !secrets.agentKey },
            ]}
          />
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
      <AuthorizeDialog
        open={toMaster}
        onClose={() => setToMaster(false)}
        title="Sign trades with the master key"
        description="Trades will be signed with the master key, which stays unlocked in this browser session until you lock."
        confirmLabel="Switch"
        onAuthorized={(auth) => setSigningMode(auth, "master")}
      />
    </Card>
  );
}

function AgentCard() {
  const { secrets, canUserSign, config } = useUnlocked();
  const agents = useAgents();
  const activeAgent = secrets.agentKey ? addressOf(secrets.agentKey) : null;
  const approved = agents.data?.find((a) => a.address.toLowerCase() === activeAgent?.toLowerCase());

  return (
    <Card title="API wallet">
      <div className="flex flex-col gap-3">
        {activeAgent ? (
          <div className="flex flex-col gap-1 text-xs">
            <span className="text-muted">Stored API wallet</span>
            <span className="font-mono text-[11px] break-all">{activeAgent}</span>
            {agents.isSuccess &&
              (approved ? (
                <span className="text-up">
                  Approved as "{approved.name}"
                  {approved.validUntil ? `, expires ${fmtTime(approved.validUntil)}` : ""}
                </span>
              ) : (
                <span className="text-warn">Not in this account's named API wallets on {config.network}</span>
              ))}
          </div>
        ) : (
          <p className="text-xs text-muted">No API wallet stored. Trades are signed with the master key.</p>
        )}

        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">Approved on {config.network}</span>
          {agents.isPending ? (
            <Loading />
          ) : agents.isError ? (
            <Notice tone="error">{errorMessage(agents.error)}</Notice>
          ) : agents.data.length === 0 ? (
            <Empty>None</Empty>
          ) : (
            <ul className="flex flex-col gap-1 text-xs">
              {agents.data.map((a) => (
                <li key={a.address} className="flex items-center gap-2">
                  <span className="font-medium">{a.name || "(unnamed)"}</span>
                  <span className="font-mono text-faint">{shortAddress(a.address)}</span>
                  {a.address.toLowerCase() === activeAgent?.toLowerCase() && <Badge tone="accent">This</Badge>}
                  <span className="ml-auto text-faint">{a.validUntil ? fmtTime(a.validUntil) : "no expiry"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {canUserSign ? (
          <>
            <CreateAgent />
            <ApproveAddress />
          </>
        ) : (
          <Notice tone="info">Creating an API wallet needs the master key.</Notice>
        )}
        <ImportAgent />
        {canUserSign && secrets.agentKey && <ForgetMaster />}
      </div>
    </Card>
  );
}

function CreateAgent() {
  const [name, setName] = useState("hyperext");
  const [days, setDays] = useState(String(MAX_AGENT_DAYS));
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const daysNum = Number(days);
  const nameError = agentNameError(name);
  const daysError = agentDaysError(days);

  // updateVault authorizes first, then runs the on-chain approval, then saves:
  // a failed auth never approves, and a failed approval never stores the key.
  // The master key comes from the vault it just opened, not from the session.
  const create = async (auth: Auth) => {
    const agentKey = generatePrivateKey();
    const agentAddress = addressOf(agentKey);
    const validUntil = Date.now() + daysNum * DAY_MS;
    await updateVault(auth, async (secrets, config) => {
      if (!secrets.masterKey) throw new Error("Approving an API wallet needs the master key");
      await exchangeClient(config.network, secrets.masterKey).approveAgent({ agentAddress, agentName: agentName(name, validUntil) });
      return { secrets: { ...secrets, agentKey }, config: { ...config, mode: "agent" } };
    });
    setDone(agentAddress);
    await queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "markets" });
  };

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <span className="text-xs font-medium">Create a new API wallet</span>
      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} error={nameError} />
        <TextField label="Valid for" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} suffix="days" error={daysError} />
      </div>
      <p className="text-[11px] text-faint">
        Generates a fresh key, approves it from the master key, and switches trading to it. Approving with a name that
        is already in use replaces that API wallet.
      </p>
      {done && <Notice tone="success">API wallet {shortAddress(done)} approved and active.</Notice>}
      <Button variant="primary" disabled={Boolean(nameError || daysError)} onClick={() => setOpen(true)}>
        Generate and approve
      </Button>
      <AuthorizeDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Approve API wallet"
        description="Signs an approveAgent action with the master key and stores the new key in your vault."
        confirmLabel="Approve"
        onAuthorized={create}
      />
    </div>
  );
}

// Approves an API wallet whose key stays on another device: the web app
// generates its own key and shows only the address. Signed with the master
// key, opened from the vault for this one action.
function ApproveAddress() {
  const { config, secrets } = useUnlocked();
  const agents = useAgents();
  const queryClient = useQueryClient();
  const [address, setAddress] = useState("");
  const [name, setName] = useState("web");
  const [days, setDays] = useState(String(MAX_AGENT_DAYS));
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const activeAgent = secrets.agentKey ? addressOf(secrets.agentKey) : null;
  const check = agents.data
    ? checkApproveAddress({ address, name, account: config.address, activeAgent, agents: agents.data })
    : { error: null, replaces: null };
  const fieldError = address ? check.error : null;
  const nameError = agentNameError(name);
  const daysError = agentDaysError(days);
  const ready = Boolean(address && agents.data && !check.error && !nameError && !daysError);

  const approve = async (auth: Auth) => {
    const agentAddress = parseAddress(address);
    const validUntil = Date.now() + Number(days) * DAY_MS;
    await withMasterKey(auth, (key) =>
      exchangeClient(config.network, key).approveAgent({ agentAddress, agentName: agentName(name, validUntil) }),
    );
    setDone(agentAddress);
    setAddress("");
    await queryClient.invalidateQueries({ queryKey: ["agents"] });
  };

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <span className="text-xs font-medium">Approve an API wallet address</span>
      <TextField
        label="API wallet address"
        autoComplete="off"
        spellCheck={false}
        placeholder="0x…"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        error={fieldError}
        hint="For a key that stays on another device, such as the web app's."
      />
      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} error={nameError} />
        <TextField label="Valid for" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} suffix="days" error={daysError} />
      </div>
      {check.replaces && (
        <Notice tone="warn">
          "{name.trim()}" is in use by {shortAddress(check.replaces)}; approving replaces that API wallet.
        </Notice>
      )}
      {done && <Notice tone="success">API wallet {shortAddress(done)} approved. This extension keeps its own.</Notice>}
      <Button disabled={!ready} onClick={() => setOpen(true)}>
        Approve address
      </Button>
      <AuthorizeDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Approve API wallet address"
        description={`Signs an approveAgent action with the master key for ${address.trim()}. It can trade for this account but cannot withdraw.`}
        confirmLabel="Approve"
        onAuthorized={approve}
      />
    </div>
  );
}

function ImportAgent() {
  const [key, setKey] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startImport = () => {
    setError(null);
    try {
      parsePrivateKey(key);
      setOpen(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const save = (auth: Auth) =>
    updateVault(auth, (secrets, config) => ({
      secrets: { ...secrets, agentKey: parsePrivateKey(key) },
      config: { ...config, mode: "agent" },
    })).then(() => setKey(""));

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <TextField
        label="Import an existing API wallet key"
        type="password"
        autoComplete="off"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        error={error}
        hint="For an API wallet you already approved on Hyperliquid."
      />
      <Button disabled={!key} onClick={startImport}>
        Import
      </Button>
      <AuthorizeDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Import API wallet"
        description="Replaces any stored API wallet key and switches trading to it."
        confirmLabel="Import"
        onAuthorized={save}
      />
    </div>
  );
}

function ForgetMaster() {
  const [open, setOpen] = useState(false);
  const forget = (auth: Auth) =>
    updateVault(auth, (secrets, config) => ({
      secrets: { agentKey: secrets.agentKey },
      config: { ...config, mode: "agent" },
    }));

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <p className="text-[11px] text-faint">
        Keep only the API wallet in this browser. You will no longer be able to withdraw, transfer with the master key,
        or approve new API wallets here.
      </p>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Remove master key
      </Button>
      <AuthorizeDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Remove master key"
        description="Make sure the master key is backed up elsewhere. This cannot be undone from the extension."
        confirmLabel="Remove"
        onAuthorized={forget}
      />
    </div>
  );
}

function PasskeyCard() {
  const { passkeys, hasPassword } = useUnlocked();
  const [label, setLabel] = useState(platform.kind === "web" ? "This device" : "This Mac");
  // A passkey-only vault must keep one (vault.removePasskeySlot refuses too).
  const isLastKey = !hasPassword && passkeys.length === 1;
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<{ credentialId: string; label: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  return (
    <Card title="Passkeys">
      <div className="flex flex-col gap-3">
        <p className="text-[11px] text-faint">
          Unlock with Touch ID or another passkey, and confirm {platform.storesMasterKey ? "withdrawals and key changes" : "key changes"}{" "}
          with it.{" "}
          {hasPassword
            ? "Your password still works as recovery."
            : "There is no password, so the last passkey cannot be removed. If you lose every passkey, reset and set up a new API wallet."}{" "}
          Needs a provider with PRF support, such as iCloud Keychain or Google Password Manager.
        </p>
        {passkeys.length === 0 ? (
          <Empty>No passkeys enrolled</Empty>
        ) : (
          <ul className="flex flex-col gap-1.5 text-xs">
            {passkeys.map((p) => (
              <li key={p.credentialId} className="flex items-center gap-2">
                <span className="font-medium">{p.label}</span>
                <span className="text-faint">added {fmtTime(p.createdAt)}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  disabled={isLastKey}
                  title={isLastKey ? "The only way to unlock this vault" : undefined}
                  onClick={() => setRemoving(p)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        {done && <Notice tone="success">{done}</Notice>}
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <TextField label="Name" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Button variant="primary" disabled={!label.trim()} onClick={() => setAdding(true)}>
            Add passkey
          </Button>
        </div>
      </div>
      <AuthorizeDialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Add passkey"
        description="Confirm, then create the passkey when your browser asks."
        confirmLabel="Continue"
        onAuthorized={(auth) =>
          enrollPasskey(auth, label.trim()).then(() => setDone(`Passkey "${label.trim()}" added`))
        }
      />
      <AuthorizeDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Remove passkey "${removing?.label ?? ""}"`}
        description="It will no longer unlock this vault. The passkey itself stays in your password manager until you delete it there."
        confirmLabel="Remove"
        onAuthorized={(auth) =>
          removePasskey(auth, removing!.credentialId).then(() => setDone(`Passkey "${removing!.label}" removed`))
        }
      />
    </Card>
  );
}

function WithdrawAllowlistCard() {
  const { config, secrets } = useUnlocked();
  const list = secrets.withdrawAllowlist ?? [];
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<AllowedAddress | null>(null);

  const startAdd = () => {
    setFormError(null);
    try {
      addAllowed(list, config.address, { address, label });
      setAdding(true);
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };

  return (
    <Card title="Withdrawal addresses">
      <div className="flex flex-col gap-3">
        <p className="text-[11px] text-faint">
          Withdrawals can only go to this account's address or one listed here. Adding or removing an address needs your
          passkey or password.
        </p>
        <ul className="flex flex-col gap-1.5 text-xs">
          <li className="flex items-center gap-2">
            <span className="font-medium">This account</span>
            <span className="font-mono text-faint">{shortAddress(config.address)}</span>
            <Badge>Always</Badge>
          </li>
          {list.map((a) => (
            <li key={a.address} className="flex items-center gap-2">
              <span className="font-medium">{a.label}</span>
              <span className="font-mono text-faint" title={a.address}>
                {shortAddress(a.address)}
              </span>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setRemoving(a)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <TextField label="Address" spellCheck={false} autoComplete="off" placeholder="0x…" value={address} onChange={(e) => setAddress(e.target.value)} />
          <TextField label="Label" maxLength={MAX_LABEL} placeholder="Cold wallet" value={label} onChange={(e) => setLabel(e.target.value)} error={formError} />
          <Button disabled={!address || !label} onClick={startAdd}>
            Add address
          </Button>
        </div>
      </div>
      <AuthorizeDialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Add withdrawal address"
        description={
          <>
            Allow withdrawals to <span className="font-mono break-all text-fg">{address.trim()}</span> ({label.trim()}).
            Check it character by character; withdrawals to it cannot be reversed.
          </>
        }
        confirmLabel="Add"
        onAuthorized={(auth) =>
          updateVault(auth, (s, c) => ({
            secrets: { ...s, withdrawAllowlist: addAllowed(s.withdrawAllowlist ?? [], c.address, { address, label }) },
            config: c,
          })).then(() => {
            setAddress("");
            setLabel("");
          })
        }
      />
      <AuthorizeDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Remove "${removing?.label ?? ""}"`}
        description="Withdrawals to this address will be blocked."
        confirmLabel="Remove"
        onAuthorized={(auth) =>
          updateVault(auth, (s, c) => ({
            secrets: { ...s, withdrawAllowlist: removeAllowed(s.withdrawAllowlist ?? [], removing!.address) },
            config: c,
          }))
        }
      />
    </Card>
  );
}

const lockLabel = (m: number) => (m === 0 ? "Never" : m >= 60 ? `${m / 60}h` : `${m}m`);

function SecurityCard() {
  const { hasPassword } = useUnlocked();
  const [resetOpen, setResetOpen] = useState(false);
  const prefs = usePrefs();
  const queryClient = useQueryClient();
  const save = async (patch: Parameters<typeof updatePrefs>[0]) => {
    await updatePrefs(patch);
    await queryClient.invalidateQueries({ queryKey: ["prefs"] });
  };
  const minutes = prefs.data?.autoLockMinutes;

  return (
    <Card title="Security">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">Auto-lock after inactivity</span>
          {prefs.data && (
            <Segmented
              label="Auto-lock timeout"
              value={String(minutes)}
              onChange={(v) => void save({ autoLockMinutes: Number(v) })}
              options={AUTO_LOCK_CHOICES.map((m) => ({ value: String(m), label: lockLabel(m) }))}
            />
          )}
          <p className="text-[11px] text-faint">
            {minutes === 0
              ? "Keys stay unlocked until you lock or the browser closes."
              : `Locks ${minutes ? lockLabel(minutes) : "…"} after your last click or keypress in the ${platform.kind === "web" ? "app" : "popup"}; unlock again with ${hasPassword ? "a passkey or password" : "your passkey"}.`}
          </p>
        </div>
        {platform.screenLock && (
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={prefs.data?.lockOnScreenLock ?? true}
              disabled={!prefs.data}
              onChange={(e) => void save({ lockOnScreenLock: e.target.checked })}
              className="size-3.5 accent-(--color-accent)"
            />
            Lock when the screen locks
          </label>
        )}
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => void lock()}>
            Lock now
          </Button>
          <Button className="flex-1" variant="danger" onClick={() => setResetOpen(true)}>
            Reset {appName}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title={`Reset ${appName}`}
        confirmLabel="Erase keys"
        variant="danger"
        onConfirm={wipe}
      >
        Erases the encrypted keys and settings from this browser. Funds stay on Hyperliquid.
      </ConfirmDialog>
    </Card>
  );
}
