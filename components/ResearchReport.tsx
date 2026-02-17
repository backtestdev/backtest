"use client";

import { useState, useEffect, useCallback } from "react";
import { useUser, SignUpButton } from "@clerk/nextjs";
import Link from "next/link";
import StockLogo from "./StockLogo";
import Tooltip from "./Tooltip";

// ── Types ────────────────────────────────────────────────────────────

interface Fundamentals {
  price: number | null;
  marketCap: number | null;
  sector: string | null;
  industry: string | null;
  beta: number | null;
  ipoDate: string | null;
  exchange: string | null;
  revenue: number | null;
  revenueGrowth: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  eps: number | null;
  ebitda: number | null;
  netIncome: number | null;
  peRatio: number | null;
  pbRatio: number | null;
  evToSales: number | null;
  evToEbitda: number | null;
  roe: number | null;
  roic: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  dividendYield: number | null;
  fcfPerShare: number | null;
  enterpriseValue: number | null;
  earningsYield: number | null;
  earningsGrowth: number | null;
  profitMargin: number | null;
  fcfYield: number | null;
  consecutiveEarningsGrowth: number | null;
}

interface PriceTarget {
  targetPrice: number;
  probability: number;
  rationale: string;
}

interface AIReport {
  executiveSummary: string;
  bullCase: PriceTarget;
  baseCase: PriceTarget;
  bearCase: PriceTarget;
  riskFactors: string[];
  recommendation: string;
  recommendationRationale: string;
}

interface RevenueTrendPoint {
  date: string;
  revenue: number;
  netIncome: number;
  grossProfit: number;
  netMargin: number;
  eps: number;
}

interface PriceHistoryPoint {
  date: string;
  price: number;
}

interface ResearchData {
  ticker: string;
  companyName: string;
  description?: string;
  image?: string;
  isAuthenticated: boolean;
  source: string;
  fundamentals: Fundamentals;
  revenueTrend?: RevenueTrendPoint[];
  priceHistory?: PriceHistoryPoint[];
  report: AIReport | null;
  error?: string;
}

// ── Metric definitions with tooltips and formatting ──────────────────

interface MetricDef {
  key: string;
  label: string;
  getValue: (f: Fundamentals) => number | null;
  format: (v: number) => string;
  tooltip: string;
  /** "higher" = green when high; "lower" = green when low; "neutral" = no color */
  direction: "higher" | "lower" | "neutral";
  /** Typical percentile benchmarks [p10, p50, p90] for the distribution bar */
  benchmarks?: [number, number, number];
}

const KEY_METRICS: MetricDef[] = [
  {
    key: "peRatio",
    label: "P/E",
    getValue: (f) => f.peRatio,
    format: (v) => v.toFixed(1),
    tooltip: "Price / Earnings. Share price divided by earnings per share. Lower often indicates better value, but very low can signal problems.",
    direction: "lower",
    benchmarks: [10, 22, 50],
  },
  {
    key: "earningsYield",
    label: "Earn. Yield",
    getValue: (f) => f.earningsYield,
    format: (v) => `${(v * 100).toFixed(1)}%`,
    tooltip: "Earnings Yield. Net income divided by market cap. Higher means more profit per dollar invested. Inverse of P/E.",
    direction: "higher",
    benchmarks: [0.01, 0.04, 0.12],
  },
  {
    key: "roe",
    label: "ROE",
    getValue: (f) => f.roe,
    format: (v) => `${(v * 100).toFixed(1)}%`,
    tooltip: "Return on Equity. Net income divided by shareholder equity. Measures how efficiently a company generates profit from its equity.",
    direction: "higher",
    benchmarks: [0.03, 0.15, 0.35],
  },
  {
    key: "profitMargin",
    label: "Margin",
    getValue: (f) => f.profitMargin,
    format: (v) => `${(v * 100).toFixed(1)}%`,
    tooltip: "Net Profit Margin. Percentage of revenue kept as profit after all expenses. Higher indicates better cost efficiency.",
    direction: "higher",
    benchmarks: [0.02, 0.10, 0.30],
  },
  {
    key: "revenueGrowth",
    label: "Rev. Growth",
    getValue: (f) => f.revenueGrowth,
    format: (v) => `${(v * 100).toFixed(1)}%`,
    tooltip: "Revenue Growth. Year-over-year change in total revenue. Indicates how fast the business is expanding.",
    direction: "higher",
    benchmarks: [-0.05, 0.08, 0.30],
  },
  {
    key: "earningsGrowth",
    label: "Earn. Growth",
    getValue: (f) => f.earningsGrowth,
    format: (v) => `${(v * 100).toFixed(1)}%`,
    tooltip: "Earnings Growth. Year-over-year change in net income. Shows how fast profits are growing.",
    direction: "higher",
    benchmarks: [-0.15, 0.10, 0.50],
  },
  {
    key: "debtToEquity",
    label: "D/E",
    getValue: (f) => f.debtToEquity,
    format: (v) => v.toFixed(2),
    tooltip: "Debt to Equity. Total debt divided by shareholder equity. Lower means less leverage and financial risk.",
    direction: "lower",
    benchmarks: [0.1, 0.8, 2.5],
  },
  {
    key: "dividendYield",
    label: "Div. Yield",
    getValue: (f) => f.dividendYield,
    format: (v) => `${(v * 100).toFixed(2)}%`,
    tooltip: "Dividend Yield. Annual dividend payment as a percentage of share price. Indicates income return to shareholders.",
    direction: "higher",
    benchmarks: [0, 0.015, 0.04],
  },
];

