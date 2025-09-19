import { useState } from "react";
import bcrypt from "bcryptjs";

// PasswordOnboardingScreen: For new users to set a password
export function PasswordOnboardingScreen({ onSetPassword }: { onSetPassword: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    const hash = await bcrypt.hash(password, 10);
    localStorage.setItem("hlx_password_hash", hash);
    setLoading(false);
    onSetPassword();
  };

  return (
    <div style={{ width: "100%", height: "100%", background: "#181A20", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", border: "none", boxShadow: "none" }}>
      <div style={{ marginBottom: 32 }}>
        <div style={{ textAlign: "center" }}>
          <svg width="80" height="80" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="20" y="24" width="24" height="24" rx="6" fill="#E74C3C" />
            <circle cx="32" cy="32" r="5" fill="#181A20" />
            <rect x="28" y="16" width="8" height="8" rx="4" fill="#E74C3C" />
          </svg>
        </div>
        <h1 style={{ color: "#fff", textAlign: "center", fontWeight: 700, fontSize: 32, margin: "16px 0 0 0" }}>Set Password</h1>
      </div>
      <form onSubmit={handleSetPassword} style={{ width: "100%", maxWidth: 320, margin: "0 auto" }}>
        <input
          type="password"
          placeholder="New password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={{ width: "100%", padding: "12px", borderRadius: 10, border: "2px solid #1ec9ff", background: "#23242A", color: "#fff", fontSize: 16, outline: "none", boxSizing: "border-box", marginBottom: 12 }}
        />
        <input
          type="password"
          placeholder="Confirm password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          style={{ width: "100%", padding: "12px", borderRadius: 10, border: "2px solid #1ec9ff", background: "#23242A", color: "#fff", fontSize: 16, outline: "none", boxSizing: "border-box", marginBottom: 16 }}
        />
        <button
          type="submit"
          style={{ width: "100%", padding: "12px 0", borderRadius: 12, background: "#fff", color: "#181A20", fontWeight: 700, fontSize: 18, border: "none", cursor: loading ? "not-allowed" : "pointer", marginBottom: 8, boxSizing: "border-box" }}
          disabled={loading}
        >
          {loading ? "Setting..." : "Set Password"}
        </button>
        {error && <div style={{ color: "#E74C3C", marginTop: 8, textAlign: "center" }}>{error}</div>}
      </form>
    </div>
  );
}

// PasswordUnlockScreen: For returning users to unlock
export function PasswordUnlockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const hash = localStorage.getItem("hlx_password_hash");
    if (!hash) {
      setError("No password set. Please refresh.");
      setLoading(false);
      return;
    }
    const match = await bcrypt.compare(password, hash);
    setLoading(false);
    if (match) {
      const now = Date.now();
      localStorage.setItem("hlx_unlocked", "1");
      localStorage.setItem("hlx_unlocked_at", now.toString());
      onUnlock();
    } else {
      setError("Incorrect password");
    }
  };

  return (
    <div style={{ width: "100%", height: "100%", background: "#181A20", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", border: "none", boxShadow: "none" }}>
      <div style={{ marginBottom: 32 }}>
        <div style={{ textAlign: "center" }}>
          <svg width="80" height="80" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="20" y="24" width="24" height="24" rx="6" fill="#E74C3C" />
            <circle cx="32" cy="32" r="5" fill="#181A20" />
            <rect x="28" y="16" width="8" height="8" rx="4" fill="#E74C3C" />
          </svg>
        </div>
        <h1 style={{ color: "#fff", textAlign: "center", fontWeight: 700, fontSize: 32, margin: "16px 0 0 0" }}>Hyperliquid Manager</h1>
      </div>
      <form onSubmit={handleUnlock} style={{ width: "100%", maxWidth: 320, margin: "0 auto" }}>
        <div style={{ position: "relative", marginBottom: 16 }}>
          <input
            type={show ? "text" : "password"}
            placeholder="Password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(""); }}
            style={{ width: "100%", padding: "12px 40px 12px 12px", borderRadius: 10, border: "2px solid #1ec9ff", background: "#23242A", color: "#fff", fontSize: 16, outline: "none", boxSizing: "border-box" }}
          />
          <span
            onClick={() => setShow(s => !s)}
            style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", cursor: "pointer", color: "#b0b0b0" }}
            title={show ? "Hide" : "Show"}
          >
            {show ? (
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 1l22 22M17.94 17.94A10.94 10.94 0 0 1 12 19C7 19 2.73 15.11 1 12c.74-1.32 2.1-3.31 4.06-5.06M9.88 9.88A3 3 0 0 1 12 9c1.66 0 3 1.34 3 3 0 .41-.08.8-.22 1.16" /></svg>
            ) : (
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M2.05 12C3.81 7.61 7.86 4.5 12 4.5c4.14 0 8.19 3.11 9.95 7.5-1.76 4.39-5.81 7.5-9.95 7.5-4.14 0-8.19-3.11-9.95-7.5z" /></svg>
            )}
          </span>
        </div>
        <button
          type="submit"
          style={{ width: "100%", padding: "12px 0", borderRadius: 12, background: "#fff", color: "#181A20", fontWeight: 700, fontSize: 18, border: "none", cursor: loading ? "not-allowed" : "pointer", marginBottom: 8, boxSizing: "border-box" }}
          disabled={loading}
        >
          {loading ? "Unlocking..." : "Unlock"}
        </button>
        {error && <div style={{ color: "#E74C3C", marginTop: 8, textAlign: "center" }}>{error}</div>}
      </form>
      <div style={{ marginTop: 16 }}>
        <a href="#" style={{ color: "#b0b0b0", textDecoration: "none", fontSize: 16 }} onClick={e => { e.preventDefault(); alert('Forgot password is not implemented.'); }}>
          Forgot password
        </a>
      </div>
    </div>
  );
}