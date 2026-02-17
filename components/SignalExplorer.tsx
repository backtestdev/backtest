"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import StockLogo from "./StockLogo";

interface Quintile {
  quintile: number;
  avgReturn: number;
  stockCount: number;
}

interface TopStock {
  symbol: string;
  name: string;
  sector: string;
  metricValue: number;
  marketCap: number;
  yearsOfData?: number;
}

interface Signal {
  metric: string;
  label: string;
  quintiles: Quintile[];
  spread: number;
  direction: "higher_better" | "lower_better";
  yearsOfData: number;
  type: "static";
  topStocks: TopStock[];
}

interface SignalData {
  signals: Signal[];
  stockCount: number;
  yearsAnalyzed: number;
  period: number;
  methodology: string;
}

const PERIODS = [5, 10, 20] as const;

// Format metric values for display based on metric type
const PERCENTAGE_METRICS = new Set([
  "earnings_yield", "roe", "roic", "return_on_assets", "profit_margin",
  "gross_profit_margin", "operating_profit_margin", "revenue_growth",
  "earnings_growth", "revenue_growth_3yr_avg", "dividend_yield",
  "payout_ratio", "free_cash_flow_yield",
]);

function formatMetricValue(metric: string, value: number): string {
  if (PERCENTAGE_METRICS.has(metric)) {
    return `${(value * 100).toFixed(1)}%`;
  }
  if (metric === "market_cap") {
    const b = value / 1_000_000_000;
    if (b >= 1000) return `$${(b / 1000).toFixed(1)}T`;
    if (b >= 1) return `$${b.toFixed(1)}B`;
    return `$${(b * 1000).toFixed(0)}M`;
  }
  if (metric === "consecutive_earnings_growth") return `${value}yr`;
  return value.toFixed(1);
}

function formatMarketCap(b: number): string {
  if (b >= 1000) return `$${(b / 1000).toFixed(1)}T`;
  if (b >= 1) return `$${b.toFixed(1)}B`;
  return `$${(b * 1000).toFixed(0)}M`;
}

