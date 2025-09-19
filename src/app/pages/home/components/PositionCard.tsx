import btcIconImport from "data-base64:~assets/bitcoin-small.png";
import ethIconImport from "data-base64:~assets/ethereum-small.png";
import solIconImport from "data-base64:~assets/solana-small.png";
import usdcIconImport from "data-base64:~assets/usdc-small.png";
import hypeIconImport from "data-base64:~assets/hyperliquid.png";

const btcIcon =
  typeof btcIconImport === "string" ? btcIconImport : btcIconImport.src;
const ethIcon =
  typeof ethIconImport === "string" ? ethIconImport : ethIconImport.src;
const solIcon =
  typeof solIconImport === "string" ? solIconImport : solIconImport.src;
const usdcIcon =
  typeof usdcIconImport === "string" ? usdcIconImport : usdcIconImport.src;
const hypeIcon =
  typeof hypeIconImport === "string" ? hypeIconImport : hypeIconImport.src;

const coinIcons: Record<string, string> = {
  BTC: btcIcon,
  "BTC-PERP": btcIcon,
  ETH: ethIcon,
  "ETH-PERP": ethIcon,
  SOL: solIcon,
  "SOL-PERP": solIcon,
  USDC: usdcIcon,
  "USDC-PERP": usdcIcon,
  HYPERLIQUID: hypeIcon,
  "HYPERLIQUID-PERP": hypeIcon,
  // Add more as needed
};

function getCoinIcon(coin: string) {
  // Try base asset first
  const base = coin.replace(/-PERP$/, "");
  return coinIcons[coin] || coinIcons[base] || hypeIcon;
}

function getSideAndColor(szi: number) {
  if (szi > 0) return { side: "LONG", color: "#00FF7F" };
  if (szi < 0) return { side: "SHORT", color: "#ff4d4f" };
  return { side: "--", color: "#aaa" };
}

export const PositionCard = ({ pos }: { pos: any }) => {
  const icon = getCoinIcon(pos.coin);
  const base = pos.coin.replace(/-PERP$/, "");
  const { side, color } = getSideAndColor(Number(pos.szi));
  const lev =
    pos.leverage &&
    typeof pos.leverage === "object" &&
    pos.leverage.value !== undefined
      ? `${Number(pos.leverage.value).toFixed(0)}×`
      : "--";
  const pnl = Number(pos.unrealizedPnl);
  const pnlColor = pnl > 0 ? "#00FF7F" : pnl < 0 ? "#ff4d4f" : "#aaa";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        background: "#181A20",
        borderRadius: 16,
        padding: "12px 16px",
        boxShadow: "0 2px 8px #0002",
        justifyContent: "space-between",
        minWidth: 0,
        maxWidth: 600,
        width: "100%",
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}
      >
        <img
          src={icon}
          alt={base}
          width={20}
          height={20}
          style={{ borderRadius: 10, background: "#23242A" }}
        />
        <span
          style={{
            color: "#fff",
            fontWeight: 700,
            fontSize: 17,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 180,
          }}
        >
          {base}
        </span>
        <span
          style={{
            background: "#23272F",
            color,
            fontWeight: 700,
            fontSize: 12,
            borderRadius: 8,
            padding: "2px 8px",
            marginLeft: 8,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            minWidth: 36,
            lineHeight: 1.1,
          }}
        >
          <span style={{ fontSize: 10 }}>{lev}</span>
          <span style={{ fontWeight: 700, fontSize: 12 }}>{side}</span>
        </span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 1,
          minWidth: 0,
        }}
      >
        <div
          style={{
            color: pnlColor,
            fontWeight: 700,
            fontSize: 16,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          {pnl > 0 && <span style={{ fontSize: 14 }}>▲</span>}
          {pnl < 0 && <span style={{ fontSize: 14 }}>▼</span>}$
          {Math.abs(pnl).toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          })}
        </div>
        <div style={{ color: "#fff", fontWeight: 500, fontSize: 15 }}>
          $
          {Number(pos.positionValue).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </div>
      </div>
    </div>
  );
};
