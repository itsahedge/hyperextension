import React, { useEffect, useState } from "react";
import {
  Card,
  Text,
  Group,
  Collapse,
  Box,
  Loader,
  Center,
} from "@mantine/core";
import { Storage } from "@plasmohq/storage";

const ActivityPage: React.FC = () => {
  const [opened, setOpened] = useState<{ [key: string]: boolean }>({});
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activities, setActivities] = useState<any[]>([]);

  useEffect(() => {
    const fetchProfileAndActivity = async () => {
      setLoading(true);
      setError(null);
      try {
        const storage = new Storage({ area: "local" });
        const userProfileRaw = await storage.getItem("userProfile");
        let userProfile: any = null;
        if (typeof userProfileRaw === "string") {
          try {
            userProfile = JSON.parse(userProfileRaw);
          } catch {
            userProfile = null;
          }
        } else if (
          typeof userProfileRaw === "object" &&
          userProfileRaw !== null
        ) {
          userProfile = userProfileRaw;
        }
        setProfile(userProfile);
        if (userProfile && userProfile.ethereum_address) {
          // Fetch activity data from API
          const res = await fetch(
            "http://localhost:1947/api/hyperliquid/activity",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ethereum_address: userProfile.ethereum_address,
              }),
            }
          );
          if (!res.ok) throw new Error("Failed to fetch activity");
          const data = await res.json();
          // Process fills into grouped activities by date
          const fills = Array.isArray(data.fills) ? data.fills : [];
          const ledgerUpdates = Array.isArray(data.ledgerUpdates)
            ? data.ledgerUpdates
            : [];

          const allActivities: any[] = [];

          // Normalize fills
          fills.forEach((fill: any) => {
            const dateObj = new Date(fill.time);
            allActivities.push({
              time: fill.time,
              dateObj,
              type: "trade",
              description: `${fill.dir || fill.side} ${fill.coin}`,
              amount:
                typeof fill.closedPnl === "number" && fill.closedPnl !== 0
                  ? (fill.closedPnl > 0 ? "+" : "") +
                    "$" +
                    fill.closedPnl.toFixed(2)
                  : null,
              amountColor:
                typeof fill.closedPnl === "number" && fill.closedPnl !== 0
                  ? fill.closedPnl > 0
                    ? "#00FF7F"
                    : "#FF4D4F"
                  : undefined,
              details: `Coin: ${fill.coin}\nSize: ${fill.sz}\nPrice: $${
                fill.px
              }\nFee: ${fill.fee} ${fill.feeToken || ""}`,
            });
          });

          // Normalize ledgerUpdates
          ledgerUpdates.forEach((entry: any) => {
            const { delta } = entry;
            const dateObj = new Date(entry.time);
            let description = "";
            let amount = null;
            let amountColor = undefined;
            let details = "";

            switch (delta.type) {
              case "deposit":
                description = "Deposited to account";
                amount =
                  "+" + (delta.usdc ? "$" + Number(delta.usdc).toFixed(2) : "");
                amountColor = "#00FF7F";
                details = `Deposit of $${Number(delta.usdc).toFixed(
                  2
                )}\nTx Hash: ${entry.hash}`;
                break;
              case "withdraw":
                description = "Withdrew from account";
                amount =
                  "-" + (delta.usdc ? "$" + Number(delta.usdc).toFixed(2) : "");
                amountColor = "#FF4D4F";
                details = `Withdrawal of $${Number(delta.usdc).toFixed(
                  2
                )} (fee: $${delta.fee || 0})\nTx Hash: ${entry.hash}`;
                break;
              case "spotTransfer":
                description = "Spot transfer";
                amount = delta.usdcValue
                  ? "$" + Number(delta.usdcValue).toFixed(2)
                  : "";
                details = `Token: ${delta.token}\nAmount: ${delta.amount}\nTo: ${delta.destination}\nTx Hash: ${entry.hash}`;
                break;
              case "accountClassTransfer":
                if (delta.toPerp) {
                  description = "Transferred from Spot to Perp";
                  details = `Transfer of $${Number(delta.usdc).toFixed(
                    2
                  )} from Spot to Perp`;
                } else {
                  description = "Transferred from Perp to Spot";
                  details = `Transfer of $${Number(delta.usdc).toFixed(
                    2
                  )} from Perp to Spot`;
                }
                amount = delta.usdc ? "$" + Number(delta.usdc).toFixed(2) : "";
                details += `\nTx Hash: ${entry.hash}`;
                break;
              default:
                description = delta.type;
                details = JSON.stringify(delta) + `\nTx Hash: ${entry.hash}`;
            }

            allActivities.push({
              time: entry.time,
              dateObj,
              type: "ledger",
              description,
              amount,
              amountColor,
              details,
            });
          });

          // Sort all activities by time descending
          allActivities.sort((a, b) => b.time - a.time);

          // Group by date
          const grouped: { [date: string]: any[] } = {};
          allActivities.forEach((activity) => {
            const dateStr = activity.dateObj.toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            });
            if (!grouped[dateStr]) grouped[dateStr] = [];
            grouped[dateStr].push(activity);
          });
          const activitiesArr = Object.entries(grouped).map(
            ([date, items]) => ({
              date,
              items,
            })
          );
          setActivities(activitiesArr);
        } else {
          setActivities([]);
        }
      } catch (err: any) {
        setError(err.message || String(err));
      } finally {
        setLoading(false);
      }
    };
    fetchProfileAndActivity();
  }, []);

  const handleToggle = (key: string) => {
    setOpened((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (loading) {
    return (
      <Center style={{ height: "100%" }}>
        <Loader color="teal" />
      </Center>
    );
  }
  if (error) {
    return (
      <div style={{ color: "#fff", padding: 24 }}>
        <Text c="red">Error: {error}</Text>
      </div>
    );
  }

  return (
    <div style={{ color: "#fff", padding: 24, fontSize: 20 }}>
      <Text size="lg" fw={700} mb="md">
        Transaction History
      </Text>
      {activities.length === 0 && <Text c="#aaa">No activity found.</Text>}
      {activities.map((day, i) => (
        <div key={i} style={{ marginBottom: 24 }}>
          <Text size="sm" c="#aaa" mb={8}>
            {day.date}
          </Text>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {day.items.map((item: any, j: number) => {
              const key = `${i}-${j}`;
              return (
                <Card
                  key={j}
                  shadow="sm"
                  radius="md"
                  p="md"
                  style={{
                    background: "#23242A",
                    color: "#fff",
                    cursor: "pointer",
                    border: "1px solid #282b33",
                    boxShadow: "0 2px 8px #0003",
                  }}
                  onClick={() => handleToggle(key)}
                >
                  <Group justify="space-between" align="flex-end">
                    <div>
                      <Text size="md" fw={500}>
                        {item.description}
                      </Text>
                      {/* Remove timestamp from main card */}
                    </div>
                    {item.amount && (
                      <Text
                        size="md"
                        fw={700}
                        style={{ color: item.amountColor || "#fff" }}
                      >
                        {item.amount}
                      </Text>
                    )}
                  </Group>
                  <Collapse in={opened[key] || false}>
                    <Box mt={12} style={{ color: "#b0b0b0", fontSize: 15 }}>
                      {item.details}
                    </Box>
                  </Collapse>
                </Card>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

export default ActivityPage;
