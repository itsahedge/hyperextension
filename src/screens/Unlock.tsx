import { useState, type FormEvent } from "react";
import { Button, ConfirmDialog, TextField, errorMessage } from "@/components/ui";
import { useSession } from "@/hooks/session";
import { shortAddress } from "@/lib/format";
import { unlock, wipe } from "@/lib/session";

export function Unlock() {
  const session = useSession();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await unlock(password);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
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
      </form>
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
