"use client";

import { useState, useCallback } from "react";
import BacktestInput from "@/components/BacktestInput";
import ResultsDisplay from "@/components/ResultsDisplay";
import Leaderboard from "@/components/Leaderboard";
import { BacktestResult } from "@/lib/types";

export default function HomePage() {
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [leaderboardKey, setLeaderboardKey] = useState(0);

  const runBacktest = useCallback(async (strategy: string) => {
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy }),
      });

      const data = await res.json();

      if (data.error) {
        setError(data.error);
      } else {
        setResult(data);
      }
    } catch {
      setError("Unable to fetch data. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleAddToLeaderboard = useCallback(
    async (name: string) => {
      if (!result) return;

      const return1yr = result.timeHorizons.find((h) => h.period === "1yr")?.strategyReturn ?? 0;
      const return5yr = result.timeHorizons.find((h) => h.period === "5yr")?.strategyReturn ?? 0;
      const return10yr = result.timeHorizons.find((h) => h.period === "10yr")?.strategyReturn ?? 0;
      const return20yr = result.timeHorizons.find((h) => h.period === "20yr")?.strategyReturn ?? 0;

      try {
        await fetch("/api/leaderboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            description: result.description,
            return1yr,
            return5yr,
            return10yr,
            return20yr,
            matchedStocks: result.matchedStockCount,
          }),
        });
        setLeaderboardKey((k) => k + 1);
      } catch {
        console.error("Failed to save to leaderboard");
      }
    },
    [result]
  );

  const handleSelectStrategy = useCallback(
    (description: string) => {
      runBacktest(description);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [runBacktest]
  );

  return (
    <div className="min-h-screen bg-gray-50/50">
      {/* Header */}
      <header className="pt-16 pb-4 text-center">
        <h1 className="text-5xl font-bold text-gray-900 tracking-tight">
          Backtest
        </h1>
        <p className="mt-3 text-lg text-gray-400 max-w-lg mx-auto">
          Test any stock market strategy using plain English.
          <br />
          See how it would have performed over the last 20 years.
        </p>
      </header>

      {/* Main input section */}
      <main className="px-6 py-8">
        <BacktestInput onSubmit={runBacktest} isLoading={isLoading} />

        {/* Error message */}
        {error && (
          <div className="max-w-3xl mx-auto mt-8">
            <div className="bg-amber-50 border border-amber-200 rounded-2xl px-6 py-4 text-center">
              <p className="text-amber-800 font-medium">{error}</p>
              <p className="text-amber-600 text-sm mt-1">
                Try a different strategy or adjust your criteria.
              </p>
            </div>
          </div>
        )}

        {/* Results */}
        {result && (
          <ResultsDisplay
            result={result}
            onAddToLeaderboard={handleAddToLeaderboard}
          />
        )}

        {/* Leaderboard */}
        <Leaderboard
          onSelectStrategy={handleSelectStrategy}
          refreshKey={leaderboardKey}
        />

        {/* Footer */}
        <footer className="max-w-3xl mx-auto mt-20 pb-12 text-center">
          <p className="text-xs text-gray-300">
            For educational purposes only. Not financial advice. Past performance
            does not guarantee future results.
          </p>
        </footer>
      </main>
    </div>
  );
}
