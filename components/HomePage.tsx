"use client";

import { useState, useCallback, useEffect } from "react";
import { useUser, SignUpButton, SignInButton } from "@clerk/nextjs";
import BacktestInput from "@/components/BacktestInput";
import ResultsDisplay from "@/components/ResultsDisplay";
import Leaderboard from "@/components/Leaderboard";
import Toast from "@/components/Toast";
import { BacktestResult, StructuredParameters, ParsingMethod } from "@/lib/types";

const FREE_RUN_LIMIT = 1;
const STORAGE_KEY = "backtest_free_runs";

interface ToastState {
  message: string;
  type: "success" | "error";
}

export default function HomePage() {
  const { isSignedIn } = useUser();
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [leaderboardKey, setLeaderboardKey] = useState(0);
  const [leaderboardTab, setLeaderboardTab] = useState<"public" | "personal" | undefined>();
  const [toast, setToast] = useState<ToastState | null>(null);
  const [parsingMethod, setParsingMethod] = useState<ParsingMethod | undefined>();
  const [dataSource, setDataSource] = useState<"fmp" | "hardcoded" | undefined>();
  const [stockUniverseSize, setStockUniverseSize] = useState<number | undefined>();
  const [warnings, setWarnings] = useState<string[] | undefined>();
  const [stockSourceError, setStockSourceError] = useState<string | undefined>();
  const [freeRunsUsed, setFreeRunsUsed] = useState(0);

  // Load free run count from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setFreeRunsUsed(parseInt(stored, 10) || 0);
    } catch { /* SSR or private browsing */ }
  }, []);

  const isGuest = !isSignedIn;
  const freeRunsExhausted = isGuest && freeRunsUsed >= FREE_RUN_LIMIT;

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
        // Track free runs for guests
        if (!isSignedIn && !structuredParams) {
          const newCount = freeRunsUsed + 1;
          setFreeRunsUsed(newCount);
          try { localStorage.setItem(STORAGE_KEY, String(newCount)); } catch { /* ignore */ }
        }
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
  }, [isSignedIn, freeRunsUsed]);

  const handleAddToLeaderboard = useCallback(
    async (name: string, isPublic: boolean = true): Promise<{ ok: boolean; error?: string }> => {
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
            is_public: isPublic,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          setToast({ message: data.error || "Failed to save", type: "error" });
          return { ok: false, error: data.error };
        }

        setLeaderboardKey((k) => k + 1);
        setLeaderboardTab("personal"); // Switch to personal view to show the new entry
        setToast({ message: "Strategy saved to My Strategies!", type: "success" });
        return { ok: true };
      } catch {
        const errMsg = "Failed to save strategy";
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
    <div className="min-h-screen bg-th-bg">
      {/* Header */}
      <header className="pt-8 sm:pt-12 md:pt-16 pb-4 text-center px-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-th-accent-bg border border-th-accent-border rounded-full text-xs font-medium text-th-accent-text mb-4">
          <span className="w-1.5 h-1.5 rounded-full bg-th-accent animate-pulse" />
          AI-Powered Strategy Testing
        </div>
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-th-text tracking-tight">
          Backtest AI Tool
        </h1>
        <p className="mt-3 text-base sm:text-lg text-th-text-3 max-w-lg mx-auto leading-relaxed">
          Test any stock market strategy using plain English.
          <br className="hidden sm:block" />
          <span className="sm:hidden"> </span>
          See how it would have performed over the last 10 years.
        </p>
      </header>

      {/* Main input section */}
      <main className="px-4 sm:px-6 py-6 sm:py-8">
        {freeRunsExhausted ? (
          <div className="max-w-3xl mx-auto mb-8">
            <div className="bg-th-surface border border-th-border rounded-2xl p-6 sm:p-8 text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-th-accent-bg flex items-center justify-center">
                <svg className="w-6 h-6 text-th-accent" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-th-text">You&apos;ve used your free backtest</h2>
              <p className="text-sm text-th-text-3 mt-2 max-w-md mx-auto">
                Create a free account to run unlimited backtests, save strategies to the leaderboard, and access all features.
              </p>
              <div className="flex items-center justify-center gap-3 mt-5">
                <SignUpButton mode="modal" forceRedirectUrl={typeof window !== "undefined" ? window.location.href : "/"}>
                  <button className="px-6 py-2.5 text-sm font-medium text-white bg-th-accent rounded-xl hover:bg-th-accent-hover transition-colors">
                    Sign Up Free
                  </button>
                </SignUpButton>
                <SignInButton mode="modal" forceRedirectUrl={typeof window !== "undefined" ? window.location.href : "/"}>
                  <button className="px-6 py-2.5 text-sm font-medium text-th-text-2 bg-th-inset border border-th-border rounded-xl hover:bg-th-hover transition-colors">
                    Sign In
                  </button>
                </SignInButton>
              </div>
            </div>
          </div>
        ) : (
          <BacktestInput
            onSubmit={runBacktest}
            isLoading={isLoading}
            parsingMethod={parsingMethod}
            dataSource={dataSource}
            stockUniverseSize={stockUniverseSize}
            warnings={warnings}
            stockSourceError={stockSourceError}
          />
        )}

        {/* Error message */}
        {error && (
          <div className="max-w-3xl mx-auto mt-8">
            <div className="bg-th-warning-bg border border-th-warning-border rounded-2xl px-6 py-4 text-center">
              <p className="text-th-warning-text font-medium">{error}</p>
              <p className="text-th-warning text-sm mt-1">
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
            isGuest={isGuest}
          />
        )}

        {/* Leaderboard */}
        <Leaderboard
          onSelectStrategy={handleSelectStrategy}
          refreshKey={leaderboardKey}
          activeTab={leaderboardTab}
        />

        {/* Footer */}
        <footer className="max-w-3xl mx-auto mt-20 pb-12 text-center">
          <p className="text-xs text-th-text-4">
            For educational purposes only. Not financial advice. Past performance
            does not guarantee future results
            <a href="/admin/stocks" className="text-th-text-4 hover:text-th-text-3 transition-colors">.</a>
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
