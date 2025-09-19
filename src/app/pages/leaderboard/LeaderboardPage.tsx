import React, { useState, useEffect } from "react";
import { Table } from "@mantine/core";
import TraderProfilePage from "../trader/TraderProfilePage";

export default function LeaderboardPage() {
  const [selectedTrader, setSelectedTrader] = useState<string | null>(null);
  const fakeData = [
    {
      trader: "@JamesWynn",
      perpEquity: 16000000,
      allTimePnl: 44980000,
      ethereum_address: "0x5078C2fBeA2b2aD61bc840Bc023E35Fce56BeDb6",
    },
    {
      trader: "@alice",
      perpEquity: 16000000,
      allTimePnl: 44980000,
      ethereum_address: "0x56498e5f90c14060499b62b6f459b3e3fb9280c5",
    },
    {
      trader: "@bob",
      perpEquity: 7840000,
      allTimePnl: 30890000,
      ethereum_address: "0xbfc79c444c41a74516bf31237ebf586a231480b4",
    },
    {
      trader: "@carol",
      perpEquity: 26160000,
      allTimePnl: 27650000,
      ethereum_address: "0x8cc94dc843e1ea7a19805e0cca43001123512b6a",
    },
    {
      trader: "@dan",
      perpEquity: 11090000,
      allTimePnl: 26500000,
      ethereum_address: "0xa4dedda59f2908b92ae192cfd494839373bcb3c4",
    },
  ];

  if (selectedTrader) {
    const traderObj = fakeData.find(
      (row) => row.ethereum_address === selectedTrader
    );
    return (
      <TraderProfilePage
        trader={traderObj?.trader.replace("@", "") || ""}
        ethereum_address={traderObj?.ethereum_address || ""}
        onBack={() => setSelectedTrader(null)}
      />
    );
  }

  return (
    <div style={{ color: "#fff", padding: 16 }}>
      <h4>Leaderboard</h4>
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
          th: { background: "#181A20", color: "#fff", borderColor: "#222" },
          td: { background: "#181A20", color: "#fff", borderColor: "#222" },
        }}
      >
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ textAlign: "left" }}>Trader</Table.Th>
            <Table.Th style={{ textAlign: "right" }}>Perp Equity</Table.Th>
            <Table.Th style={{ textAlign: "right" }}>All Time PnL</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {fakeData.map((row, idx) => (
            <Table.Tr
              key={idx}
              style={{
                cursor: "pointer",
                transition: "background 0.2s",
              }}
              onClick={() => setSelectedTrader(row.ethereum_address)}
              onMouseOver={(e) =>
                (e.currentTarget.style.background = "#23242A")
              }
              onMouseOut={(e) => (e.currentTarget.style.background = "#181A20")}
            >
              <Table.Td>{row.trader}</Table.Td>
              <Table.Td style={{ textAlign: "right" }}>
                ${(row.perpEquity / 1e6).toFixed(2)}M
              </Table.Td>
              <Table.Td
                style={{
                  textAlign: "right",
                  color: row.allTimePnl >= 0 ? "#00FF7F" : "#ff4d4f",
                  fontWeight: 600,
                }}
              >
                {row.allTimePnl >= 0 ? "+" : ""}$
                {(row.allTimePnl / 1e6).toFixed(2)}M
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </div>
  );
}
