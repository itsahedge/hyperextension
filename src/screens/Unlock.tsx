import { useState, type FormEvent } from "react";
import { Button, ConfirmDialog, Notice, TextField, errorMessage } from "@/components/ui";
import { useSession } from "@/hooks/session";
import { shortAddress } from "@/lib/format";
import { unlock, wipe, type Auth } from "@/lib/session";

export function Unlock() {
  const session = useSession();
  const passkeys = session.status === "locked" ? session.passkeys : [];
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(passkeys.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const run = async (auth: Auth) => {
    setBusy(true);
    setError(null);
    try {
      await unlock(auth);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run({ kind: "password", password });
  };

  return (
    <div className="flex h-full flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Unlock</h1>
        {session.status === "locked" && (
          <p className="text-xs text-muted">
            {shortAddress(session.config.address)} on {session.config.network}
          </p>
        )}
      </div>

      {passkeys.length > 0 && !showPassword && (
        <div className="flex flex-col gap-3">
          {error && <Notice tone="error">{error}</Notice>}
          <Button variant="primary" busy={busy} autoFocus onClick={() => void run({ kind: "passkey" })}>
            Unlock with passkey
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setError(null); setShowPassword(true); }}>
            Use password instead
          </Button>
        </div>
      )}

      {showPassword && (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error}
          />
          <Button type="submit" variant="primary" busy={busy} disabled={!password}>
            Unlock
          </Button>
          {passkeys.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => { setError(null); setShowPassword(false); }}>
              Use passkey instead
            </Button>
          )}
        </form>
      )}

      <Button variant="ghost" size="sm" onClick={() => setResetOpen(true)}>
        Forgot password? Reset
      </Button>
      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset extension"
        confirmLabel="Erase keys"
        variant="danger"
        onConfirm={wipe}
      >
        This erases the encrypted keys from this browser. Funds stay on Hyperliquid, but you need the private key to
        sign again.
      </ConfirmDialog>
    </div>
  );
}
