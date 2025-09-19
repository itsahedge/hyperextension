import { useState, useEffect } from "react";
import { Button, Tabs } from "@mantine/core";
import { Hyperliquid } from "hyperliquid";
import btcIcon from "../../assets/bitcoin-small.png";

function formatBalance(val: number | string | undefined, decimals = 4) {
  if (val === undefined || val === null) return "0.0";
  return parseFloat(val as string).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

// PerpsTabPanel component
function PerpsTabPanel() {
  return (
    <>
      {/* Search Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          margin: "16px 0 8px 0",
        }}
      >
        <div
          style={{
            flex: 1,
            background: "#181A20",
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            padding: "8px 12px",
          }}
        >
          <span style={{ color: "#7ecbff", fontSize: 18, marginRight: 8 }}>
            <svg width="20" height="20" fill="none" viewBox="0 0 20 20">
              <path
                d="M9.5 17a7.5 7.5 0 1 1 5.3-2.2l3.2 3.2a1 1 0 0 1-1.4 1.4l-3.2-3.2A7.5 7.5 0 0 1 9.5 17zm0-2a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11z"
                fill="#7ecbff"
              />
            </svg>
          </span>
          <input
            type="text"
            placeholder="Search"
            style={{
              flex: 1,
              background: "none",
              border: "none",
              color: "#fff",
              fontSize: 18,
              outline: "none",
            }}
          />
        </div>
      </div>

      {/* Discover Section */}
      <div
        style={{
          background: "#181A20",
          borderRadius: 18,
          padding: 20,
          margin: "18px 0 16px 0",
          boxShadow: "0 2px 8px #0002",
        }}
      >
        <div
          style={{
            color: "#bfc9d4",
            fontWeight: 600,
            fontSize: 18,
            marginBottom: 2,
          }}
        >
          Discover
        </div>
        <div
          style={{
            color: "#6c7685",
            fontWeight: 500,
            fontSize: 15,
            marginBottom: 16,
          }}
        >
          Today's featured asset
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img
              src="/ethereum-small.png"
              alt="ETH"
              width={32}
              height={32}
              style={{ borderRadius: 16, background: "#23242A" }}
            />
            <div>
              <div style={{ color: "#fff", fontWeight: 700, fontSize: 20 }}>
                ETH
              </div>
              <div style={{ color: "#bfc9d4", fontWeight: 500, fontSize: 14 }}>
                $1.3B 24h vol.
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 20 }}>
              $2,608.6
            </div>
            <div style={{ color: "#1ecb81", fontWeight: 600, fontSize: 15 }}>
              ▲ 3.2%
            </div>
          </div>
        </div>
        {/* Static Chart Placeholder */}
        <div style={{ width: "100%", height: 80, margin: "12px 0" }}>
          <svg
            width="100%"
            height="80"
            viewBox="0 0 320 80"
            style={{ display: "block" }}
          >
            <defs>
              <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00ff99" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#00ff99" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M0,60 Q40,40 80,50 Q120,70 160,30 Q200,10 240,40 Q280,60 320,50"
              stroke="#00ff99"
              strokeWidth="3"
              fill="none"
            />
            <circle cx="300" cy="50" r="5" fill="#00ff99" />
            <path
              d="M0,80 L0,60 Q40,40 80,50 Q120,70 160,30 Q200,10 240,40 Q280,60 320,50 L320,80 Z"
              fill="url(#chartGradient)"
            />
          </svg>
        </div>
        <div style={{ display: "flex", gap: 12, marginBottom: 4 }}>
          <button
            style={{
              flex: 1,
              background: "#ff3b30",
              color: "#fff",
              fontWeight: 700,
              fontSize: 18,
              border: "none",
              borderRadius: 12,
              padding: "12px 0",
              cursor: "pointer",
            }}
          >
            Short
          </button>
          <button
            style={{
              flex: 1,
              background: "#1ecb81",
              color: "#181A20",
              fontWeight: 700,
              fontSize: 18,
              border: "none",
              borderRadius: 12,
              padding: "12px 0",
              cursor: "pointer",
            }}
          >
            Long
          </button>
        </div>
      </div>

      {/* Categories */}
      <div style={{ marginBottom: 18 }}>
        <div
          style={{
            color: "#bfc9d4",
            fontWeight: 600,
            fontSize: 18,
            marginBottom: 8,
          }}
        >
          Categories
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {["Memes", "AI", "DeFi", "Gaming", "NFTs", "L2s", "RWAs"].map(
            (cat) => (
              <div
                key={cat}
                style={{
                  background: "#23242A",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 15,
                  borderRadius: 20,
                  padding: "7px 18px",
                  marginBottom: 6,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {/* Icon placeholder */}
                <span style={{ fontSize: 18 }}>
                  {cat === "Memes"
                    ? "😺"
                    : cat === "AI"
                    ? "🧠"
                    : cat === "DeFi"
                    ? "💳"
                    : cat === "Gaming"
                    ? "🎮"
                    : cat === "NFTs"
                    ? "🖼️"
                    : cat === "L2s"
                    ? "⚡"
                    : "🏦"}
                </span>
                {cat}
              </div>
            )
          )}
        </div>
      </div>

      {/* All assets - Top gainers */}
      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            color: "#bfc9d4",
            fontWeight: 600,
            fontSize: 18,
            marginBottom: 8,
          }}
        >
          All assets
        </div>
        <div
          style={{
            color: "#6c7685",
            fontWeight: 500,
            fontSize: 15,
            marginBottom: 8,
          }}
        >
          Based on the last 24 hours
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            background: "#23242A",
            borderRadius: 14,
            padding: "12px 14px",
            justifyContent: "space-between",
            marginBottom: 6,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                background: "#1ecb81",
                borderRadius: 8,
                width: 28,
                height: 28,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="18" height="18" fill="none" viewBox="0 0 20 20">
                <path
                  d="M10 3v14M10 3l-4 4M10 3l4 4"
                  stroke="#fff"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div>
              <div style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>
                Top gainers
              </div>
              <div style={{ color: "#bfc9d4", fontWeight: 500, fontSize: 14 }}>
                HYPER
              </div>
            </div>
          </div>
          <div style={{ color: "#1ecb81", fontWeight: 700, fontSize: 18 }}>
            +10.63%
          </div>
        </div>
      </div>
    </>
  );
}