export default function SignalExplorer() {
  const [data, setData] = useState<SignalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSignal, setExpandedSignal] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMetrics, setSelectedMetrics] = useState<Set<string>>(new Set());
  const [period, setPeriod] = useState<number>(10);

  useEffect(() => {
    async function fetchSignals() {
      setLoading(true);
      try {
        const res = await fetch(`/api/signals?period=${period}`);
        if (!res.ok) throw new Error("Failed to fetch");
        const json = await res.json();
        setData(json);
        setError(null);
      } catch {
        setError("Failed to load signal data. Make sure the database is populated.");
      } finally {
        setLoading(false);
      }
    }
    fetchSignals();
  }, [period]);

  // Filter signals: remove < 6% spread and apply search
  const filteredSignals = useMemo(() => {
    if (!data) return [];
    return data.signals
      .filter((s) => s.spread >= 0.06)
      .filter((s) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return s.label.toLowerCase().includes(q) || s.metric.toLowerCase().includes(q);
      });
  }, [data, searchQuery]);

  // Composite signal from selected metrics
  const compositeSignal = useMemo(() => {
    if (selectedMetrics.size < 2 || !data) return null;
    const selected = data.signals.filter((s) => selectedMetrics.has(s.metric));
    if (selected.length < 2) return null;

    // Average quintile returns across selected signals
    const compositeQuintiles: Quintile[] = [1, 2, 3, 4, 5].map((q) => {
      let totalReturn = 0;
      let totalCount = 0;
      for (const sig of selected) {
        const qData = sig.quintiles.find((qq) => qq.quintile === q);
        if (qData) {
          totalReturn += qData.avgReturn;
          totalCount++;
        }
      }
      return {
        quintile: q,
        avgReturn: totalCount > 0 ? totalReturn / totalCount : 0,
        stockCount: Math.round(selected.reduce((sum, s) => sum + (s.quintiles.find((qq) => qq.quintile === q)?.stockCount || 0), 0) / selected.length),
      };
    });

    const spread = Math.abs(compositeQuintiles[0].avgReturn - compositeQuintiles[4].avgReturn);
    const direction: "higher_better" | "lower_better" =
      compositeQuintiles[4].avgReturn > compositeQuintiles[0].avgReturn ? "higher_better" : "lower_better";

    // Composite top stocks: find stocks that appear across selected signals'
    // winner quintiles. Track which specific signals each stock ranks in.
    const stockAppearances = new Map<string, { labels: string[]; stock: TopStock }>();
    for (const sig of selected) {
      for (const stock of sig.topStocks) {
        const existing = stockAppearances.get(stock.symbol);
        if (existing) {
          existing.labels.push(sig.label);
          if (stock.marketCap > existing.stock.marketCap) {
            existing.stock = stock;
          }
        } else {
          stockAppearances.set(stock.symbol, { labels: [sig.label], stock: { ...stock } });
        }
      }
    }
    const compositeTopStocks = Array.from(stockAppearances.values())
      .sort((a, b) => b.labels.length - a.labels.length || b.stock.marketCap - a.stock.marketCap)
      .slice(0, 5)
      .map((entry) => ({
        ...entry.stock,
        matchedSignals: entry.labels,
      }));

    return {
      quintiles: compositeQuintiles,
      spread,
      direction,
      labels: selected.map((s) => s.label),
      topStocks: compositeTopStocks,
    };
  }, [selectedMetrics, data]);

  const toggleMetric = (metric: string) => {
    setSelectedMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(metric)) {
        next.delete(metric);
      } else {
        next.add(metric);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-th-bg px-4 sm:px-6 py-12 sm:py-16">
        <div className="max-w-4xl mx-auto">
          <div className="h-10 w-64 bg-th-skeleton rounded-lg animate-pulse mb-4" />
          <div className="h-5 w-full max-w-sm sm:w-96 bg-th-skeleton rounded animate-pulse mb-8" />
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-20 bg-th-surface rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-th-bg px-6 py-16">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-th-text-3">{error || "No data available"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-th-bg px-4 sm:px-6 py-8 sm:py-12">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <h1 className="text-2xl sm:text-3xl font-bold text-th-text tracking-tight">Signal Explorer</h1>
        <p className="mt-2 text-sm sm:text-base text-th-text-3 max-w-2xl">
          Which metrics predict stock outperformance? We split {data.stockCount.toLocaleString()} stocks
          into quintiles by each metric and compare their average annual returns over {data.yearsAnalyzed} years.
        </p>

        {/* Time period selector */}
        <div className="mt-4 flex items-center gap-2">
          <span className="text-xs text-th-text-3 mr-1">Period:</span>
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-xs font-medium rounded-lg border transition-colors ${
                period === p
                  ? "bg-th-nav-active text-th-nav-active-text border-th-nav-active"
                  : "bg-th-surface text-th-text-3 border-th-border hover:border-th-border"
              }`}
            >
              {p}Y
            </button>
          ))}
        </div>

        {/* Methodology note */}
        <div className="mt-4 mb-6 flex items-start gap-2 text-xs text-th-warning bg-th-warning-bg border border-th-warning-border rounded-lg px-3 py-2 max-w-2xl">
          <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
          </svg>
          <span>
            <strong>Static analysis:</strong> Stocks are screened on today&apos;s metric values, then historical returns are measured.
            This is not point-in-time. Treat as directional, not definitive.
          </span>
        </div>

        {/* Search + metric selector */}
        <div className="mb-6 space-y-3">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-th-text-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search metrics (e.g. earnings, ROE, margin)..."
              className="w-full pl-10 pr-4 py-2.5 text-sm bg-th-surface border border-th-border rounded-xl focus:outline-none focus:border-th-focus-border focus:ring-1 focus:ring-th-focus-ring transition-all"
            />
          </div>

          {/* Selected metrics for composite */}
          {selectedMetrics.size > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-th-text-3">Composite from:</span>
              {Array.from(selectedMetrics).map((metric) => {
                const sig = data.signals.find((s) => s.metric === metric);
                return (
                  <button
                    key={metric}
                    onClick={() => toggleMetric(metric)}
                    className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-th-accent-bg text-th-accent-text rounded-full border border-th-accent-border hover:bg-th-accent-muted transition-colors"
                  >
                    {sig?.label || metric}
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                );
              })}
              <button
                onClick={() => setSelectedMetrics(new Set())}
                className="text-xs text-th-text-3 hover:text-th-text-2 transition-colors"
              >
                Clear all
              </button>
            </div>
          )}
        </div>

        {/* Composite signal card */}
        {compositeSignal && (
          <div className="mb-6 bg-th-accent-bg rounded-2xl border border-th-accent-border p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-th-text">Combined Signal</h3>
                <p className="text-[11px] text-th-text-3 mt-0.5">
                  Blended quintile returns across {compositeSignal.labels.length} metrics
                </p>
              </div>
              <div className="text-right">
                <span className={`text-lg font-bold ${
                  compositeSignal.spread > 0.05 ? "text-th-positive" : compositeSignal.spread > 0.02 ? "text-th-accent" : "text-th-text-3"
                }`}>
                  {(compositeSignal.spread * 100).toFixed(1)}%
                </span>
                <p className="text-[9px] text-th-text-3">spread / yr</p>
              </div>
            </div>
            <div className="grid grid-cols-5 gap-1.5 sm:gap-3">
              {compositeSignal.quintiles.map((q) => {
                const isWinner = compositeSignal.direction === "higher_better"
                  ? q.quintile === 5
                  : q.quintile === 1;
                return (
                  <div
                    key={q.quintile}
                    className={`text-center p-2 sm:p-3 rounded-lg ${
                      isWinner ? "bg-th-positive-bg border border-th-positive-border" : "bg-th-surface border border-th-border-light"
                    }`}
                  >
                    <p className="text-[10px] sm:text-xs font-medium text-th-text-3">Q{q.quintile}</p>
                    <p className={`text-sm sm:text-lg font-bold mt-0.5 sm:mt-1 ${
                      q.avgReturn >= 0 ? "text-th-positive" : "text-th-negative"
                    }`}>
                      {(q.avgReturn * 100).toFixed(1)}%
                    </p>
                    <p className="text-[9px] sm:text-[10px] text-th-text-3">avg/yr</p>
                  </div>
                );
              })}
            </div>
            {/* Composite top stocks */}
            {compositeSignal.topStocks && compositeSignal.topStocks.length > 0 && (
              <div className="mt-4 pt-3 border-t border-th-accent-border/60">
                <p className="text-xs font-semibold text-th-text-3 mb-2">
                  Top stocks across selected signals
                </p>
                <div className="space-y-1.5">
                  {compositeSignal.topStocks.map((stock) => (
                    <Link
                      key={stock.symbol}
                      href={`/research/${stock.symbol}`}
                      className="flex items-center gap-2 bg-th-surface rounded-lg px-3 py-2 border border-th-accent-border hover:border-th-accent-border hover:bg-th-surface transition-colors"
                    >
                      <StockLogo ticker={stock.symbol} sector={stock.sector} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-semibold text-th-text">{stock.symbol}</span>
                          <span className="text-xs text-th-text-3 truncate">{stock.name}</span>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {stock.matchedSignals.map((label) => (
                            <span key={label} className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-th-accent-muted/70 text-th-accent-text">
                              {label.replace(/ \(.*\)/, "")}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-[10px] text-th-text-3">{formatMarketCap(stock.marketCap)}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-th-skeleton text-th-text-3">{stock.sector}</span>
                        <svg className="w-3.5 h-3.5 text-th-text-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                        </svg>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[10px] text-th-text-3 mt-3 text-center">
              Average of per-metric quintile returns. A true composite would require per-stock multi-factor scoring.
            </p>
          </div>
        )}

        {/* Signal table header */}
        <div className="hidden sm:grid grid-cols-12 gap-2 px-4 py-2 text-xs font-medium text-th-text-3 uppercase tracking-wider">
          <div className="col-span-1">#</div>
          <div className="col-span-3">Metric</div>
          <div className="col-span-6">Quintile Returns (Q1=Low, Q5=High)</div>
          <div className="col-span-2 text-right">Spread</div>
        </div>

        {/* Signal rows */}
        <div className="space-y-2">
          {filteredSignals.map((signal, index) => {
            const isExpanded = expandedSignal === signal.metric;
            const isSelected = selectedMetrics.has(signal.metric);
            const maxReturn = Math.max(...signal.quintiles.map((q) => q.avgReturn));
            const minReturn = Math.min(...signal.quintiles.map((q) => q.avgReturn));
            const range = maxReturn - minReturn || 1;

            return (
              <div key={signal.metric}>
                <div className="flex items-center gap-1">
                  {/* Checkbox for composite */}
                  <button
                    onClick={() => toggleMetric(signal.metric)}
                    className={`w-5 h-5 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                      isSelected
                        ? "bg-th-accent border-th-accent text-white"
                        : "border-th-border hover:border-th-accent-border"
                    }`}
                    title="Add to composite signal"
                  >
                    {isSelected && (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={() => setExpandedSignal(isExpanded ? null : signal.metric)}
                    className={`flex-1 px-3 py-3 bg-th-surface rounded-xl border transition-colors text-left cursor-pointer min-h-[44px] ${
                      isSelected ? "border-th-accent-border bg-th-accent-bg" : "border-th-border-light hover:border-th-border"
                    }`}
                  >
                    {/* Mobile layout */}
                    <div className="sm:hidden">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-th-text-4">{index + 1}</span>
                          <p className="text-sm font-semibold text-th-text">{signal.label}</p>
                        </div>
                        <span className={`text-sm font-bold ${
                          signal.spread > 0.05 ? "text-th-positive" : signal.spread > 0.02 ? "text-th-accent" : "text-th-text-3"
                        }`}>
                          {(signal.spread * 100).toFixed(1)}%/yr
                        </span>
                      </div>
                      <div className="flex items-end gap-1 h-8">
                        {signal.quintiles.map((q) => {
                          const height = Math.max(15, ((q.avgReturn - minReturn) / range) * 100);
                          const isWinner = signal.direction === "higher_better"
                            ? q.quintile === 5
                            : q.quintile === 1;
                          return (
                            <div key={q.quintile} className="flex-1 flex flex-col items-center gap-0.5">
                              <span className="text-[8px] text-th-text-3">{(q.avgReturn * 100).toFixed(0)}%</span>
                              <div
                                className={`w-full rounded-sm transition-all ${isWinner ? "bg-th-positive-bar" : "bg-th-bar"}`}
                                style={{ height: `${height}%`, minHeight: "4px" }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    {/* Desktop layout */}
                    <div className="hidden sm:grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-1">
                        <span className="text-sm font-medium text-th-text-4">{index + 1}</span>
                      </div>
                      <div className="col-span-3">
                        <p className="text-sm font-semibold text-th-text">{signal.label}</p>
                        <p className="text-[10px] text-th-text-3 mt-0.5">
                          {signal.direction === "higher_better" ? "Higher is better" : "Lower is better"}
                        </p>
                      </div>
                      <div className="col-span-6">
                        <div className="flex items-end gap-1 h-10">
                          {signal.quintiles.map((q) => {
                            const height = Math.max(15, ((q.avgReturn - minReturn) / range) * 100);
                            const isWinner = signal.direction === "higher_better"
                              ? q.quintile === 5
                              : q.quintile === 1;
                            return (
                              <div
                                key={q.quintile}
                                className="flex-1 flex flex-col items-center gap-0.5"
                              >
                                <span className="text-[9px] text-th-text-3">
                                  {(q.avgReturn * 100).toFixed(1)}%
                                </span>
                                <div
                                  className={`w-full rounded-sm transition-all ${
                                    isWinner ? "bg-th-positive-bar" : "bg-th-bar"
                                  }`}
                                  style={{ height: `${height}%`, minHeight: "4px" }}
                                />
                                <span className="text-[9px] text-th-text-4">Q{q.quintile}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <div className="col-span-2 text-right">
                        <span className={`text-sm font-bold ${
                          signal.spread > 0.05 ? "text-th-positive" : signal.spread > 0.02 ? "text-th-accent" : "text-th-text-3"
                        }`}>
                          {(signal.spread * 100).toFixed(1)}%
                        </span>
                        <p className="text-[9px] text-th-text-4">per year</p>
                      </div>
                    </div>
                  </button>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="mt-1 ml-0 sm:ml-6 mb-2 bg-th-inset rounded-lg p-3 sm:p-4">
                    <div className="grid grid-cols-5 gap-1.5 sm:gap-3">
                      {signal.quintiles.map((q) => {
                        const isWinner = signal.direction === "higher_better"
                          ? q.quintile === 5
                          : q.quintile === 1;
                        return (
                          <div
                            key={q.quintile}
                            className={`text-center p-2 sm:p-3 rounded-lg ${
                              isWinner ? "bg-th-positive-bg border border-th-positive-border" : "bg-th-surface border border-th-border-light"
                            }`}
                          >
                            <p className="text-[10px] sm:text-xs font-medium text-th-text-3">
                              <span className="hidden sm:inline">Quintile </span>Q{q.quintile}
                            </p>
                            <p className="text-[9px] text-th-text-4 hidden sm:block">
                              {q.quintile === 1 ? "(lowest)" : q.quintile === 5 ? "(highest)" : ""}
                            </p>
                            <p className={`text-sm sm:text-lg font-bold mt-0.5 sm:mt-1 ${
                              q.avgReturn >= 0 ? "text-th-positive" : "text-th-negative"
                            }`}>
                              {(q.avgReturn * 100).toFixed(1)}%
                            </p>
                            <p className="text-[9px] sm:text-[10px] text-th-text-3 mt-0.5">
                              avg/yr
                            </p>
                            <p className="text-[9px] sm:text-[10px] text-th-text-4 mt-0.5 sm:mt-1">
                              {q.stockCount}
                            </p>
                          </div>
                        );
                      })}
                    </div>

                    {/* Top stocks in the winner quintile (show first 5) */}
                    {signal.topStocks && signal.topStocks.length > 0 && (
                      <div className="mt-4 pt-3 border-t border-th-border">
                        <p className="text-xs font-semibold text-th-text-3 mb-2">
                          Top stocks with {signal.direction === "lower_better" ? "lowest" : "strongest"} {signal.label}
                        </p>
                        <div className="space-y-1.5">
                          {signal.topStocks.slice(0, 5).map((stock) => (
                            <Link
                              key={stock.symbol}
                              href={`/research/${stock.symbol}`}
                              className="flex items-center gap-2 bg-th-surface rounded-lg px-3 py-2 border border-th-border-light hover:border-th-accent-border hover:bg-th-accent-bg transition-colors"
                            >
                              <StockLogo ticker={stock.symbol} sector={stock.sector} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm font-semibold text-th-text">{stock.symbol}</span>
                                  <span className="text-xs text-th-text-3 truncate">{stock.name}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 flex-shrink-0">
                                <div className="text-right">
                                  <p className="text-xs font-bold text-th-text-2">
                                    {formatMetricValue(signal.metric, stock.metricValue)}
                                  </p>
                                  <p className="text-[9px] text-th-text-3">{signal.label}</p>
                                </div>
                                <span className="text-[10px] text-th-text-3">{formatMarketCap(stock.marketCap)}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-th-skeleton text-th-text-3">{stock.sector}</span>
                                <svg className="w-3.5 h-3.5 text-th-text-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                                </svg>
                              </div>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}

                    <p className="text-xs text-th-text-3 mt-3 text-center">
                      Stocks with {signal.direction === "lower_better" ? "lower" : "higher"} {signal.label} values
                      have historically returned {(signal.spread * 100).toFixed(1)}% more per year on average.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {filteredSignals.length === 0 && (
          <div className="text-center py-12 text-th-text-3">
            {searchQuery.trim()
              ? `No signals matching "${searchQuery}" with spread above 6%.`
              : "No signals found. Make sure the database is populated with stock data and annual returns."}
          </div>
        )}
      </div>
    </div>
  );
}
