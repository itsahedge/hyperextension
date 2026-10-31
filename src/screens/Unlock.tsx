import { useState, type FormEvent } from "react";
import { Button, ConfirmDialog, Notice, TextField, errorMessage } from "@/components/ui";
import { useSession } from "@/hooks/session";
import { unlock, wipe, type Auth } from "@/lib/session";
import { platform } from "@/platform";

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

  const switchTo = (password: boolean) => {
    setError(null);
    setShowPassword(password);
  };

  return (
    <div className="flex h-full flex-col justify-center gap-2 p-6">
      {showPassword ? (
        <form onSubmit={submit} className="flex flex-col gap-2">
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
      ) : (
        <>
          {error && <Notice tone="error">{error}</Notice>}
          <Button variant="primary" busy={busy} autoFocus onClick={() => void run({ kind: "passkey" })}>
            Unlock with passkey
          </Button>
        </>
      )}
      {passkeys.length > 0 && (
        <Button onClick={() => switchTo(!showPassword)}>{showPassword ? "Use passkey" : "Use password"}</Button>
      )}
      <Button onClick={() => setResetOpen(true)}>Forgot password? Reset</Button>
      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title={platform.kind === "web" ? "Reset app" : "Reset extension"}
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
