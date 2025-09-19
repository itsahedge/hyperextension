import React from "react";
import { LineChart } from "@mantine/charts";
import { Paper, Text } from "@mantine/core";
import { SmallLoader } from "./Loader";

// Abbreviate large numbers for y-axis labels
function abbreviateNumber(value: number) {
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(0)}B`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value}`;
}

// Custom tooltip for the LineChart
interface ChartTooltipProps {
  label: string;
  payload: Record<string, any>[] | undefined;
}

function ChartTooltip({ label, payload }: ChartTooltipProps) {
  if (!payload || payload.length === 0) return null;
  return (
    <Paper
      px="md"
      py="sm"
      withBorder
      shadow="md"
      radius="md"
      style={{ background: "#23272F" }}
    >
      <Text fw={500} mb={5}>
        {label}
      </Text>
      {payload.map((item: any) => (
        <Text key={item.name} c={item.color} fz="sm">
          {item.name}: $
          {Number(item.value).toLocaleString(undefined, {
            maximumFractionDigits: 2,
          })}
        </Text>
      ))}
    </Paper>
  );
}

interface PnlCombinedChartProps {
  loading: boolean;
  error: string | null;
  data: [number, number][] | null;
}

export const PnlCombinedChart: React.FC<PnlCombinedChartProps> = ({
  loading,
  error,
  data,
}) => {
  if (loading) return <SmallLoader />;
  if (error) return <div style={{ color: "salmon" }}>{error}</div>;
  if (!data || data.length === 0)
    return <div style={{ color: "#aaa" }}>No PnL history found.</div>;

  return (
    <div
      style={{
        background: "#181A20",
        borderRadius: 8,
        padding: 0,
        marginBottom: 8,
      }}
    >
      <LineChart
        h={180}
        data={data.map(([timestamp, pnl]) => ({
          time: Number(timestamp),
          pnl: Number(pnl),
        }))}
        dataKey="time"
        series={[{ name: "pnl", color: "#1ec9ff" }]}
        curveType="monotone"
        withDots={false}
        tickLine="none"
        yAxisProps={{
          tickFormatter: abbreviateNumber,
          width: 60,
        }}
        xAxisProps={{
          tickFormatter: (v: number) => new Date(v).toLocaleDateString(),
        }}
        style={{ background: "#181A20" }}
        gridProps={{ style: { display: "none" } }}
        tooltipProps={{
          content: ({ label, payload }) => (
            <ChartTooltip
              label={label ? new Date(Number(label)).toLocaleString() : ""}
              payload={payload}
            />
          ),
        }}
      />
    </div>
  );
};
