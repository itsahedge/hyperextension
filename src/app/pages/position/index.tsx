import React from "react";
// import { QRCodeSVG } from 'qrcode.react';

interface PositionPageProps {
  pos: any;
  onBack: () => void;
}

const PositionPage: React.FC<PositionPageProps> = ({ pos, onBack }) => {
  // Extract real data from pos, fallback to '--' or 0 if missing
  const base = pos.coin?.replace(/-PERP$/, "") || "--";
  const side = Number(pos.szi) > 0 ? "LONG" : "SHORT";
  const leverage = pos.leverage?.value ?? "--";
  const pnl = pos.unrealizedPnl ?? 0;
  const pnlPct = (pos.returnOnEquity ?? 0) * 100;
  const value = pos.positionValue ?? 0;
  const collateral = pos.marginUsed ?? 0;
  const entryPx = pos.entryPx ?? "--";
  const currentPx = pos.markPx ?? "--";
  const liqPx = pos.liquidationPx ?? "--";
  const fundingRate = pos.fundingRate ?? 0.013; // fallback
  const fundingRateHour = pos.fundingRateHour ?? 0.013; // fallback
  const fundingReceived = pos.fundingReceived ?? 0;
  // About section (use placeholders for now)
  const vol24h = pos.vol24h ?? 20565570.84;
  const openInterest = pos.openInterest ?? 40851357.83;
  const color = side === "LONG" ? "#00FF7F" : "#ff4d4f";

  return (
    <div
      style={{
        color: "#fff",
        padding: 16,
        fontFamily: "Inter, sans-serif",
        minHeight: 600,
      }}
    >
      <button
        onClick={onBack}
        style={{
          marginBottom: 16,
          padding: "6px 16px",
          borderRadius: 8,
          background: "#23242A",
          color: "#fff",
          border: "none",
          cursor: "pointer",
          fontWeight: 500,
          fontSize: 16,
        }}
      >
        ← Back
      </button>
      <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 8 }}>
        Your position
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 8,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 18, color: "#fff" }}>
          🪙 {base}
        </span>
        <span
          style={{
            background: color,
            color: "#111",
            fontWeight: 700,
            fontSize: 13,
            borderRadius: 8,
            padding: "2px 10px",
            marginLeft: 4,
          }}
        >
          {leverage}x {side}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 8,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 32, color: "#fff" }}>
          ${Number(value).toFixed(2)}
        </span>
        <span
          style={{
            color: pnl < 0 ? "#ff4d4f" : "#00FF7F",
            fontWeight: 700,
            fontSize: 18,
          }}
        >
          {pnl >= 0 ? "+" : ""}${Number(pnl).toFixed(2)} (
          {pnlPct >= 0 ? "+" : ""}
          {Number(pnlPct).toFixed(2)}%)
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
          <button
            style={{
              background: "none",
              border: "none",
              color: "#fff",
              fontSize: 20,
              cursor: "pointer",
            }}
            title="View"
          >
            <span role="img" aria-label="View">
              👁️
            </span>
          </button>
          <button
            style={{
              background: "none",
              border: "none",
              color: "#fff",
              fontSize: 20,
              cursor: "pointer",
            }}
            title="Share"
          >
            <span role="img" aria-label="Share">
              🔗
            </span>
          </button>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          margin: "24px 0 12px 0",
        }}
      >
        <div style={{ flex: 1, height: 1, background: "#23242A" }} />
        <span
          style={{
            fontWeight: 800,
            fontSize: 24,
            color: "#fff",
            margin: "0 16px",
            letterSpacing: 1,
          }}
        >
          NAME_HERE
        </span>
        <div style={{ flex: 1, height: 1, background: "#23242A" }} />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 16,
          }}
        >
          <span>Collateral</span>
          <span>${Number(collateral).toFixed(2)}</span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 16,
          }}
        >
          <span>Entry price</span>
          <span>${Number(entryPx).toFixed(5)}</span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 16,
          }}
        >
          <span>Current price</span>
          <span>
            {currentPx !== "--" ? `$${Number(currentPx).toFixed(5)}` : "--"}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 16,
          }}
        >
          <span>
            Liquidation price{" "}
            <span
              style={{ color: "#888", fontSize: 13 }}
              title="If price hits this, position is liquidated"
            >
              ⓘ
            </span>
          </span>
          <span>{liqPx !== "--" ? `$${Number(liqPx).toFixed(6)}` : "--"}</span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 16,
          }}
        >
          <span>Funding rate</span>
          <span style={{ color: color }}>
            {fundingRateHour > 0 ? "+" : ""}
            {Number(fundingRateHour).toFixed(4)}% / hr
          </span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 16,
          }}
        >
          <span>Funding received</span>
          <span>${Number(fundingReceived)}</span>
        </div>
      </div>
      <div style={{ fontWeight: 700, fontSize: 18, margin: "24px 0 8px 0" }}>
        About
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 16,
          }}
        >
          <span>
            Funding rate{" "}
            <span
              style={{ color: "#888", fontSize: 13 }}
              title="How much you pay/receive per hour"
            >
              ⓘ
            </span>
          </span>
          <span>{Number(fundingRate).toFixed(3)}%</span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 16,
          }}
        >
          <span>24h volume</span>
          <span>
            $
            {Number(vol24h).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 16,
          }}
        >
          <span>Open interest</span>
          <span>
            $
            {Number(openInterest).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
      </div>
      <div style={{ color: "#888", fontSize: 13, marginBottom: 24 }}>
        NAME_HERE is not an exchange and does not provide investment advice.
      </div>
      <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
        <button
          style={{
            flex: 1,
            background: "#23242A",
            color: "#fff",
            border: "none",
            borderRadius: 24,
            fontWeight: 700,
            fontSize: 18,
            padding: "16px 0",
            cursor: "pointer",
          }}
        >
          Modify
        </button>
        <button
          style={{
            flex: 2,
            background: "#00FF7F",
            color: "#111",
            border: "none",
            borderRadius: 24,
            fontWeight: 700,
            fontSize: 18,
            padding: "16px 0",
            cursor: "pointer",
          }}
        >
          Cash out ${Number(collateral).toFixed(2)}
        </button>
      </div>
    </div>
  );
};

export default PositionPage;
