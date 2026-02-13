"use client";

import { useState, useEffect, useCallback } from "react";
import { LeaderboardEntry } from "@/lib/types";

type SortField = "return10yr" | "return20yr" | "return5yr" | "return1yr";

interface LeaderboardProps {
  onSelectStrategy: (description: string) => void;
  refreshKey: number; // increment to trigger refresh
}

export default function Leaderboard({ onSelectStrategy, refreshKey }: LeaderboardProps) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [sortField, setSortField] = useState<SortField>("return10yr");
  const [loading, setLoading] = useState(true);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch("/api/leaderboard");
      const data = await res.json();
      setEntries(data);
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
          ? "text-blue-600"
          : "text-gray-400 hover:text-gray-600"
      }`}
    >
      {label}
      {sortField === field && " \u2193"}
    </button>
  );

  if (loading) {
    return (
      <div className="w-full max-w-3xl mx-auto mt-16">
        <div className="h-8 w-48 bg-gray-100 rounded animate-pulse mb-6" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-gray-50 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (entries.length === 0) return null;

  return (
    <div className="w-full max-w-3xl mx-auto mt-20">
      <h2 className="text-2xl font-bold text-gray-900 mb-2">
        Top Performing Strategies
      </h2>
      <p className="text-gray-400 mb-6">
        Click any strategy to test it yourself
      </p>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-12 gap-2 px-6 py-3 border-b border-gray-100 items-center">
          <div className="col-span-6 md:col-span-5 text-xs font-medium text-gray-400 uppercase tracking-wider">
            Strategy
          </div>
          <div className="col-span-2 text-right hidden md:block">
            <SortHeader field="return20yr" label="20yr" />
          </div>
          <div className="col-span-2 text-right">
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
            className="w-full grid grid-cols-12 gap-2 px-6 py-4 hover:bg-gray-50 transition-colors text-left border-b border-gray-50 last:border-0 items-center"
          >
            <div className="col-span-6 md:col-span-5">
              <div className="flex items-start gap-3">
                <span className="text-sm font-medium text-gray-300 w-5 mt-0.5 flex-shrink-0">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">
                    {entry.name}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">
                    {entry.description}
                  </p>
                </div>
              </div>
            </div>
            <div className="col-span-2 text-right hidden md:block">
              <span
                className={`text-sm font-semibold ${
                  (entry.return20yr ?? 0) >= 0 ? "text-emerald-600" : "text-red-500"
                }`}
              >
                {(entry.return20yr ?? 0) >= 0 ? "+" : ""}
                {(entry.return20yr ?? 0).toFixed(1)}%
              </span>
            </div>
            <div className="col-span-2 text-right">
              <span
                className={`text-sm font-semibold ${
                  entry.return10yr >= 0 ? "text-emerald-600" : "text-red-500"
                }`}
              >
                {entry.return10yr >= 0 ? "+" : ""}
                {entry.return10yr.toFixed(1)}%
              </span>
            </div>
            <div className="col-span-2 text-right">
              <span
                className={`text-sm font-semibold ${
                  entry.return5yr >= 0 ? "text-emerald-600" : "text-red-500"
                }`}
              >
                {entry.return5yr >= 0 ? "+" : ""}
                {entry.return5yr.toFixed(1)}%
              </span>
            </div>
            <div className="col-span-2 md:col-span-1 text-right">
              <span
                className={`text-sm font-semibold ${
                  entry.return1yr >= 0 ? "text-emerald-600" : "text-red-500"
                }`}
              >
                {entry.return1yr >= 0 ? "+" : ""}
                {entry.return1yr.toFixed(1)}%
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
