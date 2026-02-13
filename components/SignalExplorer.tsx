"use client";

import { useState, useEffect } from "react";

interface Quintile {
  quintile: number;
  avgReturn: number;
  stockCount: number;
}

interface Signal {
  metric: string;
  label: string;
  quintiles: Quintile[];
  spread: number;
  direction: "higher_better" | "lower_better";
  yearsOfData: number;
  type: "static";
}

interface SignalData {
  signals: Signal[];
  stockCount: number;
  yearsAnalyzed: number;
  methodology: string;
}

export default function SignalExplorer() {
  const [data, setData] = useState<SignalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSignal, setExpandedSignal] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSignals() {
      try {
        const res = await fetch("/api/signals");
        if (!res.ok) throw new Error("Failed to fetch");
        const json = await res.json();
        setData(json);
      } catch {
        setError("Failed to load signal data. Make sure the database is populated.");
      } finally {
        setLoading(false);
      }
    }
    fetchSignals();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50/50 px-6 py-16">
        <div className="max-w-4xl mx-auto">
          <div className="h-10 w-64 bg-gray-100 rounded-lg animate-pulse mb-4" />
          <div className="h-5 w-96 bg-gray-100 rounded animate-pulse mb-8" />
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-20 bg-white rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50/50 px-6 py-16">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-gray-500">{error || "No data available"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/50 px-6 py-12">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Signal Explorer</h1>
        <p className="mt-2 text-gray-400 max-w-2xl">
          Which metrics predict stock outperformance? We split {data.stockCount.toLocaleString()} stocks
          into quintiles by each metric and compare their average annual returns over {data.yearsAnalyzed} years.
        </p>

        {/* Methodology note */}
        <div className="mt-4 mb-8 flex items-start gap-2 text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 max-w-2xl">
          <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
          </svg>
          <span>
            <strong>Static analysis:</strong> Stocks are screened on today&apos;s metric values, then historical returns are measured.
            This is not point-in-time — a stock&apos;s P/E today may differ from its P/E 10 years ago. Treat as directional, not definitive.
          </span>
        </div>

        {/* Signal table header */}
        <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs font-medium text-gray-400 uppercase tracking-wider">
          <div className="col-span-1">#</div>
          <div className="col-span-3">Metric</div>
          <div className="col-span-6">Quintile Returns (Q1=Low, Q5=High)</div>
          <div className="col-span-2 text-right">Spread</div>
        </div>

        {/* Signal rows */}
        <div className="space-y-2">
          {data.signals.map((signal, index) => {
            const isExpanded = expandedSignal === signal.metric;
            const maxReturn = Math.max(...signal.quintiles.map((q) => q.avgReturn));
            const minReturn = Math.min(...signal.quintiles.map((q) => q.avgReturn));
            const range = maxReturn - minReturn || 1;

            return (
              <div key={signal.metric}>
                <button
                  onClick={() => setExpandedSignal(isExpanded ? null : signal.metric)}
                  className="w-full grid grid-cols-12 gap-2 items-center px-4 py-3 bg-white rounded-xl border border-gray-100 hover:border-gray-200 transition-colors text-left cursor-pointer"
                >
                  <div className="col-span-1">
                    <span className="text-sm font-medium text-gray-300">{index + 1}</span>
                  </div>
                  <div className="col-span-3">
                    <p className="text-sm font-semibold text-gray-900">{signal.label}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
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
                            <span className="text-[9px] text-gray-400">
                              {(q.avgReturn * 100).toFixed(1)}%
                            </span>
                            <div
                              className={`w-full rounded-sm transition-all ${
                                isWinner ? "bg-emerald-400" : "bg-gray-200"
                              }`}
                              style={{ height: `${height}%`, minHeight: "4px" }}
                            />
                            <span className="text-[9px] text-gray-300">Q{q.quintile}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="col-span-2 text-right">
                    <span className={`text-sm font-bold ${
                      signal.spread > 0.05 ? "text-emerald-600" : signal.spread > 0.02 ? "text-blue-600" : "text-gray-400"
                    }`}>
                      {(signal.spread * 100).toFixed(1)}%
                    </span>
                    <p className="text-[9px] text-gray-300">per year</p>
                  </div>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="mt-1 mx-4 mb-2 bg-gray-50 rounded-lg p-4">
                    <div className="grid grid-cols-5 gap-3">
                      {signal.quintiles.map((q) => {
                        const isWinner = signal.direction === "higher_better"
                          ? q.quintile === 5
                          : q.quintile === 1;
                        return (
                          <div
                            key={q.quintile}
                            className={`text-center p-3 rounded-lg ${
                              isWinner ? "bg-emerald-50 border border-emerald-200" : "bg-white border border-gray-100"
                            }`}
                          >
                            <p className="text-xs font-medium text-gray-400">
                              Quintile {q.quintile}
                            </p>
                            <p className="text-[10px] text-gray-300">
                              {q.quintile === 1 ? "(lowest)" : q.quintile === 5 ? "(highest)" : ""}
                            </p>
                            <p className={`text-lg font-bold mt-1 ${
                              q.avgReturn >= 0 ? "text-emerald-600" : "text-red-500"
                            }`}>
                              {(q.avgReturn * 100).toFixed(1)}%
                            </p>
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              avg/yr
                            </p>
                            <p className="text-[10px] text-gray-300 mt-1">
                              {q.stockCount} stocks
                            </p>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-xs text-gray-400 mt-3 text-center">
                      Stocks with {signal.direction === "lower_better" ? "lower" : "higher"} {signal.label} values
                      have historically returned {(signal.spread * 100).toFixed(1)}% more per year on average.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {data.signals.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            No signals found. Make sure the database is populated with stock data and annual returns.
          </div>
        )}
      </div>
    </div>
  );
}
