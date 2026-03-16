"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// --- Status endpoint types ---

interface HealthStatus {
  health: "healthy" | "degraded" | "unhealthy";
  issues: string[];
  refreshTimestamps: {
    lastStockRefresh: string | null;
    lastStockRefreshHoursAgo: number | null;
    lastSignalRefresh: string | null;
    lastSignalRefreshHoursAgo: number | null;
    lastPriceRefresh: string | null;
    lastPriceRefreshHoursAgo: number | null;
    enrichOffset: number;
    refreshLock: string | null;
  };
  stockCounts: {
    total: number;
    withPE: number;
    withROE: number;
    withRevenueHistory: number;
    withEarningsYield: number;
    withScore: number;
    freshFiscalData: number;
    staleFiscalData: number;
    oldestUpdate: string | null;
    newestUpdate: string | null;
    oldestScoreUpdate: string | null;
    newestScoreUpdate: string | null;
  };
  scoreDistribution: {
    score90Plus: number;
    score80to89: number;
    score60to79: number;
    scoreBelow60: number;
    maxScore: number;
    minScore: number;
    avgScore: number;
  } | null;
  signalPicks: {
    active: number;
    sold: number;
    latestPick: string | null;
    latestSell: string | null;
  };
  staleHighCapStocks: {
    symbol: string;
    name: string;
    marketCapB: number;
    latestFiscalDate: string | null;
    lastUpdated: string | null;
    quantScore: number | null;
    scoreUpdatedAt: string | null;
  }[];
}

interface EnrichIssue {
  symbol: string;
  status: string;
  detail: string;
}

interface RefreshResult {
  success?: boolean;
  stocks?: number;
  enriched?: number;
  enrichFailed?: number;
  noData?: number;
  processedCount?: number;
  nextOffset?: number;
  totalStocks?: number;
  runsRemaining?: number;
  batchRange?: string;
  enrichIssues?: EnrichIssue[];
  message?: string;
  error?: string;
  details?: string;
}

interface SignalRefreshResult {
  success?: boolean;
  added?: number;
  sold?: number;
  checked?: number;
  scoreSnapshots?: number;
  priceCorrections?: number;
  error?: string;
}

interface PriceRefreshResult {
  success?: boolean;
  symbols?: { total: number; succeeded: number; failed: number };
  records?: number;
  spy?: { years: number; range: string | null };
  log?: string[];
  error?: string;
  details?: string;
}

interface RefreshAllProgress {
  runsCompleted: number;
  totalRuns: number;
  totalEnriched: number;
  totalFailed: number;
  totalNoData: number;
  currentBatch: string;
  allIssues: EnrichIssue[];
}

// --- Helpers ---

function formatAge(hours: number | null): string {
  if (hours == null) return "never";
  if (hours < 1) return "< 1h ago";
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  });
}

