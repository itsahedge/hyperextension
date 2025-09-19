import React, { useEffect, useState } from "react";
import { Table, Badge } from "@mantine/core";
import { PnlCombinedChart } from "../../components/PnlCombinedChart";

export default function TraderProfilePage({
  trader,
  ethereum_address,
  onBack,
}: {
  trader: string;
  ethereum_address: string;
  onBack: () => void;
}) {
  const [positions, setPositions] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pnlHistory, setPnlHistory] = useState<[number, number][] | null>(null);
  const [pnlHistoryLoading, setPnlHistoryLoading] = useState(true);
  const [pnlHistoryError, setPnlHistoryError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setPnlHistoryLoading(true);
    setPnlHistoryError(null);
    fetch("http://localhost:1947/api/hyperliquid/traderProfile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ethereum_address }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          setPositions(null);
        } else {
          // Use clearinghouseState for positions
          setPositions(data.clearinghouseState.assetPositions || []);
        }
        setLoading(false);
        // Handle pnlHistory
        if (data.error) {
          setPnlHistoryError(data.error);
          setPnlHistory(null);
        } else if (data.pnlHistory) {
          setPnlHistory(data.pnlHistory);
        } else {
          setPnlHistory(null);
        }
        setPnlHistoryLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setPositions(null);
        setLoading(false);
        setPnlHistoryError(String(err));
        setPnlHistory(null);
        setPnlHistoryLoading(false);
      });
  }, [ethereum_address]);

  return (
    <div style={{ color: "#fff", padding: 16 }}>
      <button
        onClick={onBack}
        style={{
          marginBottom: 16,
          padding: "6px 16px",
          borderRadius: 6,
          background: "#23242A",
          color: "#fff",
          border: "none",
          cursor: "pointer",
          fontWeight: 500,
        }}
      >
        ← Back
      </button>
      <h2>@{trader}</h2>
      <div style={{ marginTop: 24 }}>
        <p>
          <span>
            Address: <b>{ethereum_address}</b>
          </span>
        </p>
        {/* PnL Combined Chart */}
        <div style={{ margin: "32px 0" }}>
          <h4>All PnL (Combined)</h4>
          <PnlCombinedChart
            loading={pnlHistoryLoading}
            error={pnlHistoryError}
            data={pnlHistory}
          />
        </div>
        {loading && <p>Loading positions...</p>}
        {error && <p style={{ color: "red" }}>Error: {error}</p>}
        {positions && (
          <div>
            <h4>Open Positions</h4>
            {positions.length === 0 ? (
              <p>No open positions.</p>
            ) : (
              <Table
                highlightOnHover
                withTableBorder
                withColumnBorders
                striped
                style={{
                  marginTop: 16,
                  background: "#181A20",
                  color: "#fff",
                  borderRadius: 8,
                  overflow: "hidden",
                }}
                styles={{
                  th: {
                    background: "#181A20",
                    color: "#fff",
                    borderColor: "#222",
                  },
                  td: {
                    background: "#181A20",
                    color: "#fff",
                    borderColor: "#222",
                  },
                }}
              >
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Asset</Table.Th>
                    <Table.Th>Position Value / Size</Table.Th>
                    <Table.Th>Unrealized PnL</Table.Th>
                    <Table.Th>Entry Price</Table.Th>
                    <Table.Th>Current Price</Table.Th>
                    <Table.Th>Liq. Price</Table.Th>
                    <Table.Th>Margin Used</Table.Th>
                    <Table.Th>Funding</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {positions.map((pos, idx) => {
                    const p = pos.position;
                    const isLong = Number(p.szi) > 0;
                    // Calculate PnL % if possible
                    let pnlPercent = null;
                    if (Number(p.marginUsed) !== 0) {
                      pnlPercent = (
                        (Number(p.unrealizedPnl) /
                          Math.abs(Number(p.marginUsed))) *
                        100
                      ).toFixed(2);
                    }
                    // Remove '-PERP' or '-SPOT' from asset name
                    const assetName = p.coin.replace(/-(PERP|SPOT)$/i, "");
                    const fundingValue = -Number(p.cumFunding?.sinceOpen || 0);
                    return (
                      <Table.Tr key={idx}>
                        <Table.Td>
                          <span
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "flex-start",
                              gap: 2,
                            }}
                          >
                            <span
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              {assetName}
                              <Badge
                                color={isLong ? "green" : "red"}
                                variant="filled"
                                size="sm"
                                style={{
                                  // textTransform: "lowercase",
                                  fontWeight: 700,
                                  fontSize: 13,
                                  borderRadius: 12,
                                  width: 22,
                                  height: 22,
                                  padding: 0,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                {isLong ? "L" : "S"}
                              </Badge>
                            </span>
                            <span
                              style={{
                                fontSize: 13,
                                color: "#aaa",
                                marginLeft: 0,
                                marginTop: 2,
                              }}
                            >
                              ({p.leverage.value}x)
                            </span>
                          </span>
                        </Table.Td>
                        <Table.Td>
                          <span
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "flex-start",
                            }}
                          >
                            <span style={{ fontWeight: 700 }}>
                              $
                              {Number(p.positionValue).toLocaleString(
                                undefined,
                                { maximumFractionDigits: 2 }
                              )}
                            </span>
                            <span style={{ fontSize: "80%" }}>
                              {Number(p.szi).toLocaleString(undefined, {
                                maximumFractionDigits: 4,
                              })}
                            </span>
                            <span style={{ fontSize: "80%" }}>{assetName}</span>
                          </span>
                        </Table.Td>
                        <Table.Td
                          style={{
                            color:
                              Number(p.unrealizedPnl) >= 0
                                ? "#00FF7F"
                                : "#ff4d4f",
                          }}
                        >
                          $
                          {Number(p.unrealizedPnl).toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })}
                          <br />
                          {pnlPercent !== null && (
                            <span
                              style={{
                                color:
                                  Number(p.unrealizedPnl) >= 0
                                    ? "#00FF7F"
                                    : "#ff4d4f",
                                fontSize: 12,
                              }}
                            >
                              {Number(p.unrealizedPnl) >= 0 ? "+" : ""}
                              {pnlPercent}%
                            </span>
                          )}
                        </Table.Td>
                        <Table.Td>
                          $
                          {Number(p.entryPx).toLocaleString(undefined, {
                            maximumFractionDigits: 4,
                          })}
                        </Table.Td>
                        <Table.Td>
                          $
                          {Number(p.markPx).toLocaleString(undefined, {
                            maximumFractionDigits: 4,
                          })}
                        </Table.Td>
                        <Table.Td>
                          $
                          {Number(p.liquidationPx).toLocaleString(undefined, {
                            maximumFractionDigits: 4,
                          })}
                        </Table.Td>
                        <Table.Td>
                          $
                          {Number(p.marginUsed).toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })}
                        </Table.Td>
                        <Table.Td
                          style={{
                            color: fundingValue >= 0 ? "#00FF7F" : "#ff4d4f",
                          }}
                        >
                          $
                          {fundingValue.toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
