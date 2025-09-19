import React, { useState, useEffect } from "react";
import { PopupContainer } from "../../components/PopupContainer";
import { supabase } from "../../core/supabase";
import { SmallLoader } from "../../components/Loader";
import { useStorage } from "@plasmohq/storage/hook";
import { Storage } from "@plasmohq/storage";
import type { User } from "@supabase/supabase-js";
import { UserProfile } from "../../core/types";
import { PositionCard } from "./components/PositionCard";
import PositionPage from "../position";
import { PnlCombinedChart } from "../../components/PnlCombinedChart";

export default function HomePage({
  setTab,
  onPositionClick,
}: {
  setTab?: (tab: string) => void;
  onPositionClick?: (pos: any) => void;
} = {}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [ethereumAddress, setEthereumAddress] = useState<string>("");
  const [walletError, setWalletError] = useState<string | null>(null);

  // User profile state
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [spotBalances, setSpotBalances] = useState<any>(null);
  const [spotLoading, setSpotLoading] = useState(false);
  const [spotError, setSpotError] = useState<string | null>(null);
  const [perpsBalances, setPerpsBalances] = useState<any>(null);
  const [perpsLoading, setPerpsLoading] = useState(false);
  const [perpsError, setPerpsError] = useState<string | null>(null);

  const [purrSpotPrice, setPurrSpotPrice] = useState<number | null>(null);

  const [portfolio, setPortfolio] = useState<any>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(true);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);

  const [portfolioRaw, setPortfolioRaw] = useState<any>(null);
  const [portfolioRawLoading, setPortfolioRawLoading] = useState(false);
  const [portfolioRawError, setPortfolioRawError] = useState<string | null>(
    null
  );

  const [openPositions, setOpenPositions] = useState<any[]>([]);
  const [openPositionsLoading, setOpenPositionsLoading] = useState(false);
  const [openPositionsError, setOpenPositionsError] = useState<string | null>(
    null
  );

  const [selectedPosition, setSelectedPosition] = useState<any | null>(null);

  const [approvingBuilderFee, setApprovingBuilderFee] = useState(false);

  const [topMovers, setTopMovers] = useState<any[] | null>(null);
  const [fetchingMovers, setFetchingMovers] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pnlHistory, setPnlHistory] = useState<any[] | null>(null);
  const [pnlHistoryLoading, setPnlHistoryLoading] = useState(false);
  const [pnlHistoryError, setPnlHistoryError] = useState<string | null>(null);

  const [user] = useStorage<User | null>({
    key: "user",
    instance: new Storage({ area: "local" }),
  });

  const accountValueStyle = {
    fontWeight: 700,
    fontSize: 22,
    color: "#1ec9ff",
    marginBottom: 8,
    display: "flex",
    alignItems: "center",
    gap: 12,
  };
  const refreshButtonStyle = (disabled: boolean) => ({
    marginLeft: 8,
    padding: "4px 12px",
    fontSize: 16,
    borderRadius: 6,
    background: "#23272F",
    color: "#1ec9ff",
    border: "1px solid #1ec9ff",
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  });

  let accountValueRow;
  if (portfolioRawLoading) {
    accountValueRow = (
      <div style={accountValueStyle}>
        Account: <SmallLoader />
      </div>
    );
  } else if (portfolioRawError) {
    accountValueRow = (
      <div style={{ color: "salmon" }}>{portfolioRawError}</div>
    );
  } else if (portfolioRaw !== null) {
    accountValueRow = (
      <div style={accountValueStyle}>
        Account: ${Number(portfolioRaw).toFixed(2)}
      </div>
    );
  } else {
    accountValueRow = null;
  }

  useEffect(() => {
    let cancelled = false;
    const initializeWallet = async () => {
      setWalletLoading(true);
      setWalletError(null);
      setEthereumAddress("");
      setPortfolioRawLoading(true); // set it earlier

      try {
        // Use user from storage
        if (!user) {
          setWalletError("No user logged in");
          return;
        }
        const userId = user.id;
        const storage = new Storage({ area: "local" });
        let profile = (await storage.getItem(
          "userProfile"
        )) as UserProfile | null;
        if (!profile) {
          // TODO: we shouldnt store EVERYTHING from the profile in local storage, this is just for testing.
          const { data: fetchedProfile, error: profileError } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", userId)
            .single();
          if (profileError) {
            setWalletError(profileError.message);
            return;
          }
          if (!fetchedProfile || !fetchedProfile.ethereum_address) {
            setWalletError("No ethereum address found");
            return;
          }
          profile = fetchedProfile as UserProfile;
          await storage.setItem("userProfile", profile);
        }
        if (cancelled) return;
        setEthereumAddress(profile.ethereum_address);
      } catch (err: any) {
        if (!cancelled) setWalletError(err.message || String(err));
      } finally {
        if (!cancelled) setWalletLoading(false);
      }
    };

    initializeWallet();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleFetchProfile = async () => {
    setProfileLoading(true);
    setProfileError(null);
    if (!user) {
      setProfileError("No user logged in");
      setProfileLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      if (error) {
        setProfileError(error.message);
      } else {
        setProfile(data);
      }
    } catch (err: any) {
      setProfileError(err.message || String(err));
    } finally {
      setProfileLoading(false);
    }
  };

  useEffect(() => {
    const fetchHomeData = async () => {
      setPortfolioLoading(true);
      setPortfolioError(null);
      setPortfolio(null);
      setPortfolioRawLoading(true);
      setPortfolioRawError(null);
      setOpenPositionsLoading(true);
      setOpenPositionsError(null);
      setOpenPositions([]);
      setFetchingMovers(true);
      setError(null);
      setTopMovers(null);
      try {
        if (!user || !user.id || !ethereumAddress) {
          setPortfolioError("No user or ethereum address found");
          setPortfolioLoading(false);
          setPortfolioRawLoading(false);
          setOpenPositionsError("No user or ethereum address found");
          setOpenPositionsLoading(false);
          setError("No user or ethereum address found");
          setFetchingMovers(false);
          return;
        }
        const res = await fetch(
          "http://localhost:1947/api/hyperliquid/homeData",
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
          setPortfolioRawError(data.error || "Unknown error");
          setOpenPositionsError(data.error || "Unknown error");
          setError(data.error || "Unknown error");
        } else {
          setPortfolio(data.portfolio);
          setPortfolioRaw(data.portfolio?.totalPortfolioValue ?? null);
          setOpenPositions(data.openPositions || []);
          setTopMovers(data.topMovers || []);
        }
      } catch (err: any) {
        setPortfolioError(err.message || String(err));
        setPortfolioRawError(err.message || String(err));
        setOpenPositionsError(err.message || String(err));
        setError(err.message || String(err));
      } finally {
        setPortfolioLoading(false);
        setPortfolioRawLoading(false);
        setOpenPositionsLoading(false);
        setFetchingMovers(false);
      }
    };
    if (user && ethereumAddress) fetchHomeData();
  }, [user, ethereumAddress]);

  useEffect(() => {
    if (user && ethereumAddress && !profile && !profileLoading) {
      handleFetchProfile();
    }
  }, [user, ethereumAddress]);

  useEffect(() => {
    if (!ethereumAddress) return;
    let cancelled = false;
    setPnlHistoryLoading(true);
    setPnlHistoryError(null);
    setPnlHistory(null);
    fetch("http://localhost:1947/api/hyperliquid/pnlHistory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ethereum_address: ethereumAddress }),
    })
      .then(async (res) => {
        console.log(">> pnlHistory res: ", res);
        const data = await res.json();
        if (!res.ok)
          throw new Error(data.error || "Failed to fetch PnL history");
        if (!cancelled) setPnlHistory(data.pnlHistory);
      })
      .catch((err) => {
        if (!cancelled) setPnlHistoryError(err.message || String(err));
      })
      .finally(() => {
        if (!cancelled) setPnlHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ethereumAddress]);

  useEffect(() => {
    const approveBuilderFee = async () => {
      if (!user) return;
      if (
        profile &&
        typeof portfolioRaw === "number" &&
        portfolioRaw > 0 &&
        profile.approved_builder_fee === false &&
        !approvingBuilderFee
      ) {
        setApprovingBuilderFee(true);
        try {
          // Call the approveBuilderFee API
          const res = await fetch(
            "http://localhost:1947/api/hyperliquid/approveBuilderFee",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId: user.id }),
            }
          );
          const data = await res.json();
          if (!res.ok)
            throw new Error(data.error || "Failed to approve builder fee");

          // Update the profile in Supabase
          const { error } = await supabase
            .from("profiles")
            .update({ approved_builder_fee: true })
            .eq("id", user.id);

          if (error) throw new Error(error.message);

          // Fetch the updated profile from Supabase
          const { data: updatedProfile, error: fetchError } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", user.id)
            .single();

          if (fetchError) throw new Error(fetchError.message);

          setProfile(updatedProfile as UserProfile);
        } catch (err) {
          // Optionally handle error (show message, etc.)
          console.error("Failed to approve builder fee:", err);
        } finally {
          setApprovingBuilderFee(false);
        }
      }
    };

    approveBuilderFee();
  }, [profile, portfolioRaw, user, approvingBuilderFee]);

  let builderFeeMessage = null;
  if (profile && typeof portfolioRaw === "number") {
    if (portfolioRaw > 0 && profile.approved_builder_fee === false) {
      // No message, handled by effect
    } else if (portfolioRaw === 0 && profile.approved_builder_fee === false) {
      builderFeeMessage = (
        <div style={{ color: "#b0b0b0", marginTop: 16 }}>
          has not deposited yet, don't need to approve builder fee yet
        </div>
      );
    }
    // If balance > 0 and approved_builder_fee is true, show nothing
  }

  if (selectedPosition) {
    return (
      <PositionPage
        pos={selectedPosition}
        onBack={() => setSelectedPosition(null)}
      />
    );
  }

  return (
    <PopupContainer>
      <div style={{ color: "#fff", padding: 16 }}>
        <div style={{ marginTop: 16 }}>
          {accountValueRow}
          {builderFeeMessage}
        </div>

        {portfolioRaw !== null && Number(portfolioRaw) === 0 && setTab && (
          <button
            onClick={() => setTab("wallet")}
            style={{
              marginTop: 16,
              marginBottom: 16,
              padding: "8px 20px",
              fontSize: 16,
              borderRadius: 8,
              background: "#ff4d4f",
              color: "#fff",
              border: "none",
              fontWeight: 600,
              cursor: "pointer",
              display: "block",
            }}
          >
            Deposit funds to start trading
          </button>
        )}

        {result && (
          <div
            style={{
              marginTop: 12,
              color: result.startsWith("Success") ? "lightgreen" : "salmon",
            }}
          >
            {result}
          </div>
        )}

        <div style={{ marginTop: 32 }}>
          <h4>All PnL (Combined)</h4>
          <PnlCombinedChart
            loading={pnlHistoryLoading}
            error={pnlHistoryError}
            data={pnlHistory}
          />
        </div>

        <div style={{ marginTop: 32 }}>
          <h4>Positions</h4>
          {openPositionsLoading ? (
            <SmallLoader />
          ) : openPositionsError ? (
            <div style={{ color: "salmon" }}>{openPositionsError}</div>
          ) : openPositions.length === 0 ? (
            <div>No open perp positions.</div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 20,
                marginTop: 8,
              }}
            >
              {openPositions.map((pos, idx) => (
                <div
                  key={idx}
                  onClick={() => setSelectedPosition(pos)}
                  style={{ cursor: "pointer" }}
                >
                  <PositionCard pos={pos} />
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ marginTop: 32 }}>
          {fetchingMovers ? (
            <div style={{ color: "#1ec9ff", marginBottom: 24 }}>
              Loading top movers...
            </div>
          ) : topMovers && topMovers.length > 0 ? (
            <div>
              <h4>Top Movers</h4>
              <table
                style={{
                  width: "100%",
                  marginTop: 8,
                  background: "#181A20",
                  color: "#fff",
                  borderCollapse: "collapse",
                  fontSize: 13,
                  borderRadius: 8,
                  overflow: "hidden",
                }}
              >
                <thead>
                  <tr>
                    <th style={{ border: "1px solid #222", padding: 4 }}>
                      Name
                    </th>
                    <th style={{ border: "1px solid #222", padding: 4 }}>
                      Price
                    </th>
                    <th style={{ border: "1px solid #222", padding: 4 }}>
                      % Change (24h)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {topMovers.map((mover, idx) => (
                    <tr key={idx}>
                      <td style={{ border: "1px solid #222", padding: 4 }}>
                        {mover.name}
                      </td>
                      <td style={{ border: "1px solid #222", padding: 4 }}>
                        {mover.markPx.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 6,
                        })}
                      </td>
                      <td
                        style={{
                          border: "1px solid #222",
                          padding: 4,
                          color: mover.change < 0 ? "#f55" : "#0f0",
                        }}
                      >
                        {mover.change.toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : error ? (
            <div style={{ color: "salmon", marginTop: 8 }}>{error}</div>
          ) : null}
        </div>
      </div>
    </PopupContainer>
  );
}