const Spinner = () => (
  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

// --- Component ---

export default function AdminStocks() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState<string | null>(null);

  const [secret, setSecret] = useState("");
  const [authed, setAuthed] = useState(false);

  // Refresh states
  const [refreshingStocks, setRefreshingStocks] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [refreshingSignals, setRefreshingSignals] = useState(false);
  const [refreshingPrices, setRefreshingPrices] = useState(false);

  const [stockResult, setStockResult] = useState<RefreshResult | null>(null);
  const [signalResult, setSignalResult] = useState<SignalRefreshResult | null>(null);
  const [priceResult, setPriceResult] = useState<PriceRefreshResult | null>(null);
  const [refreshAllProgress, setRefreshAllProgress] = useState<RefreshAllProgress | null>(null);

  const abortRef = useRef(false);

  const anyBusy = refreshingStocks || refreshingAll || refreshingSignals || refreshingPrices;

  const fetchHealth = useCallback(async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const res = await fetch("/api/admin/status");
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      setHealth(data);
    } catch (e) {
      setHealthError(e instanceof Error ? e.message : "Failed to fetch status");
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  const getHeaders = () => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (secret.trim()) headers["x-admin-secret"] = secret.trim();
    return headers;
  };

  const handleAuth = () => {
    if (secret.trim()) setAuthed(true);
  };

  // --- Refresh handlers ---

  const handleRefreshStocks = async () => {
    setRefreshingStocks(true);
    setStockResult(null);
    try {
      const res = await fetch("/api/admin/refresh-stocks", { method: "POST", headers: getHeaders() });
      const data = await res.json();
      setStockResult(data);
      if (data.success) fetchHealth();
    } catch {
      setStockResult({ error: "Network error" });
    } finally {
      setRefreshingStocks(false);
    }
  };

  const handleRefreshAllStocks = async () => {
    setRefreshingAll(true);
    setStockResult(null);
    abortRef.current = false;
    const progress: RefreshAllProgress = {
      runsCompleted: 0, totalRuns: 0, totalEnriched: 0, totalFailed: 0, totalNoData: 0, currentBatch: "", allIssues: [],
    };
    setRefreshAllProgress(progress);

    let done = false;
    while (!done && !abortRef.current) {
      try {
        const res = await fetch("/api/admin/refresh-stocks", { method: "POST", headers: getHeaders() });
        const data: RefreshResult = await res.json();
        if (!data.success) { setStockResult(data); break; }

        progress.runsCompleted++;
        progress.totalRuns = progress.runsCompleted + (data.runsRemaining ?? 0);
        progress.totalEnriched += data.enriched ?? 0;
        progress.totalFailed += data.enrichFailed ?? 0;
        progress.totalNoData += data.noData ?? 0;
        progress.currentBatch = data.batchRange ?? "";
        if (data.enrichIssues) {
          progress.allIssues = [...progress.allIssues, ...data.enrichIssues].slice(-100);
        }
        setRefreshAllProgress({ ...progress });

        if (data.nextOffset === 0 || data.runsRemaining === 0) {
          done = true;
          setStockResult(data);
        }
        await new Promise((r) => setTimeout(r, 2000));
      } catch {
        setStockResult({ error: "Network error during refresh-all" });
        break;
      }
    }
    fetchHealth();
    setRefreshingAll(false);
  };

  const handleRefreshSignals = async () => {
    setRefreshingSignals(true);
    setSignalResult(null);
    try {
      const res = await fetch("/api/admin/refresh-signals", { method: "POST", headers: getHeaders() });
      const data = await res.json();
      setSignalResult(data);
      if (data.success) fetchHealth();
    } catch {
      setSignalResult({ error: "Network error" });
    } finally {
      setRefreshingSignals(false);
    }
  };

  const handleRefreshPrices = async () => {
    setRefreshingPrices(true);
    setPriceResult(null);
    try {
      const res = await fetch("/api/admin/refresh-prices", { method: "POST", headers: getHeaders() });
      const data = await res.json();
      setPriceResult(data);
      if (data.success) fetchHealth();
    } catch {
      setPriceResult({ error: "Network error" });
    } finally {
      setRefreshingPrices(false);
    }
  };

  // --- Health badge ---
  const healthColor = health?.health === "healthy"
    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
    : health?.health === "degraded"
      ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
      : "bg-red-500/15 text-red-400 border-red-500/30";

  const healthDot = health?.health === "healthy"
    ? "bg-emerald-400"
    : health?.health === "degraded"
      ? "bg-amber-400"
      : "bg-red-400";

  return (
    <div className="min-h-screen bg-th-bg px-4 sm:px-6 py-8 sm:py-12">
      <div className="max-w-2xl mx-auto">
        <a href="/app" className="text-sm text-th-text-3 hover:text-th-text-2 transition-colors">
          &larr; Back
        </a>

        <h1 className="text-2xl font-bold text-th-text mt-4">System Health</h1>
        <p className="text-sm text-th-text-3 mt-1">Monitor data freshness and manually trigger refreshes.</p>

        {/* Auth gate */}
        {!authed ? (
          <div className="mt-8 bg-th-surface rounded-2xl border border-th-border p-6">
            <h2 className="text-sm font-semibold text-th-text mb-3">Admin Access</h2>
            <div className="flex gap-2">
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAuth()}
                placeholder="Admin secret"
                className="flex-1 px-3 py-2 text-sm bg-th-bg border border-th-border rounded-lg focus:outline-none focus:ring-2 focus:ring-th-focus-ring0/20 focus:border-th-focus-border text-th-text transition-colors"
              />
              <button
                onClick={handleAuth}
                className="px-4 py-2 text-sm font-medium bg-th-nav-active text-white rounded-lg hover:opacity-90 transition-opacity"
              >
                Unlock
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* ===== HEALTH STATUS ===== */}
            <div className="mt-6 bg-th-surface rounded-2xl border border-th-border p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-th-text-3 uppercase tracking-wide">Pipeline Status</h2>
                <button onClick={fetchHealth} className="text-xs text-th-text-3 hover:text-th-text-2 transition-colors">
                  {healthLoading ? "Loading..." : "Refresh"}
                </button>
              </div>

              {healthError ? (
                <p className="text-sm text-red-400">{healthError}</p>
              ) : healthLoading && !health ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => <div key={i} className="h-4 bg-th-skeleton rounded animate-pulse" />)}
                </div>
              ) : health ? (
                <div className="space-y-5">
                  {/* Health badge */}
                  <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium ${healthColor}`}>
                    <span className={`w-2 h-2 rounded-full ${healthDot}`} />
                    {health.health.charAt(0).toUpperCase() + health.health.slice(1)}
                  </div>

                  {/* Issues */}
                  {health.issues.length > 0 && (
                    <div className="space-y-1.5">
                      {health.issues.map((issue, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-amber-400">
                          <span className="mt-0.5 shrink-0">&#9888;</span>
                          <span>{issue}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Cron timestamps */}
                  <div>
                    <h3 className="text-xs font-medium text-th-text-3 mb-2">Cron Jobs</h3>
                    <div className="space-y-2">
                      <CronRow
                        label="Stock Data"
                        schedule="Daily 6am UTC"
                        lastRun={health.refreshTimestamps.lastStockRefresh}
                        hoursAgo={health.refreshTimestamps.lastStockRefreshHoursAgo}
                        threshold={26}
                      />
                      <CronRow
                        label="Quant Scores"
                        schedule="Daily 7am UTC"
                        lastRun={health.refreshTimestamps.lastSignalRefresh}
                        hoursAgo={health.refreshTimestamps.lastSignalRefreshHoursAgo}
                        threshold={26}
                      />
                      <CronRow
                        label="Historical Prices"
                        schedule="Sundays 5am UTC"
                        lastRun={health.refreshTimestamps.lastPriceRefresh}
                        hoursAgo={health.refreshTimestamps.lastPriceRefreshHoursAgo}
                        threshold={192}
                      />
                    </div>
                  </div>

                  {/* Data quality */}
                  <div>
                    <h3 className="text-xs font-medium text-th-text-3 mb-2">Data Quality</h3>
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                      <DataRow label="Total stocks" value={health.stockCounts.total.toLocaleString()} />
                      <DataRow label="With quant score" value={`${health.stockCounts.withScore.toLocaleString()} / ${health.stockCounts.total.toLocaleString()}`} warn={health.stockCounts.withScore === 0} />
                      <DataRow label="With PE ratio" value={health.stockCounts.withPE.toLocaleString()} />
                      <DataRow label="With ROE" value={health.stockCounts.withROE.toLocaleString()} />
                      <DataRow label="With earnings yield" value={health.stockCounts.withEarningsYield.toLocaleString()} />
                      <DataRow label="With revenue history" value={health.stockCounts.withRevenueHistory.toLocaleString()} />
                      <DataRow label="Fresh fiscal data" value={health.stockCounts.freshFiscalData.toLocaleString()} />
                      <DataRow label="Stale fiscal data" value={health.stockCounts.staleFiscalData.toLocaleString()} warn={health.stockCounts.staleFiscalData > health.stockCounts.freshFiscalData} />
                    </dl>
                  </div>

                  {/* Score distribution */}
                  {health.scoreDistribution && (
                    <div>
                      <h3 className="text-xs font-medium text-th-text-3 mb-2">Score Distribution</h3>
                      <div className="flex gap-2 text-xs">
                        <ScoreBucket label="90+" count={health.scoreDistribution.score90Plus} color="bg-emerald-500/20 text-emerald-400" />
                        <ScoreBucket label="80-89" count={health.scoreDistribution.score80to89} color="bg-blue-500/20 text-blue-400" />
                        <ScoreBucket label="60-79" count={health.scoreDistribution.score60to79} color="bg-th-skeleton text-th-text-3" />
                        <ScoreBucket label="<60" count={health.scoreDistribution.scoreBelow60} color="bg-th-skeleton text-th-text-4" />
                      </div>
                      <p className="text-[10px] text-th-text-4 mt-1.5">
                        Range: {health.scoreDistribution.minScore}&ndash;{health.scoreDistribution.maxScore} &middot; Avg: {health.scoreDistribution.avgScore}
                      </p>
                    </div>
                  )}

                  {/* Signal picks */}
                  <div>
                    <h3 className="text-xs font-medium text-th-text-3 mb-2">Signal Picks</h3>
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                      <DataRow label="Active picks" value={String(health.signalPicks.active)} />
                      <DataRow label="Sold picks" value={String(health.signalPicks.sold)} />
                      <DataRow label="Latest pick" value={health.signalPicks.latestPick ? formatTimestamp(health.signalPicks.latestPick) : "None"} />
                      <DataRow label="Latest sell" value={health.signalPicks.latestSell ? formatTimestamp(health.signalPicks.latestSell) : "None"} />
                    </dl>
                  </div>

                  {/* Stale high-cap stocks */}
                  {health.staleHighCapStocks.length > 0 && (
                    <details>
                      <summary className="text-xs text-amber-400 cursor-pointer font-medium">
                        {health.staleHighCapStocks.length} large-cap stocks with stale data
                      </summary>
                      <div className="mt-2 max-h-48 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-th-text-4 text-left">
                              <th className="pb-1 pr-3">Symbol</th>
                              <th className="pb-1 pr-3">Mkt Cap</th>
                              <th className="pb-1 pr-3">Last Fiscal</th>
                              <th className="pb-1">Score</th>
                            </tr>
                          </thead>
                          <tbody className="text-th-text-3">
                            {health.staleHighCapStocks.map((s) => (
                              <tr key={s.symbol}>
                                <td className="py-0.5 pr-3 font-medium text-th-text">{s.symbol}</td>
                                <td className="py-0.5 pr-3">${s.marketCapB}B</td>
                                <td className="py-0.5 pr-3 text-amber-400">{s.latestFiscalDate || "None"}</td>
                                <td className="py-0.5">{s.quantScore ?? "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  )}

                  {health.refreshTimestamps.enrichOffset > 0 && (
                    <p className="text-[10px] text-th-text-4">
                      Enrichment offset: stock #{health.refreshTimestamps.enrichOffset} of {health.stockCounts.total}
                    </p>
                  )}
                </div>
              ) : null}
            </div>

            {/* ===== MANUAL REFRESH CONTROLS ===== */}
            <div className="mt-6 space-y-4">
              <h2 className="text-sm font-semibold text-th-text-3 uppercase tracking-wide px-1">Manual Refresh</h2>

              {/* Refresh Stocks */}
              <RefreshCard
                title="Stock Data"
                description="Updates screener data for all stocks, then enriches detailed metrics (ratios, key metrics, income statements) starting from where the last run left off."
                cronInfo="Cron: daily at 6am UTC"
                busy={refreshingStocks || refreshingAll}
                anyBusy={anyBusy}
                onRun={handleRefreshStocks}
                runLabel={refreshingStocks ? "Running..." : "Run 1 Batch"}
                secondaryAction={{
                  label: refreshingAll ? "Running..." : "Refresh All Stocks",
                  onClick: handleRefreshAllStocks,
                  busy: refreshingAll,
                }}
                stopAction={refreshingAll ? { label: "Stop after current batch", onClick: () => { abortRef.current = true; } } : undefined}
              />

              {/* Refresh All progress */}
              {refreshAllProgress && refreshingAll && (
                <div className="rounded-xl border border-th-accent-border bg-th-accent-bg p-4">
                  <p className="text-sm font-medium text-th-accent-text">
                    Run {refreshAllProgress.runsCompleted} of ~{refreshAllProgress.totalRuns || "?"}
                  </p>
                  {refreshAllProgress.totalRuns > 0 && (
                    <div className="mt-2 w-full bg-th-accent-muted rounded-full h-1.5">
                      <div
                        className="bg-th-accent h-1.5 rounded-full transition-all duration-500"
                        style={{ width: `${Math.round((refreshAllProgress.runsCompleted / refreshAllProgress.totalRuns) * 100)}%` }}
                      />
                    </div>
                  )}
                  <div className="mt-2 text-xs text-th-accent-text space-y-0.5">
                    <p>Batch: {refreshAllProgress.currentBatch} &middot; Enriched: {refreshAllProgress.totalEnriched.toLocaleString()}</p>
                    {refreshAllProgress.totalFailed > 0 && <p className="text-red-400">Errors: {refreshAllProgress.totalFailed}</p>}
                  </div>
                </div>
              )}

              {/* Stock result */}
              {stockResult && !refreshingAll && (
                <ResultBanner success={stockResult.success} error={stockResult.error}>
                  {stockResult.success && (
                    <p className="text-xs">
                      {stockResult.message || `Enriched ${stockResult.enriched?.toLocaleString() ?? 0} stocks`}
                      {(stockResult.runsRemaining ?? 0) > 0 && ` · ~${stockResult.runsRemaining} batches remaining`}
                    </p>
                  )}
                </ResultBanner>
              )}

              {/* Refresh All final result */}
              {refreshAllProgress && !refreshingAll && refreshAllProgress.runsCompleted > 0 && (
                <ResultBanner success={true}>
                  <p className="text-xs">
                    Full refresh complete &middot; {refreshAllProgress.runsCompleted} runs &middot; {refreshAllProgress.totalEnriched.toLocaleString()} enriched
                    {refreshAllProgress.totalFailed > 0 && ` · ${refreshAllProgress.totalFailed} errors`}
                  </p>
                </ResultBanner>
              )}

              {/* Refresh Signals */}
              <RefreshCard
                title="Quant Scores & Signal Picks"
                description="Re-scores all stocks, persists scores to DB, generates new picks (score >= 90), sells active picks that dropped below 80, and records monthly snapshots."
                cronInfo="Cron: daily at 7am UTC"
                busy={refreshingSignals}
                anyBusy={anyBusy}
                onRun={handleRefreshSignals}
                runLabel={refreshingSignals ? "Running..." : "Refresh Scores"}
              />

              {signalResult && (
                <ResultBanner success={signalResult.success} error={signalResult.error}>
                  {signalResult.success && (
                    <p className="text-xs">
                      +{signalResult.added ?? 0} picks &middot; {signalResult.sold ?? 0} sold &middot; {signalResult.checked ?? 0} checked
                      {(signalResult.scoreSnapshots ?? 0) > 0 && ` · ${signalResult.scoreSnapshots} score snapshots`}
                      {(signalResult.priceCorrections ?? 0) > 0 && ` · ${signalResult.priceCorrections} price corrections`}
                    </p>
                  )}
                </ResultBanner>
              )}

              {/* Refresh Prices */}
              <RefreshCard
                title="Historical Prices"
                description="Fetches 20 years of price data from Yahoo Finance for all stocks and computes annual returns for backtesting. Also updates SPY benchmark. No API key required."
                cronInfo="Cron: Sundays at 5am UTC"
                busy={refreshingPrices}
                anyBusy={anyBusy}
                onRun={handleRefreshPrices}
                runLabel={refreshingPrices ? "Fetching... (may take several minutes)" : "Refresh Prices"}
              />

              {priceResult && (
                <ResultBanner success={priceResult.success} error={priceResult.error}>
                  {priceResult.success && priceResult.symbols && (
                    <p className="text-xs">
                      {priceResult.symbols.succeeded.toLocaleString()} / {priceResult.symbols.total.toLocaleString()} symbols
                      &middot; {priceResult.records?.toLocaleString() ?? 0} annual return records
                      {priceResult.spy && ` · SPY: ${priceResult.spy.years}yr (${priceResult.spy.range})`}
                    </p>
                  )}
                </ResultBanner>
              )}
            </div>

            {/* Spacer */}
            <div className="h-12" />
          </>
        )}
      </div>
    </div>
  );
}

// --- Sub-components ---

function CronRow({ label, schedule, lastRun, hoursAgo, threshold }: {
  label: string; schedule: string; lastRun: string | null; hoursAgo: number | null; threshold: number;
}) {
  const stale = hoursAgo == null || hoursAgo > threshold;
  return (
    <div className="flex items-center justify-between text-xs">
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${stale ? "bg-amber-400" : "bg-emerald-400"}`} />
        <span className="text-th-text font-medium">{label}</span>
        <span className="text-th-text-4">{schedule}</span>
      </div>
      <span className={stale ? "text-amber-400" : "text-th-text-3"}>
        {formatAge(hoursAgo)}
        {lastRun && <span className="text-th-text-4 ml-1.5">({formatTimestamp(lastRun)})</span>}
      </span>
    </div>
  );
}

function DataRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <>
      <dt className="text-th-text-3">{label}</dt>
      <dd className={`font-medium text-right ${warn ? "text-amber-400" : "text-th-text"}`}>{value}</dd>
    </>
  );
}

function ScoreBucket({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className={`flex-1 rounded-lg px-2 py-1.5 text-center ${color}`}>
      <div className="font-bold text-sm">{count}</div>
      <div className="text-[10px] opacity-80">{label}</div>
    </div>
  );
}

function RefreshCard({ title, description, cronInfo, busy, anyBusy, onRun, runLabel, secondaryAction, stopAction }: {
  title: string;
  description: string;
  cronInfo: string;
  busy: boolean;
  anyBusy: boolean;
  onRun: () => void;
  runLabel: string;
  secondaryAction?: { label: string; onClick: () => void; busy: boolean };
  stopAction?: { label: string; onClick: () => void };
}) {
  return (
    <div className="bg-th-surface rounded-xl border border-th-border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-th-text">{title}</h3>
          <p className="text-[11px] text-th-text-3 mt-0.5">{description}</p>
          <p className="text-[10px] text-th-text-4 mt-0.5">{cronInfo}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          {secondaryAction && (
            <button
              onClick={secondaryAction.onClick}
              disabled={anyBusy}
              className="px-3 py-2 text-xs font-medium bg-th-accent text-white rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              {secondaryAction.busy ? <span className="flex items-center gap-1.5"><Spinner />{secondaryAction.label}</span> : secondaryAction.label}
            </button>
          )}
          <button
            onClick={onRun}
            disabled={anyBusy}
            className="px-3 py-2 text-xs font-medium bg-th-skeleton text-th-text-2 rounded-lg hover:bg-th-bar disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? <span className="flex items-center gap-1.5"><Spinner />{runLabel}</span> : runLabel}
          </button>
        </div>
      </div>
      {stopAction && (
        <button
          onClick={stopAction.onClick}
          className="mt-2 w-full px-3 py-1.5 text-[11px] font-medium text-red-400 bg-red-500/10 rounded-lg hover:bg-red-500/20 transition-colors"
        >
          {stopAction.label}
        </button>
      )}
    </div>
  );
}

function ResultBanner({ success, error, children }: { success?: boolean; error?: string; children?: React.ReactNode }) {
  if (success) {
    return (
      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-emerald-400">
        {children}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-red-400 text-xs">
      {error || "Unknown error"}
    </div>
  );
}
