import React, { useState, useEffect } from "react";
import { useStorage } from "@plasmohq/storage/hook";
import { Storage } from "@plasmohq/storage";
import type { User } from "@supabase/supabase-js";
import { Divider } from "@mantine/core";

// Add a loader for transfer button
function SmallLoader() {
  return <span style={{ marginLeft: 8 }}>...</span>;
}

type TransferFundsProps = {
  onBack: () => void;
};

export default function TransferFunds({ onBack }: TransferFundsProps) {
  const [transferAmount, setTransferAmount] = useState("");
  const [transferToPerp, setTransferToPerp] = useState(true);
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferResult, setTransferResult] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferDirection, setTransferDirection] = useState<
    "perpsToSpot" | "spotToPerps"
  >("perpsToSpot");

  const [user] = useStorage<User | null>({
    key: "user",
    instance: new Storage({ area: "local" }),
  });
  const [ethereumAddress, setEthereumAddress] = useState<string>("");

  // Perps USDC balance state
  const [perpsBalances, setPerpsBalances] = useState<any>(null);
  const [spotBalances, setSpotBalances] = useState<any>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);

  // Helper to get available balance for current direction
  const getAvailableBalance = () => {
    if (transferDirection === "perpsToSpot") {
      return perpsBalances?.withdrawable ?? 0;
    } else {
      // Find USDC spot balance
      const usdcSpot = spotBalances?.balances?.find(
        (b: any) => b.coin === "USDC-SPOT"
      );
      return usdcSpot ? Number(usdcSpot.total - usdcSpot.hold) : 0;
    }
  };

  // Helper to format available balance for MAX
  const formatAvailable = () => {
    return getAvailableBalance().toFixed(6).replace(/\.0+$/, "");
  };

  // Fetch ethereum address from user profile in storage
  useEffect(() => {
    let cancelled = false;
    const fetchProfile = async () => {
      if (!user) return;
      const storage = new Storage({ area: "local" });
      let profile = (await storage.getItem("userProfile")) as any;
      if (!profile) return;
      if (!cancelled) setEthereumAddress(profile.ethereum_address);
    };
    fetchProfile();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Update transferToPerp based on transferDirection
  useEffect(() => {
    setTransferToPerp(transferDirection === "spotToPerps");
  }, [transferDirection]);

  // Fetch perps USDC balance on mount
  useEffect(() => {
    const fetchPortfolio = async () => {
      setPortfolioLoading(true);
      setPortfolioError(null);
      setPerpsBalances(null);
      setSpotBalances(null);
      try {
        if (!user || !user.id || !ethereumAddress) {
          setPortfolioError("No user or ethereum address found");
          return;
        }
        const res = await fetch(
          "http://localhost:1947/api/hyperliquid/getPortfolio",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId: user.id,
              ethereum_address: ethereumAddress,
            }),
          }
        );
        const data = await res.json();
        if (!res.ok) {
          setPortfolioError(data.error || "Unknown error");
        } else {
          setPerpsBalances(data?.perpsBalances ?? null);
          setSpotBalances(data?.spotBalances ?? null);
        }
      } catch (err: any) {
        setPortfolioError(err.message || String(err));
      } finally {
        setPortfolioLoading(false);
      }
    };
    if (user && ethereumAddress) fetchPortfolio();
  }, [user, ethereumAddress]);

  const handleTransferBetweenSpotAndPerp = async () => {
    setTransferLoading(true);
    setTransferResult(null);
    setTransferError(null);
    try {
      const amount = parseFloat(transferAmount);
      if (isNaN(amount) || amount <= 0) {
        setTransferError("Enter a valid amount");
        setTransferLoading(false);
        return;
      }
      if (!user) {
        setTransferError("No user logged in");
        setTransferLoading(false);
        return;
      }
      const userId = user.id;
      const res = await fetch(
        "http://localhost:1947/api/hyperliquid/transfer",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, amount, toPerp: transferToPerp }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setTransferError(data.error || "Unknown error");
      } else {
        setTransferResult(JSON.stringify(data.result, null, 2));
      }
    } catch (err: any) {
      setTransferError(err.message || String(err));
    } finally {
      setTransferLoading(false);
    }
  };

  return (
    <div
      style={{ color: "#fff", padding: 16, maxWidth: 420, margin: "0 auto" }}
    >
      <div style={{ textAlign: "center" }}>
        {/* <h2 style={{ fontWeight: 700, fontSize: 28, margin: 0 }}>
          Transfer USDC
        </h2> */}

        <div
          style={{
            color: "#b0b0b0",
            fontSize: 16,
            marginTop: 8,
            marginBottom: 24,
          }}
        >
          Transfer USDC between your Perps and Spot balances.
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 8,
            marginBottom: 24,
          }}
        >
          {transferDirection === "perpsToSpot" ? (
            <>
              <button
                onClick={() => setTransferDirection("perpsToSpot")}
                style={{
                  background: "transparent",
                  color: "#1ec9ff",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 24px",
                  fontWeight: 600,
                  fontSize: 16,
                  cursor: "pointer",
                  outline: "none",
                  transition: "background 0.2s",
                  width: 90,
                }}
              >
                Perps
              </button>
              <span
                style={{
                  fontSize: 22,
                  color: "#1ec9ff",
                  fontWeight: 700,
                  cursor: "pointer",
                  margin: "0 8px",
                  transition: "color 0.2s",
                }}
                onClick={() => {
                  setTransferDirection("spotToPerps");
                  setTransferAmount("");
                }}
                onMouseOver={(e) => (e.currentTarget.style.color = "#00eaff")}
                onMouseOut={(e) => (e.currentTarget.style.color = "#1ec9ff")}
                title="Switch direction"
              >
                &#8596;
              </span>
              <button
                onClick={() => setTransferDirection("spotToPerps")}
                style={{
                  background: "transparent",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 24px",
                  fontWeight: 600,
                  fontSize: 16,
                  cursor: "pointer",
                  outline: "none",
                  transition: "background 0.2s",
                  width: 90,
                }}
              >
                Spot
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setTransferDirection("spotToPerps")}
                style={{
                  background: "transparent",
                  color: "#1ec9ff",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 24px",
                  fontWeight: 600,
                  fontSize: 16,
                  cursor: "pointer",
                  outline: "none",
                  transition: "background 0.2s",
                  width: 90,
                }}
              >
                Spot
              </button>
              <span
                style={{
                  fontSize: 22,
                  color: "#1ec9ff",
                  fontWeight: 700,
                  cursor: "pointer",
                  margin: "0 8px",
                  transition: "color 0.2s",
                }}
                onClick={() => {
                  setTransferDirection("perpsToSpot");
                  setTransferAmount("");
                }}
                onMouseOver={(e) => (e.currentTarget.style.color = "#00eaff")}
                onMouseOut={(e) => (e.currentTarget.style.color = "#1ec9ff")}
                title="Switch direction"
              >
                &#8596;
              </span>
              <button
                onClick={() => setTransferDirection("perpsToSpot")}
                style={{
                  background: "transparent",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 24px",
                  fontWeight: 600,
                  fontSize: 16,
                  cursor: "pointer",
                  outline: "none",
                  transition: "background 0.2s",
                  width: 90,
                }}
              >
                Perps
              </button>
            </>
          )}
        </div>
        <div style={{ position: "relative", marginBottom: 24 }}>
          <input
            type="number"
            placeholder="Amount"
            value={transferAmount}
            onChange={(e) => setTransferAmount(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 10px 10px 8px",
              borderRadius: 8,
              border: "1px solid #333",
              background: "#181A20",
              color: "#fff",
              fontSize: 15,
              fontWeight: 500,
              outline: "none",
            }}
            min="0"
            step="any"
          />
          <span
            style={{
              position: "absolute",
              right: 18,
              top: 14,
              color: "#1ec9ff",
              fontWeight: 600,
              fontSize: 16,
              cursor: "pointer",
              userSelect: "none",
            }}
            onClick={() => setTransferAmount(formatAvailable())}
          >
            MAX: {formatAvailable()}
          </span>
        </div>
        <button
          onClick={handleTransferBetweenSpotAndPerp}
          disabled={
            transferLoading ||
            !transferAmount ||
            Number(transferAmount) <= 0 ||
            Number(transferAmount) > getAvailableBalance()
          }
          style={{
            width: "100%",
            padding: "10px 0",
            fontSize: 16,
            borderRadius: 10,
            background: "#1ec9ff",
            color: "#111",
            border: "none",
            fontWeight: 700,
            cursor:
              transferLoading ||
              !transferAmount ||
              Number(transferAmount) <= 0 ||
              Number(transferAmount) > getAvailableBalance()
                ? "not-allowed"
                : "pointer",
            marginBottom: 24,
          }}
        >
          {transferLoading ? (
            <>
              Transferring...
              <SmallLoader />
            </>
          ) : (
            "Transfer"
          )}
        </button>

        <Divider />

        {transferResult && (
          <pre
            style={{
              marginTop: 16,
              background: "#181A20",
              color: "#fff",
              padding: 12,
              borderRadius: 8,
              maxWidth: 600,
              overflowX: "auto",
            }}
          >
            {transferResult}
          </pre>
        )}
        {transferError && (
          <div style={{ marginTop: 16, color: "salmon" }}>{transferError}</div>
        )}

        {/* Balances Table */}
        <div style={{ margin: "24px 0" }}>
          <table
            style={{
              width: "100%",
              background: "#181A20",
              color: "#fff",
              borderCollapse: "collapse",
              borderRadius: 8,
              overflow: "hidden",
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid #222" }}>
                <th
                  style={{
                    textAlign: "left",
                    padding: "8px 12px",
                    fontWeight: 500,
                    fontSize: 13,
                  }}
                >
                  Coin
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "8px 12px",
                    fontWeight: 500,
                    fontSize: 13,
                  }}
                >
                  Total Balance
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "8px 12px",
                    fontWeight: 500,
                    fontSize: 13,
                  }}
                >
                  Available Balance
                </th>
              </tr>
            </thead>
            <tbody>
              {/* USDC (Perps) */}
              {perpsBalances && (
                <tr style={{ borderBottom: "1px solid #222" }}>
                  <td style={{ padding: "8px 12px", fontSize: 13 }}>
                    USDC (Perps)
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      padding: "8px 12px",
                      fontSize: 13,
                    }}
                  >
                    {perpsBalances.crossMarginSummary?.accountValue?.toFixed(2)}{" "}
                    USDC
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      padding: "8px 12px",
                      fontSize: 13,
                    }}
                  >
                    {perpsBalances.withdrawable?.toFixed(2)} USDC
                  </td>
                </tr>
              )}
              {/* Spot Balances */}
              {spotBalances?.balances?.map((bal: any, idx: number) => {
                const decimals = 6;
                const unit = bal.coin.replace("-SPOT", "");
                return (
                  <tr key={bal.coin} style={{ borderBottom: "1px solid #222" }}>
                    <td style={{ padding: "8px 12px", fontSize: 13 }}>
                      {bal.coin.replace("-SPOT", " (Spot)")}
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        padding: "8px 12px",
                        fontSize: 13,
                      }}
                    >
                      {Number(bal.total).toFixed(decimals)} {unit}
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        padding: "8px 12px",
                        fontSize: 13,
                      }}
                    >
                      {Number(bal.total - bal.hold).toFixed(decimals)} {unit}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
