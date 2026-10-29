import { useState } from "react";
import { generatePrivateKey } from "viem/accounts";
import { Badge, Button, Card, ConfirmDialog, Empty, Loading, Notice, PasswordDialog, Segmented, TextField, errorMessage } from "@/components/ui";
import { useAgents, useExchange } from "@/hooks/queries";
import { useUnlocked } from "@/hooks/session";
import { addressOf, parsePrivateKey, type Network, type SignerMode } from "@/lib/account";
import { fmtTime, shortAddress } from "@/lib/format";
import { lock, updateConfig, updateVault, verifyPassword, wipe } from "@/lib/session";

// Hyperliquid caps API wallet expiry at 180 days and names at 16 characters.
const MAX_AGENT_DAYS = 180;
const MAX_AGENT_NAME = 16;
const DAY_MS = 86_400_000;

export function Settings() {
  return (
    <div className="flex flex-col gap-3">
      <AccountCard />
      <AgentCard />
      <SecurityCard />
    </div>
  );
}

function AccountCard() {
  const { config, secrets } = useUnlocked();
  const [error, setError] = useState<string | null>(null);
  const apply = (patch: { network?: Network; mode?: SignerMode }) => {
    setError(null);
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
              { value: "master", label: "Master key", disabled: !secrets.masterKey },
              { value: "agent", label: "API wallet", disabled: !secrets.agentKey },
            ]}
          />
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
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

        {canUserSign ? <CreateAgent /> : <Notice tone="info">Creating an API wallet needs the master key.</Notice>}
        <ImportAgent />
        {secrets.masterKey && secrets.agentKey && <ForgetMaster />}
      </div>
    </Card>
  );
}

function CreateAgent() {
  const [name, setName] = useState("hyperext");
  const [days, setDays] = useState(String(MAX_AGENT_DAYS));
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const approve = useExchange(
    (client, a: { agentAddress: `0x${string}`; agentName: string }) => client.approveAgent(a),
    { userSigned: true },
  );

  const daysNum = Number(days);
  const nameError =
    name.trim().length === 0 || name.trim().length > MAX_AGENT_NAME ? `1 to ${MAX_AGENT_NAME} characters` : null;
  const daysError =
    !Number.isInteger(daysNum) || daysNum < 1 || daysNum > MAX_AGENT_DAYS ? `Whole days, 1 to ${MAX_AGENT_DAYS}` : null;

  // Order matters: check the password before the on-chain approval so a typo
  // cannot leave an approved agent whose key was never saved.
  const create = async (password: string) => {
    await verifyPassword(password);
    const agentKey = generatePrivateKey();
    const agentAddress = addressOf(agentKey);
    const validUntil = Date.now() + daysNum * DAY_MS;
    await approve.mutateAsync({ agentAddress, agentName: `${name.trim()} valid_until ${validUntil}` });
    await updateVault(password, (secrets, config) => ({
      secrets: { ...secrets, agentKey },
      config: { ...config, mode: "agent" },
    }));
    setDone(agentAddress);
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
      <PasswordDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Approve API wallet"
        description="Signs an approveAgent action with the master key and stores the new key in your vault."
        confirmLabel="Approve"
        onSubmit={create}
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

  const save = (password: string) =>
    updateVault(password, (secrets, config) => ({
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
      <PasswordDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Import API wallet"
        description="Replaces any stored API wallet key and switches trading to it."
        confirmLabel="Import"
        onSubmit={save}
      />
    </div>
  );
}

function ForgetMaster() {
  const [open, setOpen] = useState(false);
  const forget = (password: string) =>
    updateVault(password, (secrets, config) => ({
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
      <PasswordDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Remove master key"
        description="Make sure the master key is backed up elsewhere. This cannot be undone from the extension."
        confirmLabel="Remove"
        onSubmit={forget}
      />
    </div>
  );
}

function SecurityCard() {
  const [resetOpen, setResetOpen] = useState(false);
  return (
    <Card title="Security">
      <div className="flex flex-col gap-2">
        <p className="text-[11px] text-faint">
          Keys stay decrypted in memory until you lock or the browser closes.
        </p>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => void lock()}>
            Lock now
          </Button>
          <Button className="flex-1" variant="danger" onClick={() => setResetOpen(true)}>
            Reset extension
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset extension"
        confirmLabel="Erase keys"
        variant="danger"
        onConfirm={wipe}
      >
        Erases the encrypted keys and settings from this browser. Funds stay on Hyperliquid.
      </ConfirmDialog>
    </Card>
  );
}
