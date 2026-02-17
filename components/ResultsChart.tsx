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
import { useTheme } from "./ThemeProvider";

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
  const { chartColors } = useTheme();

  if (!data || data.length === 0) return null;

  const isSinglePoint = data.length === 1;
  const tickFontSize = data.length > 18 ? 9 : data.length > 12 ? 10 : 11;

  return (
    <div className="w-full bg-th-surface rounded-2xl border border-th-border-light p-4 sm:p-6 mt-6">
      <h3 className="text-base sm:text-lg font-semibold text-th-text mb-1">
        Growth of $10,000
      </h3>
      <p className="text-xs sm:text-sm text-th-text-3 mb-4 sm:mb-6">
        Strategy performance vs S&amp;P 500{period === "1yr" ? ` (${data[0]?.date})` : " over time"}
      </p>
      <div className="h-56 sm:h-72 md:h-80 no-transition">
        <ResponsiveContainer width="100%" height="100%">
          {isSinglePoint ? (
            <BarChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }} barGap={8}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
              <XAxis
                dataKey="date"
                tickFormatter={formatAxisYear}
                tick={{ fontSize: 12, fill: chartColors.tick }}
                axisLine={{ stroke: chartColors.axis }}
                tickLine={false}
              />
              <YAxis
                tickFormatter={formatDollar}
                tick={{ fontSize: 12, fill: chartColors.tick }}
                axisLine={{ stroke: chartColors.axis }}
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
                  border: `1px solid ${chartColors.tooltipBorder}`,
                  backgroundColor: chartColors.tooltipBg,
                  boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                }}
                labelStyle={{ color: "var(--text)" }}
                itemStyle={{ color: "var(--text-2)" }}
              />
              <Legend
                formatter={(value) =>
                  value === "strategy" ? "Your Strategy" : "S&P 500"
                }
                wrapperStyle={{ color: "var(--text-3)" }}
              />
              <Bar dataKey="strategy" fill={chartColors.strategy} radius={[6, 6, 0, 0]} barSize={80} />
              <Bar dataKey="benchmark" fill={chartColors.benchmark} radius={[6, 6, 0, 0]} barSize={80} />
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
              <XAxis
                dataKey="date"
                interval={0}
                tickFormatter={formatAxisYear}
                tick={{ fontSize: tickFontSize, fill: chartColors.tick }}
                axisLine={{ stroke: chartColors.axis }}
                tickLine={false}
              />
              <YAxis
                tickFormatter={formatDollar}
                tick={{ fontSize: 12, fill: chartColors.tick }}
                axisLine={{ stroke: chartColors.axis }}
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
                  border: `1px solid ${chartColors.tooltipBorder}`,
                  backgroundColor: chartColors.tooltipBg,
                  boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                }}
                labelStyle={{ color: "var(--text)" }}
                itemStyle={{ color: "var(--text-2)" }}
              />
              <Legend
                formatter={(value) =>
                  value === "strategy" ? "Your Strategy" : "S&P 500"
                }
                wrapperStyle={{ color: "var(--text-3)" }}
              />
              <Line
                type="monotone"
                dataKey="strategy"
                stroke={chartColors.strategy}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="benchmark"
                stroke={chartColors.benchmark}
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
