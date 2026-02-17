"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ResearchSearch() {
  const router = useRouter();
  const [ticker, setTicker] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = ticker.trim().toUpperCase();
    if (cleaned && /^[A-Z]{1,5}$/.test(cleaned)) {
      router.push(`/research/${cleaned}`);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50/50 px-6 py-16">
      <div className="max-w-2xl mx-auto text-center">
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Equity Research</h1>
        <p className="mt-2 text-gray-400 max-w-lg mx-auto">
          Get an AI-powered research report for any stock. Includes fundamentals analysis,
          price targets, risk factors, and buy/hold/sell recommendations.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 flex items-center gap-3 max-w-md mx-auto">
          <input
            type="text"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5))}
            placeholder="Enter ticker (e.g. AAPL)"
            className="flex-1 px-4 py-3 text-base font-medium bg-white border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 transition-all uppercase tracking-wider"
            maxLength={5}
          />
          <button
            type="submit"
            disabled={!ticker.trim() || !/^[A-Z]{1,5}$/.test(ticker.trim())}
            className="px-6 py-3 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Analyze
          </button>
        </form>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
          <span className="text-xs text-gray-300">Popular:</span>
          {["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "TSLA", "META", "JPM"].map((t) => (
            <button
              key={t}
              onClick={() => router.push(`/research/${t}`)}
              className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:text-blue-600 transition-colors"
            >
              {t}
            </button>
          ))}
        </div>

        {/* Methodology note */}
        <div className="mt-12 max-w-lg mx-auto flex items-start gap-2 text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
          </svg>
          <span>
            Reports are AI-generated using current financial data. Not financial advice. Always do your own research before making investment decisions.
          </span>
        </div>
      </div>
    </div>
  );
}