// SpotTabPanel component
function SpotTabPanel(props: {
  markets: any[];
  market: string;
  setMarket: (v: string) => void;
  sendLabel: string;
  sendBal: number;
  sendAssetSymbol: string;
  sendAmount: string;
  handleSendAmount: (v: string) => void;
  price: number | null;
  percent: number | null;
  handlePercent: (v: number) => void;
  receiveLabel: string;
  receiveBal: number;
  receiveAssetSymbol: string;
  receiveAmount: string;
  handleReceiveAmount: (v: string) => void;
  handleFlip: () => void;
  loading: boolean;
}) {
  const {
    markets,
    market,
    setMarket,
    sendLabel,
    sendBal,
    sendAssetSymbol,
    sendAmount,
    handleSendAmount,
    price,
    percent,
    handlePercent,
    receiveLabel,
    receiveBal,
    receiveAssetSymbol,
    receiveAmount,
    handleReceiveAmount,
    handleFlip,
    loading,
  } = props;
  return (
    <div
      style={{
        paddingTop: 8,
        color: "#fff",
        maxWidth: 400,
        margin: "0 auto",
        fontFamily: "Inter, sans-serif",
      }}
    >
      {/* Market selector */}
      <div style={{ marginBottom: 8 }}>
        <select
          value={market}
          onChange={(e) => setMarket(e.target.value)}
          style={{
            background: "#23242A",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            padding: "7px 12px",
            fontWeight: 700,
            fontSize: 18,
            width: "100%",
          }}
        >
          {markets.map((m) => (
            <option key={m.name || m.symbol} value={m.name || m.symbol}>
              {m.name || m.symbol}
            </option>
          ))}
        </select>
      </div>
      {/* Send panel */}
      <div
        style={{
          background: "#181A20",
          borderRadius: 14,
          padding: 12,
          marginBottom: 8,
          boxShadow: "0 2px 8px #0002",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img
              src={typeof btcIcon === "string" ? btcIcon : btcIcon.src}
              alt={sendLabel}
              width={28}
              height={28}
              style={{ borderRadius: 14, background: "#23242A" }}
            />
            <span style={{ color: "#fff", fontWeight: 700, fontSize: 18 }}>
              {sendLabel}
            </span>
          </div>
          <span style={{ color: "#7ecbff", fontWeight: 500, fontSize: 14 }}>
            Balance: {formatBalance(sendBal)} {sendAssetSymbol}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <input
            type="number"
            value={sendAmount}
            onChange={(e) => handleSendAmount(e.target.value)}
            placeholder="0"
            style={{
              flex: 1,
              background: "none",
              color: "#fff",
              border: "none",
              fontSize: 28,
              fontWeight: 700,
              outline: "none",
              letterSpacing: 1,
            }}
          />
        </div>
        <div
          style={{
            color: "#bfc9d4",
            fontSize: 15,
            fontWeight: 500,
            marginBottom: 6,
          }}
        >
          $
          {sendAmount && price
            ? (parseFloat(sendAmount) * price).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })
            : "0.00"}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[25, 50, 100].map((pct) => (
            <button
              key={pct}
              onClick={() => handlePercent(pct)}
              style={{
                flex: 1,
                background: percent === pct ? "#00C2FF" : "#23242A",
                color: percent === pct ? "#181A20" : "#aaa",
                border: "1px solid #333",
                borderRadius: 7,
                fontWeight: 700,
                fontSize: 14,
                padding: "5px 0",
                cursor: "pointer",
                transition: "background 0.15s",
              }}
            >
              {pct}%
            </button>
          ))}
        </div>
      </div>
      {/* Down arrow */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          margin: "6px 0",
        }}
      >
        <button
          onClick={handleFlip}
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            background: "#23242A",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 2px 8px #0002",
            border: "none",
            cursor: "pointer",
            transition: "background 0.15s",
          }}
          aria-label="Flip assets"
        >
          <span style={{ fontSize: 20, color: "#7ecbff", fontWeight: 700 }}>
            ↓
          </span>
        </button>
      </div>
      {/* Receive panel */}
      <div
        style={{
          background: "#181A20",
          borderRadius: 14,
          padding: 12,
          marginBottom: 8,
          boxShadow: "0 2px 8px #0002",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img
              src={typeof btcIcon === "string" ? btcIcon : btcIcon.src}
              alt={receiveLabel}
              width={28}
              height={28}
              style={{ borderRadius: 14, background: "#23242A" }}
            />
            <span style={{ color: "#fff", fontWeight: 700, fontSize: 18 }}>
              {receiveLabel}
            </span>
          </div>
          <span style={{ color: "#7ecbff", fontWeight: 500, fontSize: 14 }}>
            Balance: {formatBalance(receiveBal)} {receiveAssetSymbol}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <input
            type="number"
            value={receiveAmount}
            onChange={(e) => handleReceiveAmount(e.target.value)}
            placeholder="0"
            style={{
              flex: 1,
              background: "none",
              color: "#fff",
              border: "none",
              fontSize: 28,
              fontWeight: 700,
              outline: "none",
              letterSpacing: 1,
            }}
          />
        </div>
        <div
          style={{
            color: "#bfc9d4",
            fontSize: 15,
            fontWeight: 500,
            marginBottom: 6,
          }}
        >
          $
          {receiveAmount && price
            ? parseFloat(receiveAmount).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })
            : "0.00"}
        </div>
      </div>
      {/* Swap button (stub) */}
      <Button
        fullWidth
        color="blue"
        style={{
          fontWeight: 700,
          fontSize: 16,
          height: 38,
          borderRadius: 10,
          marginTop: 4,
        }}
        disabled
      >
        Swap (Coming Soon)
      </Button>
    </div>
  );
}

