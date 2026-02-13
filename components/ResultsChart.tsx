"use client";

import {
  LineChart,
  Line,
  BarChart,
  Bar,
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
  period?: string | null;
}

function formatDollar(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value}`;
}

// Strip " YTD" from axis labels — keep just the year number
function formatAxisYear(value: string): string {
  return value.replace(" YTD", "");
}

export default function ResultsChart({ data, period }: ResultsChartProps) {
  if (!data || data.length === 0) return null;

  const isSinglePoint = data.length === 1;
  const tickFontSize = data.length > 18 ? 10 : data.length > 12 ? 11 : 12;

  return (
    <div className="w-full bg-white rounded-2xl border border-gray-100 p-6 mt-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-1">
        Growth of $10,000
      </h3>
      <p className="text-sm text-gray-400 mb-6">
        Strategy performance vs S&amp;P 500{period === "1yr" ? ` (${data[0]?.date})` : " over time"}
      </p>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          {isSinglePoint ? (
            <BarChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }} barGap={8}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="date"
                tickFormatter={formatAxisYear}
                tick={{ fontSize: 12, fill: "#9ca3af" }}
                axisLine={{ stroke: "#e5e7eb" }}
                tickLine={false}
              />
              <YAxis
                tickFormatter={formatDollar}
                tick={{ fontSize: 12, fill: "#9ca3af" }}
                axisLine={{ stroke: "#e5e7eb" }}
                tickLine={false}
                domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.15)]}
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
              <Bar dataKey="strategy" fill="#2563eb" radius={[6, 6, 0, 0]} barSize={80} />
              <Bar dataKey="benchmark" fill="#9ca3af" radius={[6, 6, 0, 0]} barSize={80} />
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="date"
                interval={0}
                tickFormatter={formatAxisYear}
                tick={{ fontSize: tickFontSize, fill: "#9ca3af" }}
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
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
