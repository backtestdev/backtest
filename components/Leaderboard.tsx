"use client";

import { useState, useEffect, useCallback } from "react";
import { LeaderboardEntry } from "@/lib/types";

type SortField = "return10yr" | "return20yr" | "return5yr" | "return1yr";

interface Benchmarks {
  return1yr: number;
  return5yr: number;
  return10yr: number;
  return20yr: number;
}

interface LeaderboardProps {
  onSelectStrategy: (description: string) => void;
  refreshKey: number; // increment to trigger refresh
}

function returnColor(value: number, benchmark: number): string {
  if (value < 0) return "text-th-negative";
  if (value < benchmark) return "text-th-warning";
  return "text-th-positive";
}

export default function Leaderboard({ onSelectStrategy, refreshKey }: LeaderboardProps) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [benchmarks, setBenchmarks] = useState<Benchmarks>({ return1yr: 0, return5yr: 0, return10yr: 0, return20yr: 0 });
  const [sortField, setSortField] = useState<SortField>("return10yr");
  const [loading, setLoading] = useState(true);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch("/api/leaderboard");
      const data = await res.json();
      // Support both old array format and new {entries, benchmarks} format
      if (Array.isArray(data)) {
        setEntries(data);
      } else {
        setEntries(data.entries || []);
        if (data.benchmarks) setBenchmarks(data.benchmarks);
      }
    } catch {
      console.error("Failed to fetch leaderboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard, refreshKey]);

  const sorted = [...entries].sort((a, b) => (b[sortField] ?? 0) - (a[sortField] ?? 0));

  const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
    <button
      onClick={() => setSortField(field)}
      className={`text-right font-medium text-xs uppercase tracking-wider transition-colors ${
        sortField === field
          ? "text-th-accent"
          : "text-th-text-3 hover:text-th-text-2"
      }`}
    >
      {label}
      {sortField === field && " \u2193"}
    </button>
  );

  if (loading) {
    return (
      <div className="w-full max-w-3xl mx-auto mt-16">
        <div className="h-8 w-48 bg-th-skeleton rounded animate-pulse mb-6" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-th-inset rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (entries.length === 0) return null;

  return (
    <div className="w-full max-w-3xl mx-auto mt-12 sm:mt-20">
      <h2 className="text-xl sm:text-2xl font-bold text-th-text mb-2">
        Top Performing Strategies
      </h2>
      <p className="text-sm sm:text-base text-th-text-3 mb-6">
        Click any strategy to test it yourself
      </p>

      {/* Table */}
      <div className="bg-th-surface rounded-2xl border border-th-border-light overflow-x-auto shadow-sm">
        <div className="min-w-[480px]">
          {/* Header */}
          <div className="grid grid-cols-12 gap-2 px-4 sm:px-6 py-3 border-b border-th-border-light items-center">
            <div className="col-span-5 text-xs font-medium text-th-text-3 uppercase tracking-wider">
              Strategy
            </div>
            <div className="col-span-2 text-right hidden md:block">
              <SortHeader field="return20yr" label="20yr" />
            </div>
            <div className="col-span-3 md:col-span-2 text-right">
              <SortHeader field="return10yr" label="10yr" />
            </div>
            <div className="col-span-2 text-right">
              <SortHeader field="return5yr" label="5yr" />
            </div>
            <div className="col-span-2 md:col-span-1 text-right">
              <SortHeader field="return1yr" label="1yr" />
            </div>
          </div>

          {/* Rows */}
          {sorted.map((entry, index) => (
            <button
              key={entry.id}
              onClick={() => onSelectStrategy(entry.description)}
              className="w-full grid grid-cols-12 gap-2 px-4 sm:px-6 py-3 sm:py-4 hover:bg-th-hover transition-colors text-left border-b border-th-border-light last:border-0 items-center min-h-[44px]"
            >
              <div className="col-span-5">
                <div className="flex items-start gap-2 sm:gap-3">
                  <span className="text-sm font-medium text-th-text-4 w-5 mt-0.5 flex-shrink-0">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-th-text truncate sm:whitespace-normal">
                      {entry.name}
                    </p>
                    <p className="text-xs text-th-text-3 mt-0.5 line-clamp-2 hidden sm:block">
                      {entry.description}
                    </p>
                  </div>
                </div>
              </div>
              <div className="col-span-2 text-right hidden md:block">
                <span
                  className={`text-sm font-semibold ${returnColor(entry.return20yr ?? 0, benchmarks.return20yr)}`}
                >
                  {(entry.return20yr ?? 0) >= 0 ? "+" : ""}
                  {(entry.return20yr ?? 0).toFixed(1)}%
                </span>
              </div>
              <div className="col-span-3 md:col-span-2 text-right">
                <span
                  className={`text-sm font-semibold ${returnColor(entry.return10yr, benchmarks.return10yr)}`}
                >
                  {entry.return10yr >= 0 ? "+" : ""}
                  {entry.return10yr.toFixed(1)}%
                </span>
              </div>
              <div className="col-span-2 text-right">
                <span
                  className={`text-sm font-semibold ${returnColor(entry.return5yr, benchmarks.return5yr)}`}
                >
                  {entry.return5yr >= 0 ? "+" : ""}
                  {entry.return5yr.toFixed(1)}%
                </span>
              </div>
              <div className="col-span-2 md:col-span-1 text-right">
                <span
                  className={`text-sm font-semibold ${returnColor(entry.return1yr, benchmarks.return1yr)}`}
                >
                  {entry.return1yr >= 0 ? "+" : ""}
                  {entry.return1yr.toFixed(1)}%
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