// ── Formatters ───────────────────────────────────────────────────────

function formatCurrency(val: number | null): string {
  if (val == null) return "N/A";
  if (Math.abs(val) >= 1e12) return `$${(val / 1e12).toFixed(1)}T`;
  if (Math.abs(val) >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
  if (Math.abs(val) >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  return `$${val.toFixed(2)}`;
}

// ── Recommendation config ────────────────────────────────────────────

const RECOMMENDATION_CONFIG: Record<string, {
  label: string;
  angle: number; // gauge needle angle: 0=far left, 180=far right
}> = {
  STRONG_BUY:  { label: "Strong Buy",  angle: 162 },
  BUY:         { label: "Buy",         angle: 135 },
  HOLD:        { label: "Hold",        angle: 90 },
  SELL:        { label: "Sell",        angle: 45 },
  STRONG_SELL: { label: "Strong Sell", angle: 18 },
};

// ── Main component ───────────────────────────────────────────────────

export default function ResearchReport({ ticker }: { ticker: string }) {
  const { isSignedIn } = useUser();
  const [data, setData] = useState<ResearchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [priceRange, setPriceRange] = useState<"1Y" | "5Y" | "MAX">("1Y");
  const [backtestScore, setBacktestScore] = useState<number | null>(null);

  const fetchResearch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/research?ticker=${encodeURIComponent(ticker)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to fetch research data (${res.status})`);
      }
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load research data");
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  // Fetch backtest score from screener API
  useEffect(() => {
    fetch(`/api/screener?tickers=${encodeURIComponent(ticker)}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.stocks && json.stocks.length > 0) {
          setBacktestScore(json.stocks[0].backtestScore ?? null);
        }
      })
      .catch(() => {});
  }, [ticker]);

  useEffect(() => { fetchResearch(); }, [fetchResearch]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50/50 px-6 py-12">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-gray-200 rounded-lg animate-pulse" />
            <div>
              <div className="h-7 w-48 bg-gray-200 rounded animate-pulse" />
              <div className="h-4 w-32 bg-gray-100 rounded animate-pulse mt-1" />
            </div>
          </div>
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-40 bg-white rounded-2xl animate-pulse border border-gray-100" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50/50 px-6 py-12">
        <div className="max-w-4xl mx-auto">
          <Link href="/research" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-6 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Back
          </Link>
          <div className="bg-white rounded-2xl border border-red-100 p-8 text-center">
            <p className="text-red-500 font-medium">{error || "No data available"}</p>
            <p className="text-sm text-gray-400 mt-2">Check that the ticker is valid and data sources are configured.</p>
          </div>
        </div>
      </div>
    );
  }

  const f = data.fundamentals;
  const report = data.report;
  const recConfig = report ? RECOMMENDATION_CONFIG[report.recommendation] || RECOMMENDATION_CONFIG.HOLD : null;

  const weightedTarget = report
    ? (report.bullCase.targetPrice * report.bullCase.probability +
       report.baseCase.targetPrice * report.baseCase.probability +
       report.bearCase.targetPrice * report.bearCase.probability) / 100
    : null;

  const impliedUpside = weightedTarget && f.price
    ? ((weightedTarget - f.price) / f.price) * 100
    : null;

  // Filter price history by selected range
  const filteredPriceHistory = data.priceHistory && data.priceHistory.length > 0
    ? filterPriceHistory(data.priceHistory, priceRange)
    : [];

  return (
    <div className="min-h-screen bg-gray-50/50 px-6 py-12">
      <div className="max-w-4xl mx-auto">
        {/* Back link */}
        <Link href="/research" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-6 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Back
        </Link>

        {/* Header with recommendation gauge + backtest score */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4">
          <div className="flex items-start gap-4">
            <StockLogo ticker={data.ticker} sector={f.sector || undefined} size="md" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-gray-900">{data.ticker}</h1>
                {f.price != null && (
                  <span className="text-xl font-bold text-gray-700">${f.price.toFixed(2)}</span>
                )}
                {backtestScore != null && (
                  <Tooltip content="Backtest Score. Composite 1-100 score based on earnings yield, growth, consistency, value, quality, and leverage factors." position="bottom">
                    <span className={`ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${
                      backtestScore >= 70 ? "bg-emerald-100 text-emerald-700" :
                      backtestScore >= 40 ? "bg-amber-100 text-amber-700" :
                      "bg-red-100 text-red-600"
                    }`}>
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 0 0 .95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 0 0-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 0 0-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 0 0-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 0 0 .951-.69l1.07-3.292Z" />
                      </svg>
                      {backtestScore}
                    </span>
                  </Tooltip>
                )}
              </div>
              <p className="text-gray-500 mt-0.5">{data.companyName}</p>
              <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                {f.sector && <span>{f.sector}</span>}
                {f.industry && <><span className="text-gray-200">|</span><span>{f.industry}</span></>}
                {f.exchange && <><span className="text-gray-200">|</span><span>{f.exchange}</span></>}
                {f.marketCap != null && (
                  <><span className="text-gray-200">|</span><span>{formatCurrency(f.marketCap)}</span></>
                )}
              </div>
            </div>

            {/* Recommendation gauge */}
            {report && recConfig && (
              <div className="flex-shrink-0 w-44">
                <RecommendationGauge
                  recommendation={report.recommendation}
                  label={recConfig.label}
                  angle={recConfig.angle}
                />
                {weightedTarget != null && (
                  <div className="text-center mt-1">
                    <p className="text-xs text-gray-400">
                      Target: <span className="font-semibold text-gray-600">${weightedTarget.toFixed(2)}</span>
                      {impliedUpside != null && (
                        <span className={`ml-1 font-medium ${impliedUpside >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                          ({impliedUpside >= 0 ? "+" : ""}{impliedUpside.toFixed(1)}%)
                        </span>
                      )}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Executive Summary inline */}
          {report && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-sm text-gray-600 leading-relaxed">{report.executiveSummary}</p>
              {report.recommendationRationale && (
                <p className="text-xs text-gray-400 mt-2">
                  <span className="font-medium text-gray-500">Thesis:</span> {report.recommendationRationale}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Key Metrics — focused set with distribution bars */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Key Metrics</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4">
            {KEY_METRICS.map((m) => {
              const val = m.getValue(f);
              return (
                <Tooltip key={m.key} content={m.tooltip} position="bottom" width="w-64">
                  <div className="w-full">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[10px] text-gray-400 uppercase tracking-wider">{m.label}</span>
                      {val != null && m.direction !== "neutral" && m.benchmarks && (
                        <MetricQualityDot value={val} direction={m.direction} benchmarks={m.benchmarks} />
                      )}
                    </div>
                    <p className={`text-sm font-bold ${val != null ? getMetricColor(val, m.direction, m.benchmarks) : "text-gray-300"}`}>
                      {val != null ? m.format(val) : "N/A"}
                    </p>
                    {val != null && m.benchmarks && m.direction !== "neutral" && (
                      <PercentileBar value={val} benchmarks={m.benchmarks} direction={m.direction} />
                    )}
                  </div>
                </Tooltip>
              );
            })}
          </div>
        </div>

        {/* Price Chart */}
        {filteredPriceHistory.length > 10 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-900">Price History</h2>
              <div className="flex items-center gap-1">
                {(["1Y", "5Y", "MAX"] as const).map((range) => (
                  <button
                    key={range}
                    onClick={() => setPriceRange(range)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      priceRange === range
                        ? "bg-gray-900 text-white"
                        : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    {range}
                  </button>
                ))}
              </div>
            </div>
            <PriceChart data={filteredPriceHistory} />
          </div>
        )}

        {/* Revenue & Earnings Charts */}
        {data.revenueTrend && data.revenueTrend.length > 1 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div className="bg-white rounded-2xl border border-gray-100 p-6">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Revenue</h2>
              <VerticalBarChart
                data={data.revenueTrend}
                dataKey="revenue"
                color="bg-blue-500"
                formatValue={(v) => formatCurrency(v)}
              />
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 p-6">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Net Income</h2>
              <VerticalBarChart
                data={data.revenueTrend}
                dataKey="netIncome"
                color="bg-emerald-500"
                negativeColor="bg-red-400"
                formatValue={(v) => formatCurrency(v)}
              />
            </div>
          </div>
        )}

        {/* Auth gate for AI report */}
        {!isSignedIn && !report && (
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl border border-blue-100 p-8 mb-4 text-center">
            <svg className="w-10 h-10 text-blue-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Sign up for the full research report</h3>
            <p className="text-sm text-gray-500 mb-4">
              Get AI-generated price targets, bull/bear scenarios, risk analysis, and buy/hold/sell recommendations.
            </p>
            <SignUpButton mode="modal">
              <button className="px-6 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">
                Sign Up Free
              </button>
            </SignUpButton>
          </div>
        )}

        {/* Price Targets — Bear (left) → Base (center) → Bull (right) */}
        {report && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Price Targets</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <PriceTargetCard
                label="Bear Case"
                target={report.bearCase}
                currentPrice={f.price}
                color="red"
              />
              <PriceTargetCard
                label="Base Case"
                target={report.baseCase}
                currentPrice={f.price}
                color="blue"
              />
              <PriceTargetCard
                label="Bull Case"
                target={report.bullCase}
                currentPrice={f.price}
                color="emerald"
              />
            </div>
            {/* Visual price range */}
            {f.price != null && (
              <div className="mt-5 pt-4 border-t border-gray-100">
                <PriceRangeBar
                  currentPrice={f.price}
                  bear={report.bearCase.targetPrice}
                  base={report.baseCase.targetPrice}
                  bull={report.bullCase.targetPrice}
                />
              </div>
            )}
          </div>
        )}

        {/* Risk Factors */}
        {report && report.riskFactors.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Risk Factors</h2>
            <div className="space-y-2">
              {report.riskFactors.map((risk, i) => (
                <div key={i} className="flex items-start gap-2">
                  <svg className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                  </svg>
                  <p className="text-sm text-gray-600">{risk}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Disclaimer */}
        <div className="text-center mt-6 mb-4">
          <p className="text-[10px] text-gray-300">
            This report is AI-generated for informational purposes only. Not financial advice.
            Data sourced from Financial Modeling Prep. Always do your own research.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Metric color helpers ─────────────────────────────────────────────

function getMetricColor(
  value: number,
  direction: "higher" | "lower" | "neutral",
  benchmarks?: [number, number, number],
): string {
  if (!benchmarks || direction === "neutral") return "text-gray-900";
  const [low, mid, high] = benchmarks;
  if (direction === "higher") {
    if (value >= high) return "text-emerald-600";
    if (value >= mid) return "text-gray-900";
    if (value >= low) return "text-amber-600";
    return "text-red-500";
  }
  // "lower" — low is good
  if (value <= low) return "text-emerald-600";
  if (value <= mid) return "text-gray-900";
  if (value <= high) return "text-amber-600";
  return "text-red-500";
}

function MetricQualityDot({ value, direction, benchmarks }: {
  value: number;
  direction: "higher" | "lower";
  benchmarks: [number, number, number];
}) {
  const [low, mid, high] = benchmarks;
  let color = "bg-gray-300";
  if (direction === "higher") {
    if (value >= high) color = "bg-emerald-400";
    else if (value >= mid) color = "bg-gray-300";
    else if (value >= low) color = "bg-amber-400";
    else color = "bg-red-400";
  } else {
    if (value <= low) color = "bg-emerald-400";
    else if (value <= mid) color = "bg-gray-300";
    else if (value <= high) color = "bg-amber-400";
    else color = "bg-red-400";
  }
  return <div className={`w-1.5 h-1.5 rounded-full ${color}`} />;
}

/** Tiny percentile bar showing where the value sits relative to benchmarks */
function PercentileBar({ value, benchmarks, direction }: {
  value: number;
  benchmarks: [number, number, number];
  direction: "higher" | "lower";
}) {
  const [low,, high] = benchmarks;
  const range = high - low || 1;
  // Clamp position between 0 and 100%
  const rawPct = ((value - low) / range) * 100;
  const pct = Math.max(2, Math.min(98, rawPct));

  // Bar gradient: for "higher" metrics, left=bad right=good; for "lower" it's reversed
  const gradient = direction === "higher"
    ? "from-red-200 via-amber-100 to-emerald-200"
    : "from-emerald-200 via-amber-100 to-red-200";

  return (
    <div className="mt-1 relative h-1 w-full rounded-full overflow-hidden">
      <div className={`absolute inset-0 bg-gradient-to-r ${gradient}`} />
      <div
        className="absolute top-0 w-1.5 h-1.5 bg-gray-800 rounded-full -translate-y-[0.5px]"
        style={{ left: `${pct}%`, transform: `translateX(-50%) translateY(-0.5px)` }}
      />
    </div>
  );
}

// ── Recommendation Gauge ─────────────────────────────────────────────

function RecommendationGauge({ recommendation, label, angle }: {
  recommendation: string;
  label: string;
  angle: number;
}) {
  const needleAngle = 180 - angle;
  const radians = (needleAngle * Math.PI) / 180;
  const needleX = 80 + 52 * Math.cos(radians);
  const needleY = 80 - 52 * Math.sin(radians);

  const colorForRec = (rec: string) => {
    if (rec === "STRONG_BUY" || rec === "BUY") return "text-emerald-600";
    if (rec === "STRONG_SELL" || rec === "SELL") return "text-red-600";
    return "text-amber-500";
  };

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 160 100" className="w-full h-auto" style={{ maxWidth: 176 }}>
        {/* Strong Sell */}
        <path d="M 16 80 A 64 64 0 0 1 28.7 39.2" fill="none" stroke="#fecaca" strokeWidth="10" strokeLinecap="round" />
        {/* Sell */}
        <path d="M 32.5 35 A 64 64 0 0 1 56 17.2" fill="none" stroke="#fde68a" strokeWidth="10" strokeLinecap="round" />
        {/* Hold */}
        <path d="M 61 15.5 A 64 64 0 0 1 99 15.5" fill="none" stroke="#d4d4d8" strokeWidth="10" strokeLinecap="round" />
        {/* Buy */}
        <path d="M 104 17.2 A 64 64 0 0 1 127.5 35" fill="none" stroke="#bbf7d0" strokeWidth="10" strokeLinecap="round" />
        {/* Strong Buy */}
        <path d="M 131.3 39.2 A 64 64 0 0 1 144 80" fill="none" stroke="#6ee7b7" strokeWidth="10" strokeLinecap="round" />
        {/* Needle */}
        <line x1="80" y1="80" x2={needleX} y2={needleY} stroke="#1f2937" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="80" cy="80" r="4" fill="#1f2937" />
        <text x="10" y="95" className="text-[7px] fill-gray-300" textAnchor="start">Sell</text>
        <text x="150" y="95" className="text-[7px] fill-gray-300" textAnchor="end">Buy</text>
      </svg>
      <span className={`text-sm font-bold ${colorForRec(recommendation)} -mt-1`}>{label}</span>
    </div>
  );
}

// ── Vertical Bar Chart ───────────────────────────────────────────────

function VerticalBarChart({ data, dataKey, color, negativeColor, formatValue }: {
  data: RevenueTrendPoint[];
  dataKey: "revenue" | "netIncome" | "grossProfit";
  color: string;
  negativeColor?: string;
  formatValue: (v: number) => string;
}) {
  const values = data.map((d) => (d as unknown as Record<string, number>)[dataKey] || 0);
  const maxVal = Math.max(...values.map(Math.abs));
  const hasNegative = values.some((v) => v < 0);

  const chartHeight = 140;
  const positiveMax = Math.max(...values, 0);
  const negativeMin = Math.min(...values, 0);
  const totalRange = positiveMax - negativeMin || 1;
  const zeroLineY = (positiveMax / totalRange) * chartHeight;

  return (
    <div className="flex items-end justify-between gap-2" style={{ height: chartHeight + 30 }}>
      {data.map((point, i) => {
        const val = (point as unknown as Record<string, number>)[dataKey] || 0;
        const isNeg = val < 0;
        const barHeight = maxVal > 0 ? (Math.abs(val) / totalRange) * chartHeight : 0;
        const barColor = isNeg ? (negativeColor || "bg-red-400") : color;
        const year = point.date.slice(0, 4);

        return (
          <div key={i} className="flex-1 flex flex-col items-center" style={{ height: chartHeight + 30 }}>
            {!isNeg && (
              <div style={{ height: hasNegative ? zeroLineY - barHeight : chartHeight - barHeight }} className="flex items-end">
                <p className="text-[9px] text-gray-400 mb-0.5 whitespace-nowrap">{formatValue(val)}</p>
              </div>
            )}
            <div
              className={`w-full rounded-t-md ${barColor} transition-all`}
              style={{
                height: Math.max(barHeight, 2),
                ...(isNeg ? { marginTop: hasNegative ? zeroLineY : chartHeight } : {}),
                borderRadius: isNeg ? "0 0 4px 4px" : "4px 4px 0 0",
              }}
            />
            {isNeg && (
              <p className="text-[9px] text-red-400 mt-0.5 whitespace-nowrap">{formatValue(val)}</p>
            )}
            <p className="text-[10px] text-gray-400 mt-auto pt-1 font-medium">{year}</p>
          </div>
        );
      })}
    </div>
  );
}

// ── Price Chart ──────────────────────────────────────────────────────

function PriceChart({ data }: { data: PriceHistoryPoint[] }) {
  if (data.length < 2) return null;

  const prices = data.map((d) => d.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const range = maxPrice - minPrice || 1;
  const width = 800;
  const height = 200;
  const padding = { top: 10, right: 10, bottom: 25, left: 50 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const firstPrice = prices[0];
  const lastPrice = prices[prices.length - 1];
  const isUp = lastPrice >= firstPrice;

  const points = data.map((d, i) => {
    const x = padding.left + (i / (data.length - 1)) * chartW;
    const y = padding.top + chartH - ((d.price - minPrice) / range) * chartH;
    return `${x},${y}`;
  });
  const pathD = `M ${points.join(" L ")}`;

  const firstX = padding.left;
  const lastX = padding.left + chartW;
  const bottomY = padding.top + chartH;
  const fillD = `${pathD} L ${lastX},${bottomY} L ${firstX},${bottomY} Z`;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((pct) => ({
    price: minPrice + pct * range,
    y: padding.top + chartH - pct * chartH,
  }));

  const dateLabels: { label: string; x: number }[] = [];
  const step = Math.max(1, Math.floor(data.length / 5));
  for (let i = 0; i < data.length; i += step) {
    dateLabels.push({
      label: data[i].date.slice(0, 7),
      x: padding.left + (i / (data.length - 1)) * chartW,
    });
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
      {yTicks.map((tick, i) => (
        <g key={i}>
          <line x1={padding.left} y1={tick.y} x2={width - padding.right} y2={tick.y} stroke="#f3f4f6" strokeWidth="1" />
          <text x={padding.left - 6} y={tick.y + 3} textAnchor="end" className="text-[9px] fill-gray-300">
            ${tick.price >= 1000 ? (tick.price / 1000).toFixed(0) + "k" : tick.price.toFixed(0)}
          </text>
        </g>
      ))}
      <path d={fillD} fill={isUp ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)"} />
      <path d={pathD} fill="none" stroke={isUp ? "#10b981" : "#ef4444"} strokeWidth="1.5" />
      {dateLabels.map((dl, i) => (
        <text key={i} x={dl.x} y={height - 5} textAnchor="middle" className="text-[9px] fill-gray-300">
          {dl.label}
        </text>
      ))}
    </svg>
  );
}

function filterPriceHistory(data: PriceHistoryPoint[], range: "1Y" | "5Y" | "MAX"): PriceHistoryPoint[] {
  if (range === "MAX") return data;
  const now = new Date();
  const years = range === "1Y" ? 1 : 5;
  const cutoff = new Date(now.getFullYear() - years, now.getMonth(), now.getDate());
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return data.filter((d) => d.date >= cutoffStr);
}

// ── Sub-components ───────────────────────────────────────────────────

function PriceTargetCard({ label, target, currentPrice, color }: {
  label: string;
  target: PriceTarget;
  currentPrice: number | null;
  color: "emerald" | "blue" | "red";
}) {
  const upside = currentPrice
    ? ((target.targetPrice - currentPrice) / currentPrice) * 100
    : null;

  const colorMap = {
    emerald: { bg: "bg-emerald-50", border: "border-emerald-100", accent: "text-emerald-600" },
    blue: { bg: "bg-blue-50", border: "border-blue-100", accent: "text-blue-600" },
    red: { bg: "bg-red-50", border: "border-red-100", accent: "text-red-600" },
  };
  const c = colorMap[color];

  return (
    <div className={`p-4 rounded-xl border ${c.bg} ${c.border}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-500">{label}</span>
        <span className="text-[10px] font-medium text-gray-400">{target.probability}% prob.</span>
      </div>
      <p className={`text-xl font-bold ${c.accent}`}>
        ${target.targetPrice.toFixed(2)}
      </p>
      {upside != null && (
        <p className={`text-xs font-medium mt-1 ${upside >= 0 ? "text-emerald-500" : "text-red-500"}`}>
          {upside >= 0 ? "+" : ""}{upside.toFixed(1)}% from current
        </p>
      )}
      <p className="text-xs text-gray-500 mt-2 leading-relaxed">{target.rationale}</p>
    </div>
  );
}

function PriceRangeBar({ currentPrice, bear, base, bull }: {
  currentPrice: number;
  bear: number;
  base: number;
  bull: number;
}) {
  const min = Math.min(bear, currentPrice) * 0.95;
  const max = Math.max(bull, currentPrice) * 1.05;
  const rangeVal = max - min;
  const pos = (val: number) => ((val - min) / rangeVal) * 100;

  return (
    <div className="relative h-12">
      <div className="absolute top-4 left-0 right-0 h-2 bg-gray-100 rounded-full">
        <div
          className="absolute h-full bg-gradient-to-r from-red-200 via-blue-200 to-emerald-200 rounded-full"
          style={{ left: `${pos(bear)}%`, width: `${pos(bull) - pos(bear)}%` }}
        />
      </div>
      <div className="absolute top-2" style={{ left: `${pos(bear)}%`, transform: "translateX(-50%)" }}>
        <div className="w-2 h-6 bg-red-400 rounded-full" />
        <p className="text-[9px] text-red-400 mt-1 whitespace-nowrap">${bear.toFixed(0)}</p>
      </div>
      <div className="absolute top-2" style={{ left: `${pos(base)}%`, transform: "translateX(-50%)" }}>
        <div className="w-2 h-6 bg-blue-400 rounded-full" />
        <p className="text-[9px] text-blue-400 mt-1 whitespace-nowrap">${base.toFixed(0)}</p>
      </div>
      <div className="absolute top-2" style={{ left: `${pos(bull)}%`, transform: "translateX(-50%)" }}>
        <div className="w-2 h-6 bg-emerald-400 rounded-full" />
        <p className="text-[9px] text-emerald-400 mt-1 whitespace-nowrap">${bull.toFixed(0)}</p>
      </div>
      <div className="absolute top-1" style={{ left: `${pos(currentPrice)}%`, transform: "translateX(-50%)" }}>
        <div className="w-3 h-3 bg-gray-900 rounded-full border-2 border-white shadow" />
        <p className="text-[9px] font-bold text-gray-900 mt-4 whitespace-nowrap">${currentPrice.toFixed(0)} now</p>
      </div>
    </div>
  );
}
