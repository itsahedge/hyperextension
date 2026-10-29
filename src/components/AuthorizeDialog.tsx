import { useState, type FormEvent, type ReactNode } from "react";
import { useSession } from "@/hooks/session";
import type { Auth } from "@/lib/session";
import { Button, Modal, Notice, TextField, errorMessage } from "./ui";

// Re-authorizes with a passkey (when enrolled) or the vault password before a
// sensitive action. `onAuthorized` receives the chosen Auth and must use it,
// e.g. pass it to updateVault or verify.
export function AuthorizeDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  onAuthorized,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onAuthorized: (auth: Auth) => Promise<unknown>;
}) {
  const session = useSession();
  const hasPasskey = session.status !== "empty" && session.passkeys.length > 0;
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setPassword("");
    setError(null);
    setUsePassword(false);
    onClose();
  };

  const run = async (auth: Auth) => {
    setBusy(true);
    setError(null);
    try {
      await onAuthorized(auth);
      setPassword("");
      setUsePassword(false);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    void run({ kind: "password", password });
  };

  const showPassword = !hasPasskey || usePassword;

  return (
    <Modal open={open} onClose={close} title={title}>
      <div className="flex flex-col gap-3">
        <div className="text-xs text-muted">{description}</div>
        {showPassword ? (
          <form onSubmit={submitPassword} className="flex flex-col gap-3">
            <TextField
              label="Vault password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={error}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={hasPasskey ? () => setUsePassword(false) : close} disabled={busy}>
                {hasPasskey ? "Back" : "Cancel"}
              </Button>
              <Button type="submit" variant="primary" busy={busy} disabled={!password}>
                {confirmLabel}
              </Button>
            </div>
          </form>
        ) : (
          <>
            {error && <Notice tone="error">{error}</Notice>}
            <Button variant="primary" busy={busy} onClick={() => void run({ kind: "passkey" })}>
              {confirmLabel} with passkey
            </Button>
            <div className="flex justify-between">
              <Button variant="ghost" size="sm" onClick={() => setUsePassword(true)} disabled={busy}>
                Use password instead
              </Button>
              <Button variant="ghost" size="sm" onClick={close} disabled={busy}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