export default function TradePage() {
  const [activeTab, setActiveTab] = useState<"perps" | "spot">("perps");

  // Spot state
  const [markets, setMarkets] = useState<any[]>([]);
  const [market, setMarket] = useState<string>("");
  const [sendAmount, setSendAmount] = useState("");
  const [receiveAmount, setReceiveAmount] = useState("");
  const [balances, setBalances] = useState<any[]>([]);
  const [sendAsset, setSendAsset] = useState<string>("");
  const [receiveAsset, setReceiveAsset] = useState<string>("");
  const [sendBalance, setSendBalance] = useState<number>(0);
  const [receiveBalance, setReceiveBalance] = useState<number>(0);
  const [price, setPrice] = useState<number | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [flipped, setFlipped] = useState(false);

  // Fetch spot markets and balances
  useEffect(() => {
    if (activeTab !== "spot") return;
    async function fetchMarketsAndBalances() {
      setLoading(true);
      try {
        const sdk = new Hyperliquid({
          enableWs: true,
          privateKey: "",
          testnet: false,
          walletAddress: "", // trader address
          maxReconnectAttempts: 5,
        });
        const meta = await sdk.info.spot.getSpotMeta();
        let marketList: any[] = [];
        if (Array.isArray(meta)) {
          marketList = meta;
        } else if (meta && typeof meta === "object") {
          for (const key in meta) {
            if (Array.isArray(meta[key as keyof typeof meta])) {
              marketList = meta[key as keyof typeof meta];
              break;
            }
          }
        }
        if (!marketList.length) {
          marketList = [{ name: "PURR-SPOT", base: "PURR", quote: "USDC" }];
        }
        setMarkets(marketList);
        setMarket(marketList[0].name || marketList[0].symbol || "");
        setSendAsset(marketList[0].base || marketList[0].baseAsset || "");
        setReceiveAsset(marketList[0].quote || marketList[0].quoteAsset || "");
        // Fetch balances
        const bal = await sdk.info.spot.getSpotClearinghouseState(
          "" // add address
        );
        setBalances(bal.balances || []);
      } catch (e) {
        setMarkets([{ name: "PURR-SPOT", base: "PURR", quote: "USDC" }]);
        setMarket("PURR-SPOT");
        setSendAsset("PURR");
        setReceiveAsset("USDC");
      }
      setLoading(false);
    }
    fetchMarketsAndBalances();
  }, [activeTab]);

  // Update balances for selected assets
  useEffect(() => {
    if (activeTab !== "spot") return;
    setSendBalance(balances.find((b) => b.coin === sendAsset)?.total || 0);
    setReceiveBalance(
      balances.find((b) => b.coin === receiveAsset)?.total || 0
    );
  }, [balances, sendAsset, receiveAsset, activeTab]);

  // Update price for selected market (placeholder)
  useEffect(() => {
    if (activeTab !== "spot") return;
    async function fetchPrice() {
      if (!market) return;
      setPrice(null); // TODO: Replace with SDK call for spot price
    }
    fetchPrice();
  }, [market, activeTab]);

  // When market changes, update send/receive asset
  useEffect(() => {
    if (activeTab !== "spot") return;
    const m = markets.find((m) => m.name === market || m.symbol === market);
    if (m) {
      setSendAsset(m.base || m.baseAsset || "");
      setReceiveAsset(m.quote || m.quoteAsset || "");
    }
  }, [market, markets, activeTab]);

  // Handle percent buttons
  const handlePercent = (pct: number) => {
    setPercent(pct);
    const amt = (((parseFloat(sendBal as any) || 0) * pct) / 100).toFixed(4);
    setSendAmount(amt);
    // Optionally update receive amount if price is known
    if (price) setReceiveAmount((parseFloat(amt) * price).toFixed(4));
    else setReceiveAmount("");
  };

  // Handle send amount change
  const handleSendAmount = (val: string) => {
    setSendAmount(val);
    setPercent(null);
    if (price) setReceiveAmount((parseFloat(val) * price).toFixed(4));
    else setReceiveAmount("");
  };

  // Handle receive amount change
  const handleReceiveAmount = (val: string) => {
    setReceiveAmount(val);
    setPercent(null);
    if (price && price !== 0)
      setSendAmount((parseFloat(val) / price).toFixed(4));
    else setSendAmount("");
  };

  // Use asset symbols for panel headers, fallback to market name split if missing
  let base = sendAsset;
  let quote = receiveAsset;
  if (!base || !quote) {
    const parts = (market || "").split("-");
    if (parts.length === 2) {
      base = parts[0];
      quote = "USD";
    } else {
      base = base || "Base";
      quote = "USD";
    }
  }
  let sendLabel = flipped ? quote : base;
  let receiveLabel = flipped ? base : quote;
  let sendAssetSymbol = flipped ? quote : base;
  let receiveAssetSymbol = flipped ? base : quote;

  // Helper to get balance for an asset, treating USD as USDC if needed
  function getAssetBalance(asset: string) {
    if (asset === "USD") {
      // Try to find USDC or USD in balances
      const usdc = balances.find(
        (b) => b.coin === "USDC" || b.coin === "USDC-SPOT"
      );
      if (usdc) return usdc.total;
      const usd = balances.find(
        (b) => b.coin === "USD" || b.coin === "USD-SPOT"
      );
      if (usd) return usd.total;
      return 0;
    }
    // Try both asset and asset-SPOT
    const bal = balances.find(
      (b) => b.coin === asset || b.coin === asset + "-SPOT"
    );
    return bal ? bal.total : 0;
  }

  let sendBal = getAssetBalance(sendAssetSymbol);
  let receiveBal = getAssetBalance(receiveAssetSymbol);

  // Flip handler
  const handleFlip = () => {
    setFlipped((f) => !f);
    setSendAmount(receiveAmount);
    setReceiveAmount(sendAmount);
    setPercent(null);
  };

  return (
    <div style={{ color: "#fff", padding: 16 }}>
      <Tabs
        value={activeTab}
        onChange={(v) => setActiveTab(v as "perps" | "spot")}
      >
        <Tabs.List grow justify="space-between">
          <Tabs.Tab value="perps">Perps</Tabs.Tab>
          <Tabs.Tab value="spot">Spot</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="perps">
          <PerpsTabPanel />
        </Tabs.Panel>
        <Tabs.Panel value="spot">
          <SpotTabPanel
            markets={markets}
            market={market}
            setMarket={setMarket}
            sendLabel={sendLabel}
            sendBal={sendBal}
            sendAssetSymbol={sendAssetSymbol}
            sendAmount={sendAmount}
            handleSendAmount={handleSendAmount}
            price={price}
            percent={percent}
            handlePercent={handlePercent}
            receiveLabel={receiveLabel}
            receiveBal={receiveBal}
            receiveAssetSymbol={receiveAssetSymbol}
            receiveAmount={receiveAmount}
            handleReceiveAmount={handleReceiveAmount}
            handleFlip={handleFlip}
            loading={loading}
          />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
