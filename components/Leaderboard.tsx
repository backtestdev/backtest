"use client";

import { useState, useEffect, useCallback } from "react";
import { useUser } from "@clerk/nextjs";
import { LeaderboardEntry } from "@/lib/types";

type SortField = "return10yr" | "return20yr" | "return5yr" | "return1yr";
type TabScope = "public" | "personal";

interface Benchmarks {
  return1yr: number;
  return5yr: number;
  return10yr: number;
  return20yr: number;
}

interface LeaderboardProps {
  onSelectStrategy: (description: string) => void;
  refreshKey: number;
  activeTab?: TabScope;
}

function returnColor(value: number, benchmark: number): string {
  if (value < 0) return "text-th-negative";
  if (value < benchmark) return "text-th-warning";
  return "text-th-positive";
}

export default function Leaderboard({ onSelectStrategy, refreshKey, activeTab: externalTab }: LeaderboardProps) {
  const { isSignedIn, user } = useUser();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [personalEntries, setPersonalEntries] = useState<LeaderboardEntry[]>([]);
  const [benchmarks, setBenchmarks] = useState<Benchmarks>({ return1yr: 0, return5yr: 0, return10yr: 0, return20yr: 0 });
  const [sortField, setSortField] = useState<SortField>("return10yr");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabScope>(externalTab || "public");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Sync external tab changes (e.g. after saving a strategy)
  useEffect(() => {
    if (externalTab) setTab(externalTab);
  }, [externalTab]);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch("/api/leaderboard");
      const data = await res.json();
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

  const fetchPersonal = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await fetch(`/api/leaderboard?scope=personal&userId=${user.id}`);
      const data = await res.json();
      setPersonalEntries(data.entries || []);
    } catch {
      console.error("Failed to fetch personal strategies");
    }
  }, [user?.id]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard, refreshKey]);

  useEffect(() => {
    if (isSignedIn && user?.id) fetchPersonal();
  }, [isSignedIn, user?.id, fetchPersonal, refreshKey]);

  const handleDelete = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(id);
    try {
      const res = await fetch(`/api/leaderboard?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setPersonalEntries(prev => {
          const updated = prev.filter(entry => entry.id !== id);
          // Auto-switch to top strategies when personal list becomes empty
          if (updated.length === 0) setTab("public");
          return updated;
        });
        setEntries(prev => prev.filter(entry => entry.id !== id));
      }
    } catch { /* ignore */ }
    setDeletingId(null);
  }, []);

  const activeEntries = tab === "personal" ? personalEntries : entries;
  const sorted = [...activeEntries].sort((a, b) => (b[sortField] ?? 0) - (a[sortField] ?? 0));

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

  if (entries.length === 0 && personalEntries.length === 0) return null;

  return (
    <div className="w-full max-w-3xl mx-auto mt-12 sm:mt-20">
      <h2 className="text-xl sm:text-2xl font-bold text-th-text mb-2">
        {tab === "personal" ? "My Strategies" : "Top Strategies"}
      </h2>
      <p className="text-sm sm:text-base text-th-text-3 mb-4">
        {tab === "personal"
          ? "Your saved backtest strategies"
          : "Click any strategy to test it yourself"
        }
      </p>

      {/* Tabs */}
      {isSignedIn && (
        <div className="flex gap-1 mb-4 bg-th-inset rounded-lg p-1 w-fit">
          <button
            onClick={() => setTab("public")}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              tab === "public"
                ? "bg-th-surface text-th-text shadow-sm"
                : "text-th-text-3 hover:text-th-text-2"
            }`}
          >
            Top Strategies
          </button>
          <button
            onClick={() => setTab("personal")}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              tab === "personal"
                ? "bg-th-surface text-th-text shadow-sm"
                : "text-th-text-3 hover:text-th-text-2"
            }`}
          >
            My Strategies
            {personalEntries.length > 0 && (
              <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-th-accent-bg text-th-accent">
                {personalEntries.length}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Empty personal state */}
      {tab === "personal" && personalEntries.length === 0 && (
        <div className="bg-th-surface rounded-2xl border border-th-border-light p-8 text-center">
          <p className="text-sm text-th-text-3">No saved strategies yet.</p>
          <p className="text-xs text-th-text-4 mt-1">Run a backtest and save it to see it here.</p>
        </div>
      )}

      {/* Table */}
      {sorted.length > 0 && (
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
              <div
                key={entry.id}
                className="group/row w-full grid grid-cols-12 gap-2 px-4 sm:px-6 py-3 sm:py-4 hover:bg-th-hover transition-colors text-left border-b border-th-border-light last:border-0 items-center min-h-[44px] cursor-pointer"
                onClick={() => onSelectStrategy(entry.description)}
              >
                <div className="col-span-5">
                  <div className="flex items-start gap-2 sm:gap-3">
                    <span className="text-sm font-medium text-th-text-4 w-5 mt-0.5 flex-shrink-0">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold text-th-text truncate sm:whitespace-normal">
                          {entry.name}
                        </p>
                        {entry.is_public === false && (
                          <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-th-inset text-th-text-4 whitespace-nowrap">
                            Private
                          </span>
                        )}
                        {tab === "personal" && (
                          <button
                            onClick={(e) => handleDelete(entry.id, e)}
                            disabled={deletingId === entry.id}
                            className="ml-auto flex-shrink-0 p-1 text-th-text-4 opacity-0 group-hover/row:opacity-100 hover:text-th-negative transition-all rounded-md hover:bg-th-negative-bg"
                            title="Delete strategy"
                          >
                            {deletingId === entry.id ? (
                              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                            ) : (
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                              </svg>
                            )}
                          </button>
                        )}
                      </div>
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
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
