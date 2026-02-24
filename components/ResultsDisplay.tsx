"use client";

import { useState, useEffect, useMemo } from "react";
import { useUser, SignUpButton } from "@clerk/nextjs";
import Link from "next/link";
import { BacktestResult, StructuredParameters } from "@/lib/types";
import ResultsChart from "./ResultsChart";
import StrategyInspector from "./StrategyInspector";
import StockLogo from "./StockLogo";
import LoginGate from "./LoginGate";

interface ResultsDisplayProps {
  result: BacktestResult;
  onAddToLeaderboard: (name: string, isPublic: boolean) => Promise<{ ok: boolean; error?: string }>;
  onUpdateParams: (params: StructuredParameters) => void;
  isUpdating: boolean;
  isGuest?: boolean;
  isPremium?: boolean;
}

const GUEST_VISIBLE_STOCKS = 5;

const PERIOD_YEARS: Record<string, number> = {
  "1yr": 1,
  "5yr": 5,
  "10yr": 10,
  "20yr": 20,
};

export default function ResultsDisplay({ result, onAddToLeaderboard, onUpdateParams, isUpdating, isGuest, isPremium }: ResultsDisplayProps) {
  const { isSignedIn } = useUser();
  const [showLeaderboardPrompt, setShowLeaderboardPrompt] = useState(false);
  const [leaderboardName, setLeaderboardName] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sharePublicly, setSharePublicly] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>("10yr");
  const isTickerMode = !!(result.parsedParams?.tickers && result.parsedParams.tickers.length > 0);
  const [stocksExpanded, setStocksExpanded] = useState(true);
  const [stockPage, setStockPage] = useState(1);
  const STOCKS_PER_PAGE = 50;

  // Score data for matched stocks
  const [stockScores, setStockScores] = useState<Map<string, { score: number; sector: string; name: string }>>(new Map());

  // Reset page and period when results change
  useEffect(() => { setStockPage(1); setSelectedPeriod("10yr"); }, [result.matchedStocks]);

  useEffect(() => {
    if (result.matchedStocks.length === 0) return;
    // Extract tickers from "AAPL (Apple Inc.)" format
    const tickers = result.matchedStocks.map((s) => s.split(" ")[0]);
    // Batch fetch in chunks of 100 to avoid URL length limits
    const chunks: string[][] = [];
    for (let i = 0; i < tickers.length; i += 100) {
      chunks.push(tickers.slice(i, i + 100));
    }
    let cancelled = false;
    (async () => {
      const allScores = new Map<string, { score: number; sector: string; name: string }>();
      for (const chunk of chunks) {
        if (cancelled) return;
        try {
          const res = await fetch(`/api/screener?tickers=${chunk.join(",")}`);
          const json = await res.json();
          if (json.stocks) {
            for (const stock of json.stocks) {
              allScores.set(stock.symbol, {
                score: stock.backtestScore,
                sector: stock.sector,
                name: stock.name,
              });
            }
          }
        } catch { /* ignore fetch errors */ }
      }
      if (!cancelled) setStockScores(allScores);
    })();
    return () => { cancelled = true; };
  }, [result.matchedStocks]);

  // Sort matched stocks by composite score (descending), unscored go last
  const sortedMatchedStocks = useMemo(() => {
    return [...result.matchedStocks].sort((a, b) => {
      const tickerA = a.split(" ")[0];
      const tickerB = b.split(" ")[0];
      const scoreA = stockScores.get(tickerA)?.score ?? -1;
      const scoreB = stockScores.get(tickerB)?.score ?? -1;
      return scoreB - scoreA;
    });
  }, [result.matchedStocks, stockScores]);

  const handleSave = async () => {
    const name = leaderboardName.trim() || result.strategyName;
    setSaving(true);
    setSaveError(null);
    const res = await onAddToLeaderboard(name, sharePublicly);
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setShowLeaderboardPrompt(false);
    } else {
      setSaveError(res.error || "Failed to save");
    }
  };

  const handlePeriodClick = (period: string) => {
    setSelectedPeriod(selectedPeriod === period ? null : period);
  };

  const filteredChartData = (() => {
    if (!selectedPeriod || !result.chartData.length) return result.chartData;
    const years = PERIOD_YEARS[selectedPeriod] ?? 20;
    const sliced = result.chartData.slice(-years);
    if (sliced.length === 0) return sliced;

    // Normalize so $10k is invested at the start of the selected period
    const startIdx = result.chartData.length - years;
    const prevEntry = startIdx > 0 ? result.chartData[startIdx - 1] : null;
    const baseStrategy = prevEntry ? prevEntry.strategy : 10000;
    const baseBenchmark = prevEntry ? prevEntry.benchmark : 10000;

    return sliced.map(d => ({
      ...d,
      strategy: Math.round((d.strategy / baseStrategy) * 10000),
      benchmark: Math.round((d.benchmark / baseBenchmark) * 10000),
    }));
  })();

  return (
    <div className="w-full max-w-3xl mx-auto mt-8 sm:mt-10 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-start sm:items-center justify-between gap-4 mb-6">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl sm:text-2xl font-bold text-th-text">Results</h2>
          <p className="text-th-text-3 mt-1 text-sm sm:text-base break-words">{result.description}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <span className="text-sm text-th-text-3">Matched</span>
          <p className="text-xl sm:text-2xl font-bold text-th-text">{result.matchedStockCount}</p>
          <span className="text-sm text-th-text-3">stocks</span>
        </div>
      </div>

      {/* Methodology disclaimer */}
      <details className="mb-6 group">
        <summary className="flex items-center gap-2 text-xs text-th-text-3 cursor-pointer hover:text-th-text-2 transition-colors select-none list-none [&::-webkit-details-marker]:hidden">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" /></svg>
          <span>
            {isTickerMode ? "AI-selected tickers" : "Static screen"} · Equal-weight, annual rebalance · Survivorship bias possible
          </span>
          <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
        </summary>
        <div className="mt-2 text-xs text-th-text-3 leading-relaxed pl-5.5 space-y-1">
          {isTickerMode ? (
            <p>Stocks were selected by AI based on your query — not by metric filters. Re-running the same query may return slightly different tickers.</p>
          ) : (
            <p>Results show how stocks <em>currently</em> matching your criteria performed historically. Stocks are screened against today&apos;s metrics, not the metrics at the time — this is not a point-in-time simulation.</p>
          )}
          <p>Each year, returns are equal-weighted across all matching stocks trading that year. IPOs join from their first full year.</p>
        </div>
      </details>

      {/* Time horizon cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {result.timeHorizons.map((horizon) => (
          <button
            key={horizon.period}
            onClick={() => handlePeriodClick(horizon.period)}
            className={`bg-th-surface rounded-2xl border-2 p-3 sm:p-5 text-center transition-all duration-150 cursor-pointer shadow-sm hover:shadow-md ${
              selectedPeriod === horizon.period
                ? "border-th-focus-border ring-4 ring-th-focus-ring shadow-md"
                : "border-th-border-light hover:border-th-border"
            }`}
          >
            <p className="text-xs sm:text-sm font-medium text-th-text-3 uppercase tracking-wide mb-1 sm:mb-2">
              {horizon.period}
            </p>
            <p
              className={`text-2xl sm:text-3xl font-bold ${
                horizon.outperforms ? "text-th-positive" : "text-th-negative"
              }`}
            >
              {horizon.strategyReturn > 0 ? "+" : ""}
              {horizon.strategyReturn.toFixed(1)}%
            </p>
            <p className="text-xs sm:text-sm text-th-text-3 mt-1 sm:mt-2">
              S&P 500: {horizon.benchmarkReturn > 0 ? "+" : ""}
              {horizon.benchmarkReturn.toFixed(1)}%
            </p>
            <div className="mt-2">
              {horizon.outperforms ? (
                <span className="inline-flex items-center text-xs font-medium text-th-positive-text bg-th-positive-bg rounded-full px-2 py-0.5">
                  Beats market
                </span>
              ) : (
                <span className="inline-flex items-center text-xs font-medium text-th-negative-text bg-th-negative-bg rounded-full px-2 py-0.5">
                  Under market
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
      {selectedPeriod && (
        <p className="text-xs text-th-text-3 mt-2 text-center">
          Showing {selectedPeriod} performance. Click again to show all.
        </p>
      )}

      {/* Chart */}
      <ResultsChart data={filteredChartData} period={selectedPeriod} />

      {/* Strategy Inspector */}
      {result.parsedParams && (
        <StrategyInspector
          params={result.parsedParams}
          onUpdate={onUpdateParams}
          isLoading={isUpdating}
        />
      )}

      {/* Matched stocks list - collapsible */}
      <div className="mt-6 bg-th-surface rounded-2xl border border-th-border-light p-4 sm:p-6">
        <button
          onClick={() => setStocksExpanded(!stocksExpanded)}
          className="w-full flex items-center justify-between text-left min-h-[44px]"
        >
          <h3 className="text-base sm:text-lg font-semibold text-th-text">
            {result.matchedStockCount} stocks matched your criteria
          </h3>
          <svg
            className={`w-5 h-5 text-th-text-3 transition-transform duration-200 ${
              stocksExpanded ? "rotate-180" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {stocksExpanded && (() => {
          const totalStockPages = Math.ceil(sortedMatchedStocks.length / STOCKS_PER_PAGE);
          const pagedStocks = sortedMatchedStocks.slice((stockPage - 1) * STOCKS_PER_PAGE, stockPage * STOCKS_PER_PAGE);
          const visibleStocks = isGuest ? pagedStocks.slice(0, GUEST_VISIBLE_STOCKS) : pagedStocks;
          const hiddenStocks = isGuest ? pagedStocks.slice(GUEST_VISIBLE_STOCKS) : [];
          return (
            <>
              <div className="flex flex-wrap gap-2 mt-4">
                {visibleStocks.map((stock) => {
                  const ticker = stock.split(" ")[0];
                  const scoreData = stockScores.get(ticker);
                  return (
                    <Link
                      key={stock}
                      href={`/research/${ticker}`}
                      title={scoreData?.name || ticker}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-th-text-2 bg-th-inset rounded-lg border border-th-border-light hover:border-th-accent-border hover:bg-th-accent-bg transition-colors"
                    >
                      <StockLogo ticker={ticker} sector={scoreData?.sector} />
                      <span className="font-medium">{ticker}</span>
                      {scoreData && !isGuest && (
                        <span className={`text-[10px] font-bold px-1 py-0.5 rounded ${
                          scoreData.score >= 75 ? "bg-th-positive-bg text-th-positive" :
                          scoreData.score >= 50 ? "bg-th-accent-bg text-th-accent" :
                          scoreData.score >= 25 ? "bg-th-warning-bg text-th-warning" :
                          "bg-th-negative-bg text-th-negative"
                        }`}>
                          {scoreData.score}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
              {/* Blurred remaining stocks for guests */}
              {isGuest && hiddenStocks.length > 0 && (
                <LoginGate
                  locked={true}
                  message="Sign up to see all matched stocks"
                  subMessage={`${sortedMatchedStocks.length - GUEST_VISIBLE_STOCKS} more stocks hidden`}
                  blur="medium"
                  className="mt-2"
                >
                  <div className="flex flex-wrap gap-2">
                    {hiddenStocks.map((stock) => {
                      const ticker = stock.split(" ")[0];
                      const scoreData = stockScores.get(ticker);
                      return (
                        <span
                          key={stock}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-th-text-2 bg-th-inset rounded-lg border border-th-border-light"
                        >
                          <StockLogo ticker={ticker} sector={scoreData?.sector} />
                          <span className="font-medium">{ticker}</span>
                        </span>
                      );
                    })}
                  </div>
                </LoginGate>
              )}
              {!isGuest && totalStockPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-4 pt-3 border-t border-th-border-light">
                  <button
                    onClick={() => setStockPage((p) => Math.max(1, p - 1))}
                    disabled={stockPage === 1}
                    className="px-3 py-1.5 text-xs font-medium text-th-text-2 bg-th-inset border border-th-border rounded-lg hover:bg-th-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Previous
                  </button>
                  <span className="text-xs text-th-text-3">
                    {(stockPage - 1) * STOCKS_PER_PAGE + 1}&ndash;{Math.min(stockPage * STOCKS_PER_PAGE, sortedMatchedStocks.length)} of {sortedMatchedStocks.length}
                  </span>
                  <button
                    onClick={() => setStockPage((p) => Math.min(totalStockPages, p + 1))}
                    disabled={stockPage === totalStockPages}
                    className="px-3 py-1.5 text-xs font-medium text-th-text-2 bg-th-inset border border-th-border rounded-lg hover:bg-th-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          );
        })()}
      </div>

      {/* Survivorship bias note */}
      <p className="text-xs text-th-text-3 mt-4 text-center">
        Past performance does not guarantee future results.
        Uses representative historical data for demonstration purposes.
      </p>

      {/* Save strategy — premium only */}
      {!saved && (
        <div className="mt-6 text-center">
          {!isSignedIn ? (
            <SignUpButton mode="modal" forceRedirectUrl={typeof window !== "undefined" ? window.location.href : "/"}>
              <button className="px-6 py-3 text-sm font-medium text-white bg-th-accent rounded-xl hover:bg-th-accent-hover transition-colors">
                Create free account to save strategies
              </button>
            </SignUpButton>
          ) : !isPremium ? (
            <Link href="/pricing" className="inline-flex items-center gap-2 px-6 py-3 text-sm font-medium text-th-accent bg-th-accent-bg border border-th-accent-border rounded-xl hover:bg-th-accent-muted transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
              </svg>
              Upgrade to save strategies
            </Link>
          ) : !showLeaderboardPrompt ? (
            <button
              onClick={() => setShowLeaderboardPrompt(true)}
              className="px-6 py-3 text-sm font-medium text-white bg-th-accent rounded-xl hover:bg-th-accent-hover transition-colors"
            >
              Save Strategy
            </button>
          ) : (
            <div className="space-y-3 max-w-md mx-auto px-4 sm:px-0">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
                <input
                  type="text"
                  value={leaderboardName}
                  onChange={(e) => setLeaderboardName(e.target.value)}
                  placeholder="Give it a name (optional)"
                  className="flex-1 px-4 py-2.5 text-sm border border-th-border rounded-xl focus:outline-none focus:border-th-focus-border focus:ring-2 focus:ring-th-focus-ring"
                />
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-5 py-2.5 text-sm font-medium text-white bg-th-accent rounded-xl hover:bg-th-accent-hover transition-colors disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
              <label className="flex items-center gap-2 justify-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={sharePublicly}
                  onChange={(e) => setSharePublicly(e.target.checked)}
                  className="w-4 h-4 rounded border-th-border text-th-accent focus:ring-th-focus-ring"
                />
                <span className="text-sm text-th-text-3">Also share on public leaderboard</span>
              </label>
              {saveError && (
                <p className="text-sm text-th-negative">{saveError}</p>
              )}
            </div>
          )}
        </div>
      )}
      {saved && (
        <p className="mt-4 text-sm text-th-positive text-center font-medium">
          Strategy saved to My Strategies!
        </p>
      )}
    </div>
  );
}
