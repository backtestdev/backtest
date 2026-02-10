"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { ChartDataPoint } from "@/lib/types";

interface ResultsChartProps {
  data: ChartDataPoint[];
}

function formatDollar(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value}`;
}

export default function ResultsChart({ data }: ResultsChartProps) {
  if (!data || data.length === 0) return null;

  return (
    <div className="w-full bg-white rounded-2xl border border-gray-100 p-6 mt-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-1">
        Growth of $10,000
      </h3>
      <p className="text-sm text-gray-400 mb-6">
        Strategy performance vs S&P 500 over time
      </p>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12, fill: "#9ca3af" }}
              axisLine={{ stroke: "#e5e7eb" }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={formatDollar}
              tick={{ fontSize: 12, fill: "#9ca3af" }}
              axisLine={{ stroke: "#e5e7eb" }}
              tickLine={false}
            />
            <Tooltip
              formatter={(value, name) => [
                formatDollar(value as number),
                name === "strategy" ? "Your Strategy" : "S&P 500",
              ]}
              labelFormatter={(label) => `Year: ${label}`}
              contentStyle={{
                borderRadius: "12px",
                border: "1px solid #e5e7eb",
                boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.05)",
              }}
            />
            <Legend
              formatter={(value) =>
                value === "strategy" ? "Your Strategy" : "S&P 500"
              }
            />
            <Line
              type="monotone"
              dataKey="strategy"
              stroke="#2563eb"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="benchmark"
              stroke="#9ca3af"
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
