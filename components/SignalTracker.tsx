"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useUser, SignUpButton } from "@clerk/nextjs";
import { useSubscription } from "./SubscriptionProvider";


import StockLogo from "./StockLogo";

// --- Types ---

interface Pick {
  id: string;
  symbol: string;
  companyName: string;
  sector: string;
  marketCap: number;
  entryScore: number;
  currentScore: number | null;
  sellScore: number | null;
  thesis: string;
  pickDate: string;
  entryPrice: number;
  currentPrice: number | null;
  returnPct: number | null;
  positionSize: number;
  portfolioPct: number;
  profitLoss: number | null;
  holdDays: number;
  status: string;
  sellDate: string | null;
  sellPrice: number | null;
  sellReason: string | null;
}

interface PerformancePoint {
  date: string;
  portfolioValue: number;
  benchmarkValue: number;
}

interface Stats {
  totalReturn: number;
  benchmarkReturn: number;
  alpha: number;
  activePicks: number;
  totalPicks: number;
  inceptionDate: string;
  totalInvested: number;
  cashReserve: number;
  investedPct: number;
  avgHoldDays: number;
}

// --- Formatters ---

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatShortDate(dateStr: string): string {
  const parts = dateStr.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(parts[1], 10) - 1]} '${parts[0].slice(2)}`;
}

