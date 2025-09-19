import React, { useState, useEffect } from "react";

const buttonStyle: React.CSSProperties = {
  background: "#00FF7F",
  color: "#111",
  border: "none",
  borderRadius: 24,
  padding: "16px 32px",
  fontWeight: 600,
  fontSize: 18,
  display: "flex",
  alignItems: "center",
  gap: 8,
  minWidth: 120,
  transition: "background 0.2s",
  cursor: "pointer",
};

const buttonHoverStyle: React.CSSProperties = {
  background: "#00e86e",
};

export default function LootbasePage() {
  const [showReceive, setShowReceive] = useState(false);
  const [withdrawHover, setWithdrawHover] = useState(false);
  const [receiveHover, setReceiveHover] = useState(false);

  // Hardcoded subOrgId (same as BalancesPage)
  const subOrgId = "";

  // Receive page state
  const [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (showReceive) {
      setLoading(true);
      setError(null);
      setAddress(null);
      fetch("http://localhost:1947/api/turnkey/get-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subOrgId }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (
            data.success &&
            Array.isArray(data.addresses) &&
            data.addresses.length > 0
          ) {
            setAddress(data.addresses[0]);
          } else {
            setError(data.error || "No address found");
          }
        })
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }
  }, [showReceive, subOrgId]);

  if (showReceive) {
    return (
      <div
        style={{
          color: "#fff",
          background: "#111",
          minHeight: "100vh",
          padding: 0,
          fontFamily: "Inter, sans-serif",
        }}
      >
        <div style={{ padding: 20 }}>
          <button
            onClick={() => setShowReceive(false)}
            style={{
              background: "#222",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "8px 16px",
              marginBottom: 20,
              cursor: "pointer",
            }}
          >
            ← Back
          </button>
          <h2>Receive Funds</h2>
          {loading ? (
            <div>Loading address...</div>
          ) : error ? (
            <div style={{ color: "salmon" }}>{error}</div>
          ) : address ? (
            <div style={{ marginTop: 16 }}>
              <div style={{ color: "#aaa", marginBottom: 4 }}>
                Your Address:
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 16 }}>
                {address}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        color: "#fff",
        background: "#111",
        minHeight: "100vh",
        padding: 0,
        fontFamily: "Inter, sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "24px 20px 0 20px",
        }}
      >
        <div style={{ fontSize: 16, opacity: 0.7 }}>@park</div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 24, height: 24 }}></div>
          <div style={{ width: 24, height: 24 }}></div>
          <div
            style={{
              width: 24,
              height: 24,
              background: "none",
              border: "none",
            }}
          >
            <div
              style={{
                width: 4,
                height: 4,
                borderRadius: "50%",
                background: "#fff",
                margin: "10px auto",
              }}
            ></div>
            <div
              style={{
                width: 18,
                height: 2,
                background: "#fff",
                borderRadius: 2,
                margin: "2px auto",
              }}
            ></div>
            <div
              style={{
                width: 18,
                height: 2,
                background: "#fff",
                borderRadius: 2,
                margin: "2px auto",
              }}
            ></div>
          </div>
        </div>
      </div>

      {/* Balance */}
      <div style={{ textAlign: "center", marginTop: 16 }}>
        <div style={{ fontSize: 40, fontWeight: 600, marginBottom: 4 }}>
          $0.00
        </div>
        <div style={{ color: "#aaa", fontSize: 18, marginBottom: 24 }}>
          Total in Lootbase
        </div>
      </div>

      {/* Action Buttons */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <button
          style={{ ...buttonStyle, ...(withdrawHover ? buttonHoverStyle : {}) }}
          onMouseEnter={() => setWithdrawHover(true)}
          onMouseLeave={() => setWithdrawHover(false)}
        >
          <span style={{ fontSize: 24, fontWeight: 700 }}>↓</span> Withdraw
        </button>
        <button
          style={{ ...buttonStyle, ...(receiveHover ? buttonHoverStyle : {}) }}
          onMouseEnter={() => setReceiveHover(true)}
          onMouseLeave={() => setReceiveHover(false)}
          onClick={() => setShowReceive(true)}
        >
          <span style={{ fontSize: 24, fontWeight: 700 }}>▦</span> Receive
        </button>
      </div>

      {/* Signer Endpoint Button */}
      <div
        style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}
      >
        <SignerButton subOrgId={subOrgId} />
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          borderBottom: "1px solid #222",
          margin: "0 0 0 0",
        }}
      >
        {/* <div style={{ flex: 1, textAlign: 'center', color: '#aaa', fontWeight: 500, padding: '12px 0', fontSize: 18, borderBottom: '2px solid transparent' }}>
          ∞ Perps
        </div> */}
        {/* <div style={{ flex: 1, textAlign: 'center', color: '#fff', fontWeight: 600, padding: '12px 0', fontSize: 18, borderBottom: '2px solid #00FF7F' }}>
          <span style={{ marginRight: 8, fontSize: 20 }}>💰</span>Wallet
        </div> */}
        {/* <div style={{ flex: 1, textAlign: 'center', color: '#aaa', fontWeight: 500, padding: '12px 0', fontSize: 18, borderBottom: '2px solid transparent' }}>
          Wallet
        </div> */}
        {/* <div style={{ flex: 1, textAlign: 'center', color: '#aaa', fontWeight: 500, padding: '12px 0', fontSize: 18, borderBottom: '2px solid transparent' }}>
          <span style={{ marginRight: 8, fontSize: 20 }}>🪙</span>Spot
        </div> */}
      </div>

      {/* Cash Section */}
      <div style={{ background: "none", padding: "24px 20px 0 20px" }}>
        <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
          Cash
        </div>
        <div style={{ color: "#aaa", fontSize: 16, marginBottom: 4 }}>
          Buying power <span style={{ fontSize: 14, marginLeft: 4 }}>ⓘ</span>
        </div>
        <div style={{ color: "#fff", fontSize: 18, marginBottom: 4 }}>$0</div>
        <div style={{ color: "#aaa", fontSize: 16, marginBottom: 4 }}>
          Open orders
        </div>
        <div style={{ color: "#fff", fontSize: 18, marginBottom: 16 }}>$0</div>
      </div>

      {/* Add Funds Banner */}
      {/* <div style={{ background: '#222', borderRadius: 12, margin: '24px 20px', padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Add funds to start trading</div>
        <div style={{ color: '#aaa', fontSize: 15, marginBottom: 16 }}>Never miss a trade. Our markets are open 24/7</div>
        <button style={{ background: '#00FF7F', color: '#111', border: 'none', borderRadius: 24, padding: '14px 48px', fontWeight: 600, fontSize: 18, minWidth: 180, cursor: 'pointer', transition: 'background 0.2s' }}>
          + Deposit
        </button>
      </div> */}
    </div>
  );
}

function SignerButton({ subOrgId }: { subOrgId: string }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCallSigner = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("http://localhost:1947/api/turnkey/signer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subOrgId }),
      });
      const data = await res.json();
      setResult(data);
      if (!data.success) setError(data.error || "Unknown error");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
    >
      <button
        style={{ ...buttonStyle, minWidth: 180, marginBottom: 8 }}
        onClick={handleCallSigner}
        disabled={loading}
      >
        {loading ? "Calling Signer..." : "Call Turnkey Signer Endpoint"}
      </button>
      {error && <div style={{ color: "salmon", marginTop: 4 }}>{error}</div>}
      {result && (
        <pre
          style={{
            marginTop: 8,
            background: "#181A20",
            color: "#fff",
            padding: 12,
            borderRadius: 8,
            maxWidth: 600,
            overflowX: "auto",
            fontSize: 13,
          }}
        >
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
