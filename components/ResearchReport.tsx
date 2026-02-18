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
  STRONG_BUY:  { label: "Strong Buy",  angle: 172 },
  BUY:         { label: "Buy",         angle: 140 },
  HOLD:        { label: "Hold",        angle: 90 },
  SELL:        { label: "Sell",        angle: 40 },
  STRONG_SELL: { label: "Strong Sell", angle: 8 },
};

// ── Format recommendation strings for display ──────────────────────

function formatRecommendationText(text: string): string {
  return text
    .replace(/\bSTRONG_BUY\b/g, "Strong Buy")
    .replace(/\bSTRONG_SELL\b/g, "Strong Sell")
    .replace(/\bBUY\b/g, "Buy")
    .replace(/\bSELL\b/g, "Sell")
    .replace(/\bHOLD\b/g, "Hold");
}

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
      <div className="min-h-screen bg-th-bg px-4 sm:px-6 py-8 sm:py-12">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-th-bar rounded-lg animate-pulse" />
            <div>
              <div className="h-7 w-48 bg-th-bar rounded animate-pulse" />
              <div className="h-4 w-32 bg-th-skeleton rounded animate-pulse mt-1" />
            </div>
          </div>
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-40 bg-th-surface rounded-2xl animate-pulse border border-th-border-light" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-th-bg px-4 sm:px-6 py-8 sm:py-12">
        <div className="max-w-4xl mx-auto">
          <Link href="/research" className="inline-flex items-center gap-1 text-sm text-th-text-3 hover:text-th-text-2 mb-6 transition-colors min-h-[44px]">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Back
          </Link>
          <div className="bg-th-surface rounded-2xl border border-th-negative-border p-6 sm:p-8 text-center">
            <p className="text-th-negative font-medium">{error || "No data available"}</p>
            <p className="text-sm text-th-text-3 mt-2">Check that the ticker is valid and data sources are configured.</p>
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
    <div className="min-h-screen bg-th-bg px-4 sm:px-6 py-8 sm:py-12">
      <div className="max-w-4xl mx-auto">
        {/* Back link */}
        <Link href="/research" className="inline-flex items-center gap-1 text-sm text-th-text-3 hover:text-th-text-2 mb-4 sm:mb-6 transition-colors min-h-[44px]">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Back
        </Link>

        {/* Header with recommendation gauge + backtest score */}
        <div className="bg-th-surface rounded-2xl border border-th-border-light p-4 sm:p-6 mb-4 shadow-sm">
          <div className="flex flex-col sm:flex-row items-start gap-4">
            <div className="flex items-start gap-3 sm:gap-4 flex-1 min-w-0">
            <StockLogo ticker={data.ticker} sector={f.sector || undefined} size="md" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-bold text-th-text">{data.ticker}</h1>
                {f.price != null && (
                  <span className="text-xl font-bold text-th-text-2">${f.price.toFixed(2)}</span>
                )}
                {backtestScore != null && (
                  <Tooltip content="Backtest Score. Composite 1-100 score based on earnings yield, growth, consistency, value, quality, and leverage factors." position="bottom">
                    <span className={`ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${
                      backtestScore >= 70 ? "bg-th-positive-bg text-th-positive-text" :
                      backtestScore >= 40 ? "bg-th-warning-bg text-th-warning-text" :
                      "bg-th-negative-bg text-th-negative"
                    }`}>
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 0 0 .95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 0 0-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 0 0-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 0 0-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 0 0 .951-.69l1.07-3.292Z" />
                      </svg>
                      {backtestScore}
                    </span>
                  </Tooltip>
                )}
              </div>
              <p className="text-th-text-3 mt-0.5">{data.companyName}</p>
              <div className="flex items-center gap-3 mt-1.5 text-sm text-th-text-3 flex-wrap">
                {f.sector && <span>{f.sector}</span>}
                {f.industry && <><span className="text-th-text-4">&middot;</span><span>{f.industry}</span></>}
                {f.exchange && <><span className="text-th-text-4">&middot;</span><span>{f.exchange}</span></>}
                {f.marketCap != null && (
                  <><span className="text-th-text-4">&middot;</span><span>{formatCurrency(f.marketCap)}</span></>
                )}
              </div>
            </div>
            </div>

            {/* Recommendation gauge */}
            {report && recConfig && (
              <div className="flex-shrink-0 w-full sm:w-44">
                <RecommendationGauge
                  recommendation={report.recommendation}
                  label={recConfig.label}
                  angle={recConfig.angle}
                />
                {weightedTarget != null && (
                  <div className="text-center mt-1">
                    <p className="text-xs text-th-text-3">
                      Target: <span className="font-semibold text-th-text-2">${weightedTarget.toFixed(2)}</span>
                      {impliedUpside != null && (
                        <span className={`ml-1 font-medium ${impliedUpside >= 0 ? "text-th-positive" : "text-th-negative"}`}>
                          ({impliedUpside >= 0 ? "+" : ""}{impliedUpside.toFixed(1)}%)
                        </span>
                      )}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Executive Summary + Thesis */}
          {report && (
            <div className="mt-4 pt-4 border-t border-th-border-light">
              <p className="text-sm sm:text-base text-th-text-2 leading-relaxed">{formatRecommendationText(report.executiveSummary)}</p>
              {report.recommendationRationale && (
                <div className="mt-3 p-3 rounded-xl bg-th-inset border border-th-border-light">
                  <p className="text-xs font-semibold text-th-accent uppercase tracking-wider mb-1">Investment Thesis</p>
                  <p className="text-sm text-th-text leading-relaxed">{formatRecommendationText(report.recommendationRationale)}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Key Metrics */}
        <div className="bg-th-surface rounded-2xl border border-th-border-light p-4 sm:p-6 mb-4 shadow-sm">
          <h2 className="text-sm font-semibold text-th-text mb-4">Key Metrics</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {KEY_METRICS.map((m) => {
              const val = m.getValue(f);
              const quality = val != null && m.benchmarks && m.direction !== "neutral"
                ? getMetricQuality(val, m.direction, m.benchmarks)
                : null;
              const qualityLabel = quality === "strong" ? "Excellent"
                : quality === "good" ? "Good"
                : quality === "fair" ? "Fair"
                : quality === "weak" ? "Poor" : "";
              const qualityColor = quality === "strong" ? "text-th-positive bg-th-positive-bg"
                : quality === "good" ? "text-th-accent bg-th-accent-bg"
                : quality === "fair" ? "text-th-warning bg-th-warning-bg"
                : quality === "weak" ? "text-th-negative bg-th-negative-bg" : "";
              return (
                <Tooltip key={m.key} content={m.tooltip} position="bottom" width="w-64">
                  <div className="flex flex-col items-center text-center p-4 rounded-xl bg-th-inset border border-th-border-light">
                    <span className="text-[10px] text-th-text-3 uppercase tracking-wider">{m.label}</span>
                    <p className={`text-2xl font-bold mt-2 mb-2 ${val != null ? getMetricColor(val, m.direction, m.benchmarks) : "text-th-text-4"}`}>
                      {val != null ? m.format(val) : "N/A"}
                    </p>
                    {qualityLabel ? (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${qualityColor}`}>{qualityLabel}</span>
                    ) : (
                      <span className="text-[10px] py-0.5">&nbsp;</span>
                    )}
                  </div>
                </Tooltip>
              );
            })}
          </div>
        </div>

        {/* Price Chart */}
        {filteredPriceHistory.length > 10 && (
          <div className="bg-th-surface rounded-2xl border border-th-border-light p-4 sm:p-6 mb-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-th-text">Price History</h2>
              <div className="flex items-center gap-1">
                {(["1Y", "5Y", "MAX"] as const).map((range) => (
                  <button
                    key={range}
                    onClick={() => setPriceRange(range)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      priceRange === range
                        ? "bg-th-nav-active text-white"
                        : "text-th-text-3 hover:text-th-text-2 hover:bg-th-hover"
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
            <div className="bg-th-surface rounded-2xl border border-th-border-light p-4 sm:p-6">
              <h2 className="text-sm font-semibold text-th-text mb-4">Revenue</h2>
              <VerticalBarChart
                data={data.revenueTrend}
                dataKey="revenue"
                color="bg-th-accent"
                formatValue={(v) => formatCurrency(v)}
              />
            </div>
            <div className="bg-th-surface rounded-2xl border border-th-border-light p-4 sm:p-6">
              <h2 className="text-sm font-semibold text-th-text mb-4">Net Income</h2>
              <VerticalBarChart
                data={data.revenueTrend}
                dataKey="netIncome"
                color="bg-th-positive-bar"
                negativeColor="bg-th-negative"
                formatValue={(v) => formatCurrency(v)}
              />
            </div>
          </div>
        )}

        {/* Auth gate for AI report */}
        {!isSignedIn && !report && (
          <div className="bg-th-accent-bg rounded-2xl border border-th-accent-border p-6 sm:p-8 mb-4 text-center">
            <svg className="w-10 h-10 text-th-accent mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
            <h3 className="text-lg font-semibold text-th-text mb-1">Sign up for the full research report</h3>
            <p className="text-sm text-th-text-3 mb-4">
              Get AI-generated price targets, bull/bear scenarios, risk analysis, and buy/hold/sell recommendations.
            </p>
            <SignUpButton mode="modal">
              <button className="px-6 py-2.5 text-sm font-medium text-white bg-th-accent rounded-lg hover:bg-th-accent-hover transition-colors">
                Sign Up Free
              </button>
            </SignUpButton>
          </div>
        )}

        {/* Price Targets — Bear (left) → Base (center) → Bull (right) */}
        {report && (
          <div className="bg-th-surface rounded-2xl border border-th-border-light p-4 sm:p-6 mb-4 shadow-sm">
            <h2 className="text-sm font-semibold text-th-text mb-4">Price Targets</h2>
            {/* Visual price range */}
            {f.price != null && (
              <div className="mb-4">
                <PriceRangeBar
                  currentPrice={f.price}
                  bear={report.bearCase.targetPrice}
                  base={report.baseCase.targetPrice}
                  bull={report.bullCase.targetPrice}
                />
              </div>
            )}
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
          </div>
        )}

        {/* Risk Factors */}
        {report && report.riskFactors.length > 0 && (
          <div className="bg-th-surface rounded-2xl border border-th-border-light p-4 sm:p-6 mb-4">
            <h2 className="text-sm font-semibold text-th-text mb-3">Risk Factors</h2>
            <div className="space-y-2">
              {report.riskFactors.map((risk, i) => (
                <div key={i} className="flex items-start gap-2">
                  <svg className="w-4 h-4 text-th-warning mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                  </svg>
                  <p className="text-sm text-th-text-2">{risk}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Disclaimer */}
        <div className="text-center mt-6 mb-4">
          <p className="text-[10px] text-th-text-4">
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
  if (!benchmarks || direction === "neutral") return "text-th-text";
  const [low, mid, high] = benchmarks;
  if (direction === "higher") {
    if (value >= high) return "text-th-positive";
    if (value >= mid) return "text-th-text";
    if (value >= low) return "text-th-warning";
    return "text-th-negative";
  }
  // "lower" — low is good
  if (value <= low) return "text-th-positive";
  if (value <= mid) return "text-th-text";
  if (value <= high) return "text-th-warning";
  return "text-th-negative";
}

function getMetricQuality(
  value: number,
  direction: "higher" | "lower" | "neutral",
  benchmarks?: [number, number, number],
): "strong" | "good" | "fair" | "weak" | null {
  if (!benchmarks || direction === "neutral") return null;
  const [low, mid, high] = benchmarks;
  if (direction === "higher") {
    if (value >= high) return "strong";
    if (value >= mid) return "good";
    if (value >= low) return "fair";
    return "weak";
  }
  if (value <= low) return "strong";
  if (value <= mid) return "good";
  if (value <= high) return "fair";
  return "weak";
}

// ── Recommendation Gauge ─────────────────────────────────────────────

function RecommendationGauge({ recommendation, label, angle }: {
  recommendation: string;
  label: string;
  angle: number;
}) {
  const needleAngle = 180 - angle;
  const radians = (needleAngle * Math.PI) / 180;
  const r = 56;
  const needleX = 80 + r * Math.cos(radians);
  const needleY = 82 - r * Math.sin(radians);

  const colorForRec = (rec: string) => {
    if (rec === "STRONG_BUY" || rec === "BUY") return "text-th-positive";
    if (rec === "STRONG_SELL" || rec === "SELL") return "text-th-negative";
    return "text-th-warning";
  };

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 160 105" className="w-full h-auto" style={{ maxWidth: 180 }}>
        {/* Background track */}
        <path d="M 16 82 A 64 64 0 0 1 144 82" fill="none" stroke="var(--skeleton)" strokeWidth="7" strokeLinecap="round" />
        {/* Strong Sell */}
        <path d="M 16 82 A 64 64 0 0 1 28.7 41.2" fill="none" stroke="#e11d48" strokeWidth="7" strokeLinecap="round" opacity="0.7" />
        {/* Sell */}
        <path d="M 32.5 37 A 64 64 0 0 1 56 19.2" fill="none" stroke="#ea580c" strokeWidth="7" strokeLinecap="round" opacity="0.6" />
        {/* Hold */}
        <path d="M 61 17.5 A 64 64 0 0 1 99 17.5" fill="none" stroke="var(--text-4)" strokeWidth="7" strokeLinecap="round" opacity="0.7" />
        {/* Buy */}
        <path d="M 104 19.2 A 64 64 0 0 1 127.5 37" fill="none" stroke="#059669" strokeWidth="7" strokeLinecap="round" opacity="0.6" />
        {/* Strong Buy */}
        <path d="M 131.3 41.2 A 64 64 0 0 1 144 82" fill="none" stroke="#047857" strokeWidth="7" strokeLinecap="round" opacity="0.7" />
        {/* Needle */}
        <line x1="80" y1="82" x2={needleX} y2={needleY} stroke="var(--text)" strokeWidth="2" strokeLinecap="round" />
        <circle cx="80" cy="82" r="5" fill="var(--bg-surface)" stroke="var(--text)" strokeWidth="2" />
        <circle cx="80" cy="82" r="2" fill="var(--text)" />
        {/* Labels */}
        <text x="14" y="98" className="text-[8px]" fill="var(--text-4)" textAnchor="start">Sell</text>
        <text x="146" y="98" className="text-[8px]" fill="var(--text-4)" textAnchor="end">Buy</text>
      </svg>
      <span className={`text-sm font-bold ${colorForRec(recommendation)} -mt-2`}>{label}</span>
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
        const barColor = isNeg ? (negativeColor || "bg-th-negative") : color;
        const year = point.date.slice(0, 4);

        return (
          <div key={i} className="flex-1 flex flex-col items-center" style={{ height: chartHeight + 30 }}>
            {!isNeg && (
              <div style={{ height: hasNegative ? zeroLineY - barHeight : chartHeight - barHeight }} className="flex items-end">
                <p className="text-[9px] text-th-text-3 mb-0.5 whitespace-nowrap">{formatValue(val)}</p>
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
              <p className="text-[9px] text-th-negative mt-0.5 whitespace-nowrap">{formatValue(val)}</p>
            )}
            <p className="text-[10px] text-th-text-3 mt-auto pt-1 font-medium">{year}</p>
          </div>
        );
      })}
    </div>
  );
}

// ── Price Chart ──────────────────────────────────────────────────────

const RR_MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatRRDate(dateStr: string): string {
  const parts = dateStr.split("-");
  const monthIdx = parseInt(parts[1], 10) - 1;
  const yr = parts[0].slice(2);
  return `${RR_MONTH_ABBR[monthIdx]} '${yr}`;
}

function PriceChart({ data }: { data: PriceHistoryPoint[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (data.length < 2) return null;

  const prices = data.map((d) => d.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const range = maxPrice - minPrice || 1;
  const width = 800;
  const height = 240;
  const pad = { top: 20, right: 15, bottom: 32, left: 56 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  const lineColor = "var(--accent)";

  const points = data.map((d, i) => ({
    x: pad.left + (i / (data.length - 1)) * chartW,
    y: pad.top + chartH - ((d.price - minPrice) / range) * chartH,
  }));
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const fillD = `${pathD} L ${points[points.length - 1].x},${pad.top + chartH} L ${points[0].x},${pad.top + chartH} Z`;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((pct) => ({
    price: minPrice + pct * range,
    y: pad.top + chartH - pct * chartH,
  }));

  const dateLabels: { label: string; x: number }[] = [];
  const step = Math.max(1, Math.floor(data.length / 6));
  for (let i = 0; i < data.length; i += step) {
    dateLabels.push({
      label: formatRRDate(data[i].date),
      x: pad.left + (i / (data.length - 1)) * chartW,
    });
  }

  const hp = hoveredIdx !== null ? points[hoveredIdx] : null;
  const hd = hoveredIdx !== null ? data[hoveredIdx] : null;
  const ttX = hp ? Math.max(pad.left + 55, Math.min(width - pad.right - 55, hp.x)) : 0;
  const ttAbove = hp ? hp.y > pad.top + 50 : true;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto"
      onMouseLeave={() => setHoveredIdx(null)}
    >
      <defs>
        <linearGradient id="rrPriceGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.15" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.01" />
        </linearGradient>
      </defs>

      {yTicks.map((tick, i) => (
        <g key={i}>
          <line x1={pad.left} y1={tick.y} x2={width - pad.right} y2={tick.y} stroke="var(--border-light)" strokeWidth="1" />
          <text x={pad.left - 8} y={tick.y + 4} textAnchor="end" className="text-[11px]" fill="var(--text-2)">
            ${tick.price >= 1000 ? (tick.price / 1000).toFixed(0) + "k" : tick.price.toFixed(0)}
          </text>
        </g>
      ))}

      <path d={fillD} fill="url(#rrPriceGrad)" />
      <path d={pathD} fill="none" stroke={lineColor} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

      {hp && (
        <line x1={hp.x} y1={pad.top} x2={hp.x} y2={pad.top + chartH} stroke="var(--text-4)" strokeWidth="1" strokeDasharray="4 3" />
      )}

      {points.map((p, i) => {
        const hitW = chartW / data.length;
        return (
          <g key={i} onMouseEnter={() => setHoveredIdx(i)}>
            <rect x={p.x - hitW / 2} y={pad.top} width={hitW} height={chartH} fill="transparent" style={{ cursor: "crosshair" }} />
            <circle
              cx={p.x} cy={p.y}
              r={hoveredIdx === i ? 5 : 0}
              fill={lineColor}
              stroke="var(--bg-surface)"
              strokeWidth="2"
            />
          </g>
        );
      })}

      {hp && hd && (
        <g>
          <rect
            x={ttX - 52} y={ttAbove ? hp.y - 46 : hp.y + 12}
            width="104" height="36" rx="8"
            fill="var(--tooltip-bg)" stroke="var(--border)" strokeWidth="1"
          />
          <text x={ttX} y={ttAbove ? hp.y - 28 : hp.y + 30} textAnchor="middle" className="text-[12px] font-semibold" fill="var(--tooltip-text)">
            ${hd.price.toFixed(2)}
          </text>
          <text x={ttX} y={ttAbove ? hp.y - 16 : hp.y + 42} textAnchor="middle" className="text-[10px]" fill="var(--text-3)">
            {formatRRDate(hd.date)}
          </text>
        </g>
      )}

      {dateLabels.map((dl, i) => (
        <text key={i} x={dl.x} y={height - 8} textAnchor="middle" className="text-[11px]" fill="var(--text-2)">
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

  const borderLeft = color === "emerald" ? "border-l-emerald-500"
    : color === "blue" ? "border-l-blue-500"
    : "border-l-red-500";
  const accentText = color === "emerald" ? "text-th-positive"
    : color === "blue" ? "text-th-accent"
    : "text-th-negative";

  return (
    <div className={`p-4 rounded-xl bg-th-inset border border-th-border-light border-l-[3px] ${borderLeft}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-th-text-2 uppercase tracking-wider">{label}</span>
        <span className="text-[10px] font-medium text-th-text-4 bg-th-surface px-1.5 py-0.5 rounded">{target.probability}%</span>
      </div>
      <div className="flex items-baseline gap-2">
        <p className={`text-2xl font-bold ${accentText}`}>
          ${target.targetPrice.toFixed(0)}
        </p>
        {upside != null && (
          <span className={`text-sm font-semibold ${upside >= 0 ? "text-th-positive" : "text-th-negative"}`}>
            {upside >= 0 ? "+" : ""}{upside.toFixed(1)}%
          </span>
        )}
      </div>
      <p className="text-xs text-th-text-3 mt-2 leading-relaxed">{target.rationale}</p>
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
  const pos = (val: number) => Math.max(2, Math.min(98, ((val - min) / rangeVal) * 100));

  return (
    <div className="relative pt-6 pb-8">
      {/* Track background */}
      <div className="absolute top-8 left-0 right-0 h-2 bg-th-skeleton rounded-full" />
      {/* Colored range segment */}
      <div
        className="absolute top-8 h-2 rounded-full"
        style={{
          left: `${pos(bear)}%`,
          width: `${pos(bull) - pos(bear)}%`,
          background: "linear-gradient(to right, var(--negative), var(--accent), var(--positive))",
          opacity: 0.35,
        }}
      />

      {/* Bear marker */}
      <div className="absolute" style={{ left: `${pos(bear)}%`, top: 0, transform: "translateX(-50%)" }}>
        <p className="text-[10px] font-semibold text-th-negative text-center whitespace-nowrap">${bear.toFixed(0)}</p>
        <p className="text-[9px] text-th-text-4 text-center">Bear</p>
        <div className="w-0.5 h-3 bg-th-negative mx-auto mt-0.5 rounded-full" />
      </div>

      {/* Base marker */}
      <div className="absolute" style={{ left: `${pos(base)}%`, top: 0, transform: "translateX(-50%)" }}>
        <p className="text-[10px] font-semibold text-th-accent text-center whitespace-nowrap">${base.toFixed(0)}</p>
        <p className="text-[9px] text-th-text-4 text-center">Base</p>
        <div className="w-0.5 h-3 bg-th-accent mx-auto mt-0.5 rounded-full" />
      </div>

      {/* Bull marker */}
      <div className="absolute" style={{ left: `${pos(bull)}%`, top: 0, transform: "translateX(-50%)" }}>
        <p className="text-[10px] font-semibold text-th-positive text-center whitespace-nowrap">${bull.toFixed(0)}</p>
        <p className="text-[9px] text-th-text-4 text-center">Bull</p>
        <div className="w-0.5 h-3 bg-th-positive mx-auto mt-0.5 rounded-full" />
      </div>

      {/* Current price marker */}
      <div className="absolute" style={{ left: `${pos(currentPrice)}%`, top: "26px", transform: "translateX(-50%)" }}>
        <div className="w-4 h-4 rounded-full bg-th-text border-2 border-th-surface shadow-md mx-auto" />
        <p className="text-[11px] font-bold text-th-text mt-1 text-center whitespace-nowrap">${currentPrice.toFixed(0)}</p>
        <p className="text-[9px] text-th-text-3 text-center">Current</p>
      </div>
    </div>
  );
}
