"use client";

import { useState } from "react";
import { useUser, SignUpButton } from "@clerk/nextjs";
import { BacktestResult, StructuredParameters } from "@/lib/types";
import ResultsChart from "./ResultsChart";
import StrategyInspector from "./StrategyInspector";

interface ResultsDisplayProps {
  result: BacktestResult;
  onAddToLeaderboard: (name: string) => Promise<{ ok: boolean; error?: string }>;
  onUpdateParams: (params: StructuredParameters) => void;
  isUpdating: boolean;
}

const PERIOD_YEARS: Record<string, number> = {
  "1yr": 1,
  "5yr": 5,
  "10yr": 10,
  "20yr": 20,
};

export default function ResultsDisplay({ result, onAddToLeaderboard, onUpdateParams, isUpdating }: ResultsDisplayProps) {
  const { isSignedIn } = useUser();
  const [showLeaderboardPrompt, setShowLeaderboardPrompt] = useState(false);
  const [leaderboardName, setLeaderboardName] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const [stocksExpanded, setStocksExpanded] = useState(false);

  const handleSave = async () => {
    const name = leaderboardName.trim() || result.strategyName;
    setSaving(true);
    setSaveError(null);
    const res = await onAddToLeaderboard(name);
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
    <div className="w-full max-w-3xl mx-auto mt-10 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Results</h2>
          <p className="text-gray-500 mt-1">{result.description}</p>
        </div>
        <div className="text-right">
          <span className="text-sm text-gray-400">Matched</span>
          <p className="text-2xl font-bold text-gray-900">{result.matchedStockCount}</p>
          <span className="text-sm text-gray-400">stocks</span>
        </div>
      </div>

      {/* Methodology disclaimer */}
      <div className="mb-6 bg-amber-50 border border-amber-200 rounded-2xl px-6 py-4">
        <div className="flex gap-3">
          <span className="text-amber-500 text-lg flex-shrink-0">&#9888;</span>
          <div className="text-sm text-amber-800 space-y-2">
            <p>
              This analysis shows how stocks <strong>currently</strong> matching your criteria have performed historically.
              It does not simulate buying/selling as stocks entered/exited the criteria (point-in-time backtesting).
              Results may include survivorship bias.
            </p>
            <p>
              <strong>Portfolio method:</strong> Equal-weight, rebalanced annually. Each year, returns are averaged across
              all matching stocks that were trading that year. When a stock IPOs mid-history, it joins the
              portfolio from its first full year onward.
            </p>
          </div>
        </div>
      </div>

      {/* Time horizon cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {result.timeHorizons.map((horizon) => (
          <button
            key={horizon.period}
            onClick={() => handlePeriodClick(horizon.period)}
            className={`bg-white rounded-2xl border-2 p-5 text-center transition-all duration-150 cursor-pointer ${
              selectedPeriod === horizon.period
                ? "border-blue-500 ring-4 ring-blue-50"
                : "border-gray-100 hover:border-gray-200"
            }`}
          >
            <p className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-2">
              {horizon.period}
            </p>
            <p
              className={`text-3xl font-bold ${
                horizon.outperforms ? "text-emerald-600" : "text-red-500"
              }`}
            >
              {horizon.strategyReturn > 0 ? "+" : ""}
              {horizon.strategyReturn.toFixed(1)}%
            </p>
            <p className="text-sm text-gray-400 mt-2">
              S&P 500: {horizon.benchmarkReturn > 0 ? "+" : ""}
              {horizon.benchmarkReturn.toFixed(1)}%
            </p>
            <div className="mt-2">
              {horizon.outperforms ? (
                <span className="inline-flex items-center text-xs font-medium text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">
                  Beats market
                </span>
              ) : (
                <span className="inline-flex items-center text-xs font-medium text-red-700 bg-red-50 rounded-full px-2 py-0.5">
                  Under market
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
      {selectedPeriod && (
        <p className="text-xs text-gray-400 mt-2 text-center">
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
      <div className="mt-6 bg-white rounded-2xl border border-gray-100 p-6">
        <button
          onClick={() => setStocksExpanded(!stocksExpanded)}
          className="w-full flex items-center justify-between text-left"
        >
          <h3 className="text-lg font-semibold text-gray-900">
            {result.matchedStockCount} stocks matched your criteria
          </h3>
          <svg
            className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${
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
        {stocksExpanded && (
          <div className="flex flex-wrap gap-2 mt-4">
            {result.matchedStocks.map((stock) => (
              <span
                key={stock}
                className="px-3 py-1.5 text-sm text-gray-600 bg-gray-50 rounded-lg border border-gray-100"
              >
                {stock}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Survivorship bias note */}
      <p className="text-xs text-gray-400 mt-4 text-center">
        Past performance does not guarantee future results.
        Uses representative historical data for demonstration purposes.
      </p>

      {/* Add to leaderboard */}
      {!saved && (
        <div className="mt-6 text-center">
          {!isSignedIn ? (
            <SignUpButton mode="modal" forceRedirectUrl={typeof window !== "undefined" ? window.location.href : "/"}>
              <button className="px-6 py-3 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors">
                Sign up to save to leaderboard
              </button>
            </SignUpButton>
          ) : !showLeaderboardPrompt ? (
            <button
              onClick={() => setShowLeaderboardPrompt(true)}
              className="px-6 py-3 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors"
            >
              Add to Leaderboard
            </button>
          ) : (
            <div className="space-y-3 max-w-md mx-auto">
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={leaderboardName}
                  onChange={(e) => setLeaderboardName(e.target.value)}
                  placeholder="Give it a name (optional)"
                  className="flex-1 px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-50"
                />
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-5 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
              {saveError && (
                <p className="text-sm text-red-600">{saveError}</p>
              )}
            </div>
          )}
        </div>
      )}
      {saved && (
        <p className="mt-4 text-sm text-emerald-600 text-center font-medium">
          Strategy added to leaderboard!
        </p>
      )}
    </div>
  );
}
