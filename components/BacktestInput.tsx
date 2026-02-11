"use client";

import { useState } from "react";
import StrategyChips from "./StrategyChips";
import { ParsingMethod } from "@/lib/types";

interface BacktestInputProps {
  onSubmit: (strategy: string) => void;
  isLoading: boolean;
  parsingMethod?: ParsingMethod;
  dataSource?: "fmp";
  stockUniverseSize?: number;
  warnings?: string[];
  stockSourceError?: string;
}

function ParsingBadge({ method }: { method: ParsingMethod }) {
  switch (method) {
    case "ai":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          Parsed with AI
        </span>
      );
    case "fallback":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-amber-50 text-amber-700 border border-amber-200">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          Using rule-based parsing
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-red-50 text-red-700 border border-red-200">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
          Parsing failed - showing all stocks
        </span>
      );
    default:
      return null;
  }
}

function DataSourceBadge({ count }: { count?: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-blue-50 text-blue-700 border border-blue-200">
      <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
      Live data{count ? ` (${count.toLocaleString()} stocks)` : ""}
    </span>
  );
}

export default function BacktestInput({ onSubmit, isLoading, parsingMethod, dataSource, stockUniverseSize, warnings, stockSourceError }: BacktestInputProps) {
  const [strategy, setStrategy] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (strategy.trim() && !isLoading) {
      onSubmit(strategy.trim());
    }
  };

  const handleChipSelect = (query: string) => {
    setStrategy(query);
  };

  return (
    <div className="w-full max-w-3xl mx-auto">
      {/* Example strategies */}
      <div className="mb-6">
        <p className="text-sm text-gray-400 text-center mb-3">
          Try an example strategy
        </p>
        <StrategyChips onSelect={handleChipSelect} />
      </div>

      {/* Main input */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="relative">
          <textarea
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            placeholder="Describe your investment strategy in plain English... e.g., &quot;Buy stocks with 5+ consecutive quarters of revenue growth and P/E ratio under 15&quot;"
            className="w-full h-32 px-6 py-4 text-lg text-gray-900 bg-white border-2 border-gray-200 rounded-2xl resize-none focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 transition-all duration-200 placeholder:text-gray-300"
            disabled={isLoading}
          />
        </div>

        <button
          type="submit"
          disabled={!strategy.trim() || isLoading}
          className="w-full py-4 px-8 text-lg font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-3"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Running Backtest...
            </>
          ) : (
            "Backtest Strategy"
          )}
        </button>
      </form>

      {/* Status badges - shown after results */}
      {parsingMethod && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <ParsingBadge method={parsingMethod} />
          {dataSource && <DataSourceBadge count={stockUniverseSize} />}
        </div>
      )}

      {/* Warnings */}
      {warnings && warnings.length > 0 && parsingMethod === "fallback" && (
        <div className="mt-3 max-w-2xl mx-auto">
          <details className="text-xs text-amber-600">
            <summary className="cursor-pointer hover:text-amber-700">View parsing details</summary>
            <ul className="mt-1 space-y-0.5 pl-4 list-disc">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {/* Stock source error (FMP unavailable) */}
      {stockSourceError && (
        <div className="mt-3 max-w-2xl mx-auto">
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
            <strong>Stock data unavailable:</strong> {stockSourceError}
          </div>
        </div>
      )}
    </div>
  );
}