function formatCurrency(val: number): string {
  return val.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDollarWhole(val: number): string {
  return val.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatMarketCap(b: number): string {
  if (b >= 1000) return `$${(b / 1000).toFixed(1)}T`;
  if (b >= 1) return `$${b.toFixed(1)}B`;
  return `$${(b * 1000).toFixed(0)}M`;
}

function formatHoldTime(days: number): string {
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  const remaining = days % 30;
  if (months < 12) return remaining > 14 ? `${months}mo ${remaining}d` : `${months}mo`;
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  return remMonths > 0 ? `${years}y ${remMonths}mo` : `${years}y`;
}

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  return `${Math.floor(diffMonths / 12)}y ago`;
}

// --- Main Component ---

export default function SignalTracker() {
  const { isSignedIn } = useUser();
  const { isPremium } = useSubscription();
  const [picks, setPicks] = useState<Pick[]>([]);
  const [performance, setPerformance] = useState<PerformancePoint[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [fundValue, setFundValue] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPick, setExpandedPick] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "sold">("all");

  useEffect(() => {
    fetch("/api/signal-tracker")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setPicks(data.picks || []);
        setPerformance(data.performance || []);
        setStats(data.stats || null);
        setFundValue(data.fundValue ?? null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-th-bg px-4 sm:px-6 py-8 sm:py-12">
        <div className="max-w-5xl mx-auto">
          <div className="h-8 w-64 bg-th-bar rounded animate-pulse mb-2" />
          <div className="h-4 w-96 bg-th-skeleton rounded animate-pulse mb-8" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 bg-th-surface rounded-xl animate-pulse border border-th-border-light" />
            ))}
          </div>
          <div className="h-64 bg-th-surface rounded-2xl animate-pulse border border-th-border-light mb-6" />
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-24 bg-th-surface rounded-xl animate-pulse border border-th-border-light" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-th-bg px-4 sm:px-6 py-8 sm:py-12">
        <div className="max-w-5xl mx-auto">
          <div className="bg-th-surface rounded-2xl border border-th-negative-border p-6 sm:p-8 text-center">
            <p className="text-th-negative font-medium">{error}</p>
            <p className="text-sm text-th-text-3 mt-2">Check that the database is configured and stock data is populated.</p>
          </div>
        </div>
      </div>
    );
  }

  const activePicks = picks.filter((p) => p.status === "active");
  const soldPicks = picks.filter((p) => p.status === "sold");
  const filteredPicks = filter === "all" ? picks : filter === "active" ? activePicks : soldPicks;

  // Most recent active pick = premium sample for free users
  const mostRecentActivePick = activePicks.length > 0
    ? activePicks.reduce((latest, p) => p.pickDate > latest.pickDate ? p : latest, activePicks[0])
    : null;

  const getPickVisibility = (pick: Pick): "visible" | "login" | "upgrade" => {
    if (pick.status === "sold") return "visible";
    if (!isSignedIn) return "login";
    if (isPremium) return "visible";
    if (mostRecentActivePick && pick.id === mostRecentActivePick.id) return "visible";
    return "upgrade";
  };

  return (
    <div className="min-h-screen bg-th-bg px-4 sm:px-6 py-8 sm:py-12">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-th-text">Quant Fund</h1>
          <p className="text-sm text-th-text-3 mt-1">
            Proprietary AI-driven stock picks powered by our multi-factor scoring model.
            Tracked live with real entry & exit prices since July 2025.
          </p>
        </div>

        {/* Stats Cards - always visible */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatCard label="Fund Value" value={fundValue != null ? formatDollarWhole(fundValue) : "\u2014"} color="neutral" />
            <StatCard label="Fund Return" value={`${stats.totalReturn >= 0 ? "+" : ""}${stats.totalReturn.toFixed(1)}%`} color={stats.totalReturn >= 0 ? "positive" : "negative"} />
            <StatCard label="S&P 500" value={`${stats.benchmarkReturn >= 0 ? "+" : ""}${stats.benchmarkReturn.toFixed(1)}%`} color="neutral" />
            <StatCard label="Alpha" value={`${stats.alpha >= 0 ? "+" : ""}${stats.alpha.toFixed(1)}%`} color={stats.alpha >= 0 ? "positive" : "negative"} />
          </div>
        )}

        {/* Performance Chart - always visible */}
        {performance.length > 2 && (
          <div className="bg-th-surface rounded-2xl border border-th-border-light p-4 sm:p-6 mb-6 shadow-sm">
            <h2 className="text-sm font-semibold text-th-text mb-4">Fund Performance vs S&P 500</h2>
            <PerformanceChart data={performance} />
            <div className="flex items-center justify-center gap-6 mt-3">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-0.5 bg-th-accent rounded-full" />
                <span className="text-[11px] text-th-text-3">Signal Fund</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-0.5 rounded-full" style={{ background: "var(--text-4)" }} />
                <span className="text-[11px] text-th-text-3">S&P 500</span>
              </div>
            </div>
            <p className="text-[10px] text-th-text-4 text-center mt-3">
              Score-weighted portfolio with monthly rebalancing. Higher-scoring picks receive larger allocations.
            </p>
          </div>
        )}

        {/* Picks Section */}
        <div className="bg-th-surface rounded-2xl border border-th-border-light p-4 sm:p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-th-text">Stock Picks</h2>
            <div className="flex items-center gap-1">
              {(["all", "active", "sold"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors capitalize ${
                    filter === f
                      ? "bg-th-nav-active text-white"
                      : "text-th-text-3 hover:text-th-text-2 hover:bg-th-hover"
                  }`}
                >
                  {f} {f === "active" ? `(${activePicks.length})` :
                       f === "sold" ? `(${soldPicks.length})` :
                       `(${picks.length})`}
                </button>
              ))}
            </div>
          </div>

          {filteredPicks.length === 0 ? (
            <p className="text-sm text-th-text-3 text-center py-8">No picks to display.</p>
          ) : (
            <div className="space-y-2">
              {(() => {
                // Build visible picks and a single CTA based on auth/tier
                const visiblePicks: Pick[] = [];
                let hiddenActiveCount = 0;

                filteredPicks.forEach((pick) => {
                  const vis = getPickVisibility(pick);
                  if (vis === "visible") {
                    visiblePicks.push(pick);
                  } else {
                    hiddenActiveCount++;
                  }
                });

                const isFreeUser = isSignedIn && !isPremium;
                const isGuest = !isSignedIn;

                return (
                  <>
                    {/* Show the sample pick with badge for free users */}
                    {visiblePicks.map((pick) => {
                      const isSample = isFreeUser && pick.status === "active" && mostRecentActivePick?.id === pick.id;
                      return (
                        <div key={pick.id} className="relative">
                          {isSample && (
                            <div className="absolute -top-2 right-3 z-20">
                              <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-th-accent text-white rounded-full shadow-sm">
                                Premium Sample
                              </span>
                            </div>
                          )}
                          <PickCard
                            pick={pick}
                            expanded={expandedPick === pick.id}
                            onToggle={() => setExpandedPick(expandedPick === pick.id ? null : pick.id)}
                          />
                        </div>
                      );
                    })}

                    {/* Single CTA for hidden active picks */}
                    {hiddenActiveCount > 0 && isFreeUser && (
                      <div className="flex items-center justify-between bg-th-accent-bg rounded-xl border border-th-accent-border px-5 py-4">
                        <div>
                          <p className="text-sm font-semibold text-th-text">
                            {hiddenActiveCount} more active signal{hiddenActiveCount > 1 ? "s" : ""} available
                          </p>
                          <p className="text-xs text-th-text-3 mt-0.5">Upgrade to Premium for all signals with live scoring</p>
                        </div>
                        <Link href="/app/pricing" className="px-4 py-1.5 bg-th-accent text-white text-xs font-semibold rounded-lg hover:opacity-90 transition-opacity flex-shrink-0">
                          Upgrade
                        </Link>
                      </div>
                    )}

                    {hiddenActiveCount > 0 && isGuest && (
                      <div className="flex items-center justify-between bg-th-surface rounded-xl border border-th-accent-border px-5 py-4">
                        <div>
                          <p className="text-sm font-semibold text-th-text">
                            {hiddenActiveCount} active signal{hiddenActiveCount > 1 ? "s" : ""} hidden
                          </p>
                          <p className="text-xs text-th-text-3 mt-0.5">Create a free account to see a preview of active stock picks</p>
                        </div>
                        <SignUpButton mode="modal">
                          <button className="px-4 py-1.5 bg-th-accent text-white text-xs font-semibold rounded-lg hover:opacity-90 transition-opacity flex-shrink-0">
                            Sign Up Free
                          </button>
                        </SignUpButton>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </div>

        {/* Fund allocation summary */}
        {stats && (
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-4 text-[11px] text-th-text-3">
            <span>Invested: {formatDollarWhole(stats.totalInvested)} ({stats.investedPct.toFixed(0)}%)</span>
            <span className="text-th-text-4">&middot;</span>
            <span>Cash Reserve: {formatDollarWhole(stats.cashReserve)}</span>
            <span className="text-th-text-4">&middot;</span>
            <span>{stats.activePicks} active / {stats.totalPicks} total picks</span>
            <span className="text-th-text-4">&middot;</span>
            <span>Avg Time Held: {formatHoldTime(stats.avgHoldDays)}</span>
          </div>
        )}

        <p className="text-[10px] text-th-text-4 text-center mt-3">
          Past performance does not guarantee future results. Not financial advice.
        </p>
      </div>
    </div>
  );
}

// --- Stat Card ---

function StatCard({ label, value, subtitle, color }: {
  label: string;
  value: string;
  subtitle?: string;
  color: "positive" | "negative" | "neutral";
}) {
  const valueColor = color === "positive" ? "text-th-positive"
    : color === "negative" ? "text-th-negative"
    : "text-th-text";

  return (
    <div className="p-3 rounded-xl bg-th-inset border border-th-border-light text-center">
      <p className="text-[10px] text-th-text-3 uppercase tracking-wider font-medium">{label}</p>
      <p className={`text-xl sm:text-2xl font-bold mt-1 ${valueColor}`}>{value}</p>
      {subtitle && <p className="text-[10px] text-th-text-4 mt-0.5">{subtitle}</p>}
    </div>
  );
}

// --- Score Badge ---

function ScoreBadge({ score, size = "sm" }: { score: number; size?: "sm" | "xs" }) {
  const colorClass = score >= 90 ? "bg-th-positive-bg text-th-positive-text"
    : score >= 80 ? "bg-th-warning-bg text-th-warning-text"
    : "bg-th-bar text-th-text-3";
  const sizeClass = size === "xs" ? "text-[9px] px-1 py-0.5" : "text-[10px] px-1.5 py-0.5";

  return (
    <span className={`inline-flex items-center gap-0.5 rounded font-bold ${colorClass} ${sizeClass}`}>
      <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 0 0 .95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 0 0-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 0 0-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 0 0-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 0 0 .951-.69l1.07-3.292Z" />
      </svg>
      {score}
    </span>
  );
}

// --- Pick Card ---

function PickCard({ pick, expanded, onToggle }: {
  pick: Pick;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isActive = pick.status === "active";
  const returnColor = pick.returnPct != null
    ? pick.returnPct >= 0 ? "text-th-positive" : "text-th-negative"
    : "text-th-text-3";
  const displayScore = isActive
    ? (pick.currentScore ?? pick.entryScore)
    : pick.entryScore;

  return (
    <div className={`rounded-xl border transition-colors ${
      isActive ? "border-th-border-light bg-th-inset" : "border-th-border-light bg-th-bg opacity-75"
    }`}>
      <div className="p-3 sm:p-4">
        <div className="flex items-center gap-3">
          <Link href={`/app/screener/${pick.symbol}`} className="flex-shrink-0">
            <StockLogo ticker={pick.symbol} sector={pick.sector || undefined} size="sm" />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Link href={`/app/screener/${pick.symbol}`} className="font-semibold text-th-text hover:text-th-accent transition-colors">
                {pick.symbol}
              </Link>
              <ScoreBadge score={displayScore} />
              {isActive && pick.portfolioPct > 0 && (
                <span className="text-[10px] font-medium text-th-text-3 bg-th-bar px-1.5 py-0.5 rounded">{pick.portfolioPct.toFixed(1)}% of fund</span>
              )}
              {!isActive && (
                <span className="text-[10px] font-medium text-th-negative bg-th-negative-bg px-1.5 py-0.5 rounded">Sold</span>
              )}
            </div>
            <p className="text-xs text-th-text-3 truncate">{pick.companyName}</p>
          </div>

          <div className="text-right flex-shrink-0 hidden sm:block">
            <p className={`text-sm font-bold ${returnColor}`}>
              {pick.returnPct != null ? `${pick.returnPct >= 0 ? "+" : ""}${pick.returnPct.toFixed(1)}%` : "\u2014"}
            </p>
            <p className="text-[11px] text-th-text-3 font-medium">{timeAgo(pick.pickDate)}</p>
            <p className="text-[10px] text-th-text-4">{formatDate(pick.pickDate)}</p>
          </div>

          <div className="text-right flex-shrink-0 sm:hidden">
            <p className={`text-sm font-bold ${returnColor}`}>
              {pick.returnPct != null ? `${pick.returnPct >= 0 ? "+" : ""}${pick.returnPct.toFixed(1)}%` : "\u2014"}
            </p>
            <p className="text-[10px] text-th-text-3 font-medium">{timeAgo(pick.pickDate)}</p>
          </div>

          <button onClick={onToggle} className="flex-shrink-0 p-1 text-th-text-3 hover:text-th-text transition-colors">
            <svg className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
        </div>

        {expanded && (
          <div className="mt-3 pt-3 border-t border-th-border-light">
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-th-text-4 uppercase">Signal Score</span>
                <ScoreBadge score={pick.entryScore} size="xs" />
              </div>
              {pick.currentScore != null && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-th-text-4 uppercase">Live Score</span>
                  <ScoreBadge score={pick.currentScore} size="xs" />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2 sm:gap-3 mb-3">
              <div>
                <p className="text-[10px] text-th-text-4 uppercase">Invested</p>
                <p className="text-xs sm:text-sm font-medium text-th-text">{formatCurrency(pick.positionSize)}</p>
              </div>
              <div>
                <p className="text-[10px] text-th-text-4 uppercase">% of Fund</p>
                <p className="text-xs sm:text-sm font-medium text-th-text">
                  {isActive ? `${pick.portfolioPct.toFixed(1)}%` : "\u2014"}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-th-text-4 uppercase">Entry</p>
                <p className="text-xs sm:text-sm font-medium text-th-text">{formatCurrency(pick.entryPrice)}</p>
              </div>
              <div>
                <p className="text-[10px] text-th-text-4 uppercase">{pick.status === "sold" ? "Sell" : "Current"}</p>
                <p className="text-xs sm:text-sm font-medium text-th-text">
                  {pick.status === "sold" && pick.sellPrice ? formatCurrency(pick.sellPrice)
                    : pick.currentPrice ? formatCurrency(pick.currentPrice)
                    : "\u2014"}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-th-text-4 uppercase">P&L</p>
                <p className={`text-xs sm:text-sm font-bold ${pick.profitLoss != null && pick.profitLoss >= 0 ? "text-th-positive" : "text-th-negative"}`}>
                  {pick.profitLoss != null
                    ? `${pick.profitLoss >= 0 ? "+" : ""}${formatCurrency(pick.profitLoss)}`
                    : "\u2014"}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-th-text-4 uppercase">Time Held</p>
                <p className="text-xs sm:text-sm font-medium text-th-text">{formatHoldTime(pick.holdDays)}</p>
              </div>
              <div>
                <p className="text-[10px] text-th-text-4 uppercase">Mkt Cap</p>
                <p className="text-xs sm:text-sm font-medium text-th-text">{formatMarketCap(pick.marketCap)}</p>
              </div>
              <div>
                <p className="text-[10px] text-th-text-4 uppercase">Signaled</p>
                <p className="text-xs sm:text-sm font-medium text-th-text">{formatDate(pick.pickDate)}</p>
              </div>
            </div>
            {pick.thesis && (
              <div className="p-3 rounded-lg bg-th-bg border border-th-border-light">
                <p className="text-[10px] font-semibold text-th-accent uppercase tracking-wider mb-1">Investment Thesis</p>
                <p className="text-xs text-th-text-2 leading-relaxed">{pick.thesis}</p>
              </div>
            )}
            {!isActive && pick.sellDate && (
              <div className={`mt-2 p-2.5 rounded-lg border ${
                pick.profitLoss != null && pick.profitLoss >= 0
                  ? "bg-th-positive-bg/50 border-th-positive-border"
                  : "bg-th-negative-bg/50 border-th-negative-border"
              }`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-th-text-2 flex-1">
                    {pick.sellReason || "Position exited"}
                  </p>
                  {pick.profitLoss != null && (
                    <p className={`text-xs font-bold flex-shrink-0 ${pick.profitLoss >= 0 ? "text-th-positive" : "text-th-negative"}`}>
                      {pick.profitLoss >= 0 ? "+" : ""}{formatCurrency(pick.profitLoss)}
                    </p>
                  )}
                </div>
                <p className="text-[10px] text-th-text-4 mt-1">
                  Sold on {formatDate(pick.sellDate)}
                  {pick.sellPrice ? ` at ${formatCurrency(pick.sellPrice)}` : ""}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Performance Chart (SVG) ---

function PerformanceChart({ data }: { data: PerformancePoint[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (data.length < 2) return null;

  const portfolioVals = data.map((d) => d.portfolioValue);
  const benchmarkVals = data.map((d) => d.benchmarkValue);
  const allVals = [...portfolioVals, ...benchmarkVals];
  const minVal = Math.min(...allVals) * 0.995;
  const maxVal = Math.max(...allVals) * 1.005;
  const range = maxVal - minVal || 1;

  const width = 800;
  const height = 220;
  const pad = { top: 15, right: 15, bottom: 30, left: 56 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  function getX(i: number) { return pad.left + (i / (data.length - 1)) * chartW; }
  function getY(val: number) { return pad.top + chartH - ((val - minVal) / range) * chartH; }

  const portfolioPath = data.map((d, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(d.portfolioValue)}`).join(" ");
  const benchmarkPath = data.map((d, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(d.benchmarkValue)}`).join(" ");
  const fillPath = `${portfolioPath} L ${getX(data.length - 1)},${pad.top + chartH} L ${getX(0)},${pad.top + chartH} Z`;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((pct) => ({
    value: minVal + pct * range,
    y: pad.top + chartH - pct * chartH,
  }));

  function formatChartDollar(v: number): string {
    if (v >= 1000000) return `$${(v / 1000000).toFixed(1)}M`;
    return "$" + Math.round(v).toLocaleString("en-US");
  }

  const dateLabels: { label: string; x: number }[] = [];
  const step = Math.max(1, Math.floor(data.length / 6));
  for (let i = 0; i < data.length; i += step) {
    dateLabels.push({ label: formatShortDate(data[i].date), x: getX(i) });
  }

  const hp = hoveredIdx !== null ? { x: getX(hoveredIdx), pY: getY(data[hoveredIdx].portfolioValue), bY: getY(data[hoveredIdx].benchmarkValue) } : null;
  const hd = hoveredIdx !== null ? data[hoveredIdx] : null;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" onMouseLeave={() => setHoveredIdx(null)}>
      <defs>
        <linearGradient id="stPerfGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.12" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.01" />
        </linearGradient>
      </defs>

      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={pad.left} y1={t.y} x2={width - pad.right} y2={t.y} stroke="var(--border-light)" strokeWidth="1" />
          <text x={pad.left - 8} y={t.y + 4} textAnchor="end" className="text-[11px]" fill="var(--text-2)">
            {formatChartDollar(t.value)}
          </text>
        </g>
      ))}

      <path d={fillPath} fill="url(#stPerfGrad)" />
      <path d={portfolioPath} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d={benchmarkPath} fill="none" stroke="var(--text-4)" strokeWidth="1.5" strokeLinejoin="round" strokeDasharray="4 3" />

      {hp && (
        <line x1={hp.x} y1={pad.top} x2={hp.x} y2={pad.top + chartH} stroke="var(--text-4)" strokeWidth="1" strokeDasharray="4 3" />
      )}

      {data.map((_, i) => {
        const hitW = chartW / data.length;
        return (
          <rect key={i} x={getX(i) - hitW / 2} y={pad.top} width={hitW} height={chartH}
            fill="transparent" style={{ cursor: "crosshair" }} onMouseEnter={() => setHoveredIdx(i)} />
        );
      })}

      {hp && hoveredIdx !== null && (
        <>
          <circle cx={hp.x} cy={hp.pY} r={4} fill="var(--accent)" stroke="var(--bg-surface)" strokeWidth="2" />
          <circle cx={hp.x} cy={hp.bY} r={3} fill="var(--text-4)" stroke="var(--bg-surface)" strokeWidth="2" />
        </>
      )}

      {hp && hd && (
        <g>
          <rect x={Math.max(pad.left, Math.min(width - pad.right - 150, hp.x - 75))} y={pad.top - 2}
            width="150" height="42" rx="8" fill="var(--tooltip-bg)" stroke="var(--border)" strokeWidth="1" />
          <text x={Math.max(pad.left + 75, Math.min(width - pad.right - 75, hp.x))} y={pad.top + 14}
            textAnchor="middle" className="text-[11px] font-semibold" fill="var(--accent)">
            Fund: {formatChartDollar(hd.portfolioValue)}
          </text>
          <text x={Math.max(pad.left + 75, Math.min(width - pad.right - 75, hp.x))} y={pad.top + 28}
            textAnchor="middle" className="text-[11px]" fill="var(--text-3)">
            S&P: {formatChartDollar(hd.benchmarkValue)} &middot; {formatShortDate(hd.date)}
          </text>
        </g>
      )}

      {dateLabels.map((dl, i) => (
        <text key={i} x={dl.x} y={height - 6} textAnchor="middle" className="text-[11px]" fill="var(--text-2)">
          {dl.label}
        </text>
      ))}
    </svg>
  );
}
