"use client";

import { useState, useCallback } from "react";
import BacktestInput from "@/components/BacktestInput";
import ResultsDisplay from "@/components/ResultsDisplay";
import Leaderboard from "@/components/Leaderboard";
import Toast from "@/components/Toast";
import { BacktestResult, StructuredParameters, ParsingMethod } from "@/lib/types";

interface ToastState {
  message: string;
  type: "success" | "error";
}

export default function HomePage() {
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [leaderboardKey, setLeaderboardKey] = useState(0);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [parsingMethod, setParsingMethod] = useState<ParsingMethod | undefined>();
  const [dataSource, setDataSource] = useState<"fmp" | "hardcoded" | undefined>();
  const [stockUniverseSize, setStockUniverseSize] = useState<number | undefined>();
  const [warnings, setWarnings] = useState<string[] | undefined>();
  const [stockSourceError, setStockSourceError] = useState<string | undefined>();

  const runBacktest = useCallback(async (strategy: string, structuredParams?: StructuredParameters) => {
    if (structuredParams) {
      setIsUpdating(true);
    } else {
      setIsLoading(true);
      setError(null);
      setResult(null);
      setParsingMethod(undefined);
      setDataSource(undefined);
      setStockUniverseSize(undefined);
      setWarnings(undefined);
      setStockSourceError(undefined);
    }

    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy, structuredParams }),
      });

      const data = await res.json();

      // Always update status info from response
      if (data.parsingMethod) setParsingMethod(data.parsingMethod);
      if (data.dataSource) setDataSource(data.dataSource);
      if (data.stockUniverseSize) setStockUniverseSize(data.stockUniverseSize);
      if (data.warnings) setWarnings(data.warnings);
      if (data.stockSourceError) setStockSourceError(data.stockSourceError);

      if (data.error) {
        if (structuredParams) {
          setToast({ message: data.error, type: "error" });
        } else {
          setError(data.error);
        }
      } else {
        setResult(data);
        if (structuredParams) {
          setToast({ message: "Results updated with your adjustments", type: "success" });
        }
      }
    } catch {
      const msg = "Unable to fetch data. Please try again.";
      if (structuredParams) {
        setToast({ message: msg, type: "error" });
      } else {
        setError(msg);
      }
    } finally {
      setIsLoading(false);
      setIsUpdating(false);
    }
  }, []);

  const handleAddToLeaderboard = useCallback(
    async (name: string): Promise<{ ok: boolean; error?: string }> => {
      if (!result) return { ok: false, error: "No result to save" };

      const return1yr = result.timeHorizons.find((h) => h.period === "1yr")?.strategyReturn ?? 0;
      const return5yr = result.timeHorizons.find((h) => h.period === "5yr")?.strategyReturn ?? 0;
      const return10yr = result.timeHorizons.find((h) => h.period === "10yr")?.strategyReturn ?? 0;
      const return20yr = result.timeHorizons.find((h) => h.period === "20yr")?.strategyReturn ?? 0;

      try {
        const res = await fetch("/api/leaderboard", {
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
            parameters_json: result.parsedParams,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          setToast({ message: data.error || "Failed to save", type: "error" });
          return { ok: false, error: data.error };
        }

        setLeaderboardKey((k) => k + 1);
        setToast({ message: "Strategy added to leaderboard!", type: "success" });
        return { ok: true };
      } catch {
        const errMsg = "Failed to save to leaderboard";
        setToast({ message: errMsg, type: "error" });
        return { ok: false, error: errMsg };
      }
    },
    [result]
  );

  const handleUpdateParams = useCallback(
    (params: StructuredParameters) => {
      if (result) {
        runBacktest(result.description, params);
      }
    },
    [result, runBacktest]
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
      <header className="pt-8 sm:pt-12 md:pt-16 pb-4 text-center px-4">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-gray-900 tracking-tight">
          Backtest
        </h1>
        <p className="mt-3 text-base sm:text-lg text-gray-400 max-w-lg mx-auto">
          Test any stock market strategy using plain English.
          <br className="hidden sm:block" />
          <span className="sm:hidden"> </span>
          See how it would have performed over the last 20 years.
        </p>
      </header>

      {/* Main input section */}
      <main className="px-4 sm:px-6 py-6 sm:py-8">
        <BacktestInput
          onSubmit={runBacktest}
          isLoading={isLoading}
          parsingMethod={parsingMethod}
          dataSource={dataSource}
          stockUniverseSize={stockUniverseSize}
          warnings={warnings}
          stockSourceError={stockSourceError}
        />

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
            onUpdateParams={handleUpdateParams}
            isUpdating={isUpdating}
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
            does not guarantee future results
            <a href="/admin/stocks" className="text-gray-300 hover:text-gray-400 transition-colors">.</a>
          </p>
        </footer>
      </main>

      {/* Toast notifications */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
