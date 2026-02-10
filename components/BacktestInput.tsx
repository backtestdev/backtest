"use client";

import { useState } from "react";
import StrategyChips from "./StrategyChips";

interface BacktestInputProps {
  onSubmit: (strategy: string) => void;
  isLoading: boolean;
}

export default function BacktestInput({ onSubmit, isLoading }: BacktestInputProps) {
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
    </div>
  );
}
