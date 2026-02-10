"use client";

import { useState } from "react";
import { BacktestResult } from "@/lib/types";
import ResultsChart from "./ResultsChart";

interface ResultsDisplayProps {
  result: BacktestResult;
  onAddToLeaderboard: (name: string) => void;
}

export default function ResultsDisplay({ result, onAddToLeaderboard }: ResultsDisplayProps) {
  const [showLeaderboardPrompt, setShowLeaderboardPrompt] = useState(false);
  const [leaderboardName, setLeaderboardName] = useState("");
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    const name = leaderboardName.trim() || result.strategyName;
    onAddToLeaderboard(name);
    setSaved(true);
    setShowLeaderboardPrompt(false);
  };

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

      {/* Time horizon cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {result.timeHorizons.map((horizon) => (
          <div
            key={horizon.period}
            className="bg-white rounded-2xl border border-gray-100 p-5 text-center"
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
          </div>
        ))}
      </div>

      {/* Chart */}
      <ResultsChart data={result.chartData} />

      {/* Matched stocks list */}
      <div className="mt-6 bg-white rounded-2xl border border-gray-100 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">
          Matched Stocks ({result.matchedStockCount})
        </h3>
        <div className="flex flex-wrap gap-2">
          {result.matchedStocks.map((stock) => (
            <span
              key={stock}
              className="px-3 py-1.5 text-sm text-gray-600 bg-gray-50 rounded-lg border border-gray-100"
            >
              {stock}
            </span>
          ))}
        </div>
      </div>

      {/* Survivorship bias note */}
      <p className="text-xs text-gray-400 mt-4 text-center">
        Results may include survivorship bias. Past performance does not guarantee future results.
        Uses representative historical data for demonstration purposes.
      </p>

      {/* Add to leaderboard */}
      {!saved && (
        <div className="mt-6 text-center">
          {!showLeaderboardPrompt ? (
            <button
              onClick={() => setShowLeaderboardPrompt(true)}
              className="text-sm font-medium text-blue-600 hover:text-blue-700 underline underline-offset-4 transition-colors"
            >
              Add this strategy to the leaderboard
            </button>
          ) : (
            <div className="flex items-center gap-3 max-w-md mx-auto">
              <input
                type="text"
                value={leaderboardName}
                onChange={(e) => setLeaderboardName(e.target.value)}
                placeholder="Give it a name (optional)"
                className="flex-1 px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-50"
              />
              <button
                onClick={handleSave}
                className="px-5 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors"
              >
                Save
              </button>
            </div>
          )}
        </div>
      )}
      {saved && (
        <p className="mt-4 text-sm text-emerald-600 text-center font-medium">
          Added to leaderboard!
        </p>
      )}
    </div>
  );
}
