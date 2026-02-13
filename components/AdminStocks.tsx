"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface StockStatus {
  configured: boolean;
  lastPopulate?: string;
  lastRefresh?: string;
  enrichOffset?: number;
  stockCount?: number;
  enrichedCount?: number;
  historyCount?: number;
  error?: string;
  message?: string;
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
  partial?: number;
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

interface BulkRefreshResult {
  success?: boolean;
  verification?: { total: number; has_pe: number; has_roe: number; has_div_yield: number };
  enrichment?: { enriched: number; failed: number; partial?: number; noData?: number; skipped: number; total: number };
  enrichIssues?: EnrichIssue[];
  aapl?: Record<string, unknown> | null;
  log?: string[];
  error?: string;
  details?: string;
}

interface CleanupResult {
  success?: boolean;
  before?: number;
  after?: number;
  deleted?: number;
  breakdown?: { etf: number; noSector: number; badSymbol: number; namePattern: number; mutualFundTicker: number };
  deletedSymbols?: { symbol: string; name: string }[];
  error?: string;
  details?: string;
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

export default function AdminStocks() {
  const [status, setStatus] = useState<StockStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [bulkRefreshing, setBulkRefreshing] = useState(false);
  const [result, setResult] = useState<RefreshResult | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkRefreshResult | null>(null);
  const [cleanupResult, setCleanupResult] = useState<CleanupResult | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [priceRefreshing, setPriceRefreshing] = useState(false);
  const [priceResult, setPriceResult] = useState<PriceRefreshResult | null>(null);
  const [secret, setSecret] = useState("");
  const [refreshAllProgress, setRefreshAllProgress] = useState<RefreshAllProgress | null>(null);
  const abortRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/refresh-stocks");
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus({ configured: false, message: "Failed to fetch status" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const getHeaders = () => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (secret.trim()) headers["x-admin-secret"] = secret.trim();
    return headers;
  };

  const anyBusy = refreshing || refreshingAll || bulkRefreshing || cleaning || priceRefreshing;

  // Single batch refresh
  const handleRefresh = async () => {
    setRefreshing(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/refresh-stocks", { method: "POST", headers: getHeaders() });
      const data = await res.json();
      setResult(data);
      if (data.success) fetchStatus();
    } catch {
      setResult({ error: "Network error — could not reach server" });
    } finally {
      setRefreshing(false);
    }
  };

  // Refresh ALL stocks — chains runs until offset wraps to 0
  const handleRefreshAll = async () => {
    setRefreshingAll(true);
    setResult(null);
    abortRef.current = false;

    const progress: RefreshAllProgress = {
      runsCompleted: 0,
      totalRuns: 0,
      totalEnriched: 0,
      totalFailed: 0,
      totalNoData: 0,
      currentBatch: "",
      allIssues: [],
    };
    setRefreshAllProgress(progress);

    let done = false;

    while (!done && !abortRef.current) {
      try {
        const res = await fetch("/api/admin/refresh-stocks", { method: "POST", headers: getHeaders() });
        const data: RefreshResult = await res.json();

        if (!data.success) {
          setResult(data);
          break;
        }

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

        // Done when offset wraps to 0 (full cycle) or no more runs
        if (data.nextOffset === 0 || data.runsRemaining === 0) {
          done = true;
          setResult(data);
        }

        // Brief pause between runs
        await new Promise((r) => setTimeout(r, 2000));
      } catch {
        setResult({ error: "Network error during refresh-all" });
        break;
      }
    }

    fetchStatus();
    setRefreshingAll(false);
  };

  const handleStopRefreshAll = () => {
    abortRef.current = true;
  };

  // Full reset (table swap — only for initial setup or disaster recovery)
  const handleBulkRefresh = async () => {
    setBulkRefreshing(true);
    setBulkResult(null);
    try {
      const res = await fetch("/api/admin/refresh-data", { method: "POST", headers: getHeaders() });
      const data = await res.json();
      setBulkResult(data);
      if (data.success) fetchStatus();
    } catch {
      setBulkResult({ error: "Network error — could not reach server" });
    } finally {
      setBulkRefreshing(false);
    }
  };

  const handleCleanup = async () => {
    setCleaning(true);
    setCleanupResult(null);
    try {
      const headers: Record<string, string> = {};
      if (secret.trim()) headers["x-admin-secret"] = secret.trim();
      const res = await fetch("/api/admin/cleanup", { method: "POST", headers });
      const data = await res.json();
      setCleanupResult(data);
      if (data.success) fetchStatus();
    } catch {
      setCleanupResult({ error: "Network error — could not reach server" });
    } finally {
      setCleaning(false);
    }
  };

  const handleInitDb = async () => {
    setRefreshing(true);
    setResult(null);
    try {
      const res = await fetch("/api/db/init", { method: "POST" });
      const data = await res.json();
      setResult({ success: true, message: `Database initialized: ${JSON.stringify(data)}` });
      fetchStatus();
    } catch {
      setResult({ error: "Failed to initialize database" });
    } finally {
      setRefreshing(false);
    }
  };

  // Refresh historical prices from Yahoo Finance
  const handlePriceRefresh = async () => {
    setPriceRefreshing(true);
    setPriceResult(null);
    try {
      const res = await fetch("/api/admin/refresh-prices", { method: "POST", headers: getHeaders() });
      const data = await res.json();
      setPriceResult(data);
    } catch {
      setPriceResult({ error: "Network error — could not reach server" });
    } finally {
      setPriceRefreshing(false);
    }
  };

  // Compute enrichment percentage for status display
  const enrichPct = status?.stockCount && status?.enrichedCount
    ? Math.round((status.enrichedCount / status.stockCount) * 100)
    : null;

  return (
    <div className="min-h-screen bg-gray-50/50 px-6 py-16">
      <div className="max-w-xl mx-auto">
        <a href="/" className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
          &larr; Back
        </a>

        <h1 className="text-2xl font-bold text-gray-900 mt-4">Stock Database</h1>
        <p className="text-sm text-gray-400 mt-1">Manage the stock data used for backtesting.</p>

        {/* Status card */}
        <div className="mt-8 bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Current Status</h2>
          {loading ? (
            <p className="mt-3 text-gray-400 text-sm">Loading...</p>
          ) : status?.error ? (
            <div className="mt-3">
              <p className="text-amber-700 text-sm">{status.error}</p>
              <button
                onClick={handleInitDb}
                disabled={anyBusy}
                className="mt-3 px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
              >
                Initialize Tables
              </button>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500">Database</dt>
                  <dd className={status?.configured ? "text-emerald-600 font-medium" : "text-red-500 font-medium"}>
                    {status?.configured ? "Connected" : "Not configured"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Total stocks</dt>
                  <dd className="text-gray-900 font-medium">{status?.stockCount?.toLocaleString() ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Enriched (have metrics)</dt>
                  <dd className="text-gray-900 font-medium">
                    {status?.enrichedCount != null
                      ? `${status.enrichedCount.toLocaleString()} / ${status?.stockCount?.toLocaleString() ?? "?"} (${enrichPct ?? 0}%)`
                      : "—"}
                  </dd>
                </div>
                {status?.enrichedCount != null && status?.stockCount != null && (
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${enrichPct ?? 0}%` }}
                    />
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-gray-500">With revenue history</dt>
                  <dd className="text-gray-900 font-medium">{status?.historyCount?.toLocaleString() ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Last refresh</dt>
                  <dd className="text-gray-900 font-medium">
                    {status?.lastPopulate
                      ? new Date(status.lastPopulate).toLocaleString()
                      : status?.lastRefresh
                        ? new Date(status.lastRefresh).toLocaleString()
                        : "Never"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Next batch starts at</dt>
                  <dd className="text-gray-900 font-medium">
                    {status?.enrichOffset != null && status?.stockCount
                      ? `Stock #${status.enrichOffset} of ${status.stockCount}`
                      : "—"}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>

        {/* Admin secret */}
        <div className="mt-6 bg-white rounded-2xl border border-gray-200 p-6">
          <label className="block text-xs text-gray-500 mb-1">Admin secret (leave blank if not configured)</label>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Optional"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-colors"
          />
        </div>

        {/* Main refresh controls */}
        <div className="mt-6 bg-white rounded-2xl border border-blue-200 p-6">
          <h2 className="text-sm font-semibold text-blue-600 uppercase tracking-wide">Refresh Stocks</h2>
          <p className="text-xs text-gray-400 mt-1">
            Updates screener data for all stocks, then enriches detailed metrics (ratios, key metrics,
            income statements, quotes) starting from where the last run left off. Each run processes
            as many stocks as possible within a 4-minute window.
          </p>

          <div className="mt-4 flex gap-3">
            <button
              onClick={handleRefreshAll}
              disabled={anyBusy}
              className="flex-1 px-4 py-3 text-sm font-medium bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {refreshingAll ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Running...
                </span>
              ) : (
                "Refresh All Stocks"
              )}
            </button>
            <button
              onClick={handleRefresh}
              disabled={anyBusy}
              className="px-4 py-3 text-sm font-medium bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {refreshing ? "Running..." : "Run 1 Batch"}
            </button>
          </div>

          {refreshingAll && (
            <button
              onClick={handleStopRefreshAll}
              className="mt-2 w-full px-3 py-2 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
            >
              Stop after current batch
            </button>
          )}

          <p className="text-xs text-gray-400 mt-3">
            <strong>Refresh All</strong> chains runs automatically until every stock is enriched.
            <strong> Run 1 Batch</strong> processes a single batch (~200 stocks) and stops.
          </p>
        </div>

        {/* Refresh All progress */}
        {refreshAllProgress && refreshingAll && (
          <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-6">
            <div className="text-sm">
              <p className="font-medium text-blue-800">
                Refreshing... Run {refreshAllProgress.runsCompleted} of ~{refreshAllProgress.totalRuns || "?"}
              </p>
              {refreshAllProgress.totalRuns > 0 && (
                <div className="mt-2 w-full bg-blue-100 rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${Math.round((refreshAllProgress.runsCompleted / refreshAllProgress.totalRuns) * 100)}%` }}
                  />
                </div>
              )}
              <dl className="mt-3 space-y-1 text-blue-700">
                <div className="flex justify-between">
                  <dt>Last batch</dt>
                  <dd className="font-medium font-mono">{refreshAllProgress.currentBatch}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Total enriched so far</dt>
                  <dd className="font-medium">{refreshAllProgress.totalEnriched.toLocaleString()}</dd>
                </div>
                {refreshAllProgress.totalNoData > 0 && (
                  <div className="flex justify-between">
                    <dt>No data (FMP has no info)</dt>
                    <dd className="font-medium text-amber-600">{refreshAllProgress.totalNoData}</dd>
                  </div>
                )}
                {refreshAllProgress.totalFailed > 0 && (
                  <div className="flex justify-between">
                    <dt>Errors</dt>
                    <dd className="font-medium text-red-600">{refreshAllProgress.totalFailed}</dd>
                  </div>
                )}
              </dl>
            </div>
          </div>
        )}

        {/* Refresh result (single batch or final result) */}
        {result && !refreshingAll && (
          <div className={`mt-4 rounded-2xl border p-6 ${
            result.success ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"
          }`}>
            {result.success ? (
              <div className="text-sm">
                <p className="font-medium text-emerald-800">Refresh complete</p>
                {result.message && <p className="text-emerald-700 mt-1">{result.message}</p>}
                {result.stocks !== undefined && (
                  <dl className="mt-3 space-y-1 text-emerald-700">
                    <div className="flex justify-between">
                      <dt>Screener stocks</dt>
                      <dd className="font-medium">{result.stocks?.toLocaleString()}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Enriched this run</dt>
                      <dd className="font-medium">{result.enriched?.toLocaleString()}</dd>
                    </div>
                    {(result.noData ?? 0) > 0 && (
                      <div className="flex justify-between">
                        <dt>No data (FMP has no info)</dt>
                        <dd className="font-medium text-amber-600">{result.noData}</dd>
                      </div>
                    )}
                    {(result.enrichFailed ?? 0) > 0 && (
                      <div className="flex justify-between">
                        <dt>Errors</dt>
                        <dd className="font-medium text-red-600">{result.enrichFailed}</dd>
                      </div>
                    )}
                    {(result.runsRemaining ?? 0) > 0 && (
                      <div className="flex justify-between">
                        <dt>Runs remaining for full coverage</dt>
                        <dd className="font-medium">~{result.runsRemaining}</dd>
                      </div>
                    )}
                  </dl>
                )}
                {/* Enrich issues */}
                {result.enrichIssues && result.enrichIssues.length > 0 && (
                  <details className="mt-3">
                    <summary className="text-amber-600 cursor-pointer text-xs font-medium">
                      Issues ({result.enrichIssues.length} stocks)
                    </summary>
                    <div className="mt-2 max-h-48 overflow-y-auto text-xs space-y-0.5 font-mono">
                      {result.enrichIssues.map((issue, i) => (
                        <div key={i} className={issue.status === 'error' ? 'text-red-600' : issue.status === 'no_data' ? 'text-amber-600' : 'text-gray-500'}>
                          <span className="font-medium">{issue.symbol}</span> [{issue.status}] {issue.detail}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ) : (
              <div className="text-sm">
                <p className="font-medium text-red-800">Refresh failed</p>
                <p className="text-red-700 mt-1">{result.error}</p>
                {result.details && <p className="text-red-600 text-xs mt-2">{result.details}</p>}
              </div>
            )}
          </div>
        )}

        {/* Refresh All final result with accumulated issues */}
        {refreshAllProgress && !refreshingAll && refreshAllProgress.runsCompleted > 0 && (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
            <div className="text-sm">
              <p className="font-medium text-emerald-800">
                Full refresh complete — {refreshAllProgress.runsCompleted} runs
              </p>
              <dl className="mt-3 space-y-1 text-emerald-700">
                <div className="flex justify-between">
                  <dt>Total enriched</dt>
                  <dd className="font-medium">{refreshAllProgress.totalEnriched.toLocaleString()}</dd>
                </div>
                {refreshAllProgress.totalNoData > 0 && (
                  <div className="flex justify-between">
                    <dt>No data (FMP has no info)</dt>
                    <dd className="font-medium text-amber-600">{refreshAllProgress.totalNoData}</dd>
                  </div>
                )}
                {refreshAllProgress.totalFailed > 0 && (
                  <div className="flex justify-between">
                    <dt>Errors</dt>
                    <dd className="font-medium text-red-600">{refreshAllProgress.totalFailed}</dd>
                  </div>
                )}
              </dl>
              {refreshAllProgress.allIssues.length > 0 && (
                <details className="mt-3">
                  <summary className="text-amber-600 cursor-pointer text-xs font-medium">
                    All issues ({refreshAllProgress.allIssues.length} stocks)
                  </summary>
                  <div className="mt-2 max-h-64 overflow-y-auto text-xs space-y-0.5 font-mono">
                    {refreshAllProgress.allIssues.map((issue, i) => (
                      <div key={i} className={issue.status === 'error' ? 'text-red-600' : issue.status === 'no_data' ? 'text-amber-600' : 'text-gray-500'}>
                        <span className="font-medium">{issue.symbol}</span> [{issue.status}] {issue.detail}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>
        )}

        {/* Historical prices refresh */}
        <div className="mt-6 bg-white rounded-2xl border border-purple-200 p-6">
          <h2 className="text-sm font-semibold text-purple-600 uppercase tracking-wide">Historical Prices</h2>
          <p className="text-xs text-gray-400 mt-1">
            Fetches 20 years of monthly price data from Yahoo Finance for all stocks and computes
            annual returns used for backtesting charts and performance metrics. Also populates
            the S&amp;P 500 (SPY) benchmark. No API key required.
          </p>

          <button
            onClick={handlePriceRefresh}
            disabled={anyBusy}
            className="mt-4 w-full px-4 py-3 text-sm font-medium bg-purple-600 text-white rounded-xl hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {priceRefreshing ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Fetching prices... (this may take a few minutes)
              </span>
            ) : (
              "Refresh Historical Prices"
            )}
          </button>
        </div>

        {/* Price refresh result */}
        {priceResult && (
          <div className={`mt-4 rounded-2xl border p-6 ${
            priceResult.success ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"
          }`}>
            {priceResult.success ? (
              <div className="text-sm">
                <p className="font-medium text-emerald-800">Historical prices updated</p>
                <dl className="mt-3 space-y-1 text-emerald-700">
                  {priceResult.symbols && (
                    <>
                      <div className="flex justify-between">
                        <dt>Symbols processed</dt>
                        <dd className="font-medium">{priceResult.symbols.total.toLocaleString()}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>Succeeded</dt>
                        <dd className="font-medium">{priceResult.symbols.succeeded.toLocaleString()}</dd>
                      </div>
                      {priceResult.symbols.failed > 0 && (
                        <div className="flex justify-between">
                          <dt>Failed</dt>
                          <dd className="font-medium text-amber-600">{priceResult.symbols.failed}</dd>
                        </div>
                      )}
                    </>
                  )}
                  {priceResult.records != null && (
                    <div className="flex justify-between">
                      <dt>Annual return records</dt>
                      <dd className="font-medium">{priceResult.records.toLocaleString()}</dd>
                    </div>
                  )}
                  {priceResult.spy && (
                    <div className="flex justify-between">
                      <dt>SPY benchmark</dt>
                      <dd className="font-medium">
                        {priceResult.spy.years} years ({priceResult.spy.range ?? "—"})
                      </dd>
                    </div>
                  )}
                </dl>
                {priceResult.log && priceResult.log.length > 0 && (
                  <details className="mt-3">
                    <summary className="text-emerald-600 cursor-pointer text-xs font-medium">
                      Log ({priceResult.log.length} entries)
                    </summary>
                    <div className="mt-2 max-h-48 overflow-y-auto text-xs text-emerald-700 space-y-0.5 font-mono">
                      {priceResult.log.map((line, i) => (
                        <div key={i}>{line}</div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ) : (
              <div className="text-sm">
                <p className="font-medium text-red-800">Price refresh failed</p>
                <p className="text-red-700 mt-1">{priceResult.error}</p>
                {priceResult.details && <p className="text-red-600 text-xs mt-2">{priceResult.details}</p>}
                {priceResult.log && priceResult.log.length > 0 && (
                  <details className="mt-3">
                    <summary className="text-red-600 cursor-pointer text-xs">Log ({priceResult.log.length} entries)</summary>
                    <div className="mt-2 max-h-48 overflow-y-auto text-xs text-red-700 space-y-0.5 font-mono">
                      {priceResult.log.map((line, i) => (
                        <div key={i}>{line}</div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        )}

        {/* Cleanup controls */}
        <div className="mt-6 bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Purge Non-Companies</h2>
          <p className="text-xs text-gray-400 mt-1">
            Removes mutual funds, indexes, ETFs, SPACs, trusts, preferred securities, and other
            non-operating-company entries from the database.
          </p>

          <button
            onClick={handleCleanup}
            disabled={anyBusy}
            className="mt-4 w-full px-4 py-3 text-sm font-medium bg-gray-700 text-white rounded-xl hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {cleaning ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Cleaning...
              </span>
            ) : (
              "Purge Non-Companies"
            )}
          </button>
        </div>

        {/* Cleanup result */}
        {cleanupResult && (
          <div className={`mt-4 rounded-2xl border p-6 ${
            cleanupResult.success ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"
          }`}>
            {cleanupResult.success ? (
              <div className="text-sm">
                <p className="font-medium text-emerald-800">
                  {cleanupResult.deleted === 0
                    ? "Database is clean — no non-companies found"
                    : `Purged ${cleanupResult.deleted} non-company entries`}
                </p>
                {(cleanupResult.deleted ?? 0) > 0 && (
                  <>
                    <dl className="mt-3 space-y-1 text-emerald-700">
                      <div className="flex justify-between">
                        <dt>Before</dt>
                        <dd className="font-medium">{cleanupResult.before?.toLocaleString()}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>After</dt>
                        <dd className="font-medium">{cleanupResult.after?.toLocaleString()}</dd>
                      </div>
                    </dl>
                    {cleanupResult.breakdown && (
                      <details className="mt-3">
                        <summary className="text-emerald-600 cursor-pointer text-xs">Breakdown by reason</summary>
                        <dl className="mt-2 space-y-1 text-emerald-700 text-xs">
                          {cleanupResult.breakdown.etf > 0 && (
                            <div className="flex justify-between"><dt>ETF flag</dt><dd>{cleanupResult.breakdown.etf}</dd></div>
                          )}
                          {cleanupResult.breakdown.noSector > 0 && (
                            <div className="flex justify-between"><dt>No sector</dt><dd>{cleanupResult.breakdown.noSector}</dd></div>
                          )}
                          {cleanupResult.breakdown.badSymbol > 0 && (
                            <div className="flex justify-between"><dt>Bad symbol</dt><dd>{cleanupResult.breakdown.badSymbol}</dd></div>
                          )}
                          {cleanupResult.breakdown.namePattern > 0 && (
                            <div className="flex justify-between"><dt>Name pattern</dt><dd>{cleanupResult.breakdown.namePattern}</dd></div>
                          )}
                          {cleanupResult.breakdown.mutualFundTicker > 0 && (
                            <div className="flex justify-between"><dt>MF ticker (5-char X)</dt><dd>{cleanupResult.breakdown.mutualFundTicker}</dd></div>
                          )}
                        </dl>
                      </details>
                    )}
                    {cleanupResult.deletedSymbols && cleanupResult.deletedSymbols.length > 0 && (
                      <details className="mt-2">
                        <summary className="text-emerald-600 cursor-pointer text-xs">Deleted symbols ({cleanupResult.deletedSymbols.length})</summary>
                        <div className="mt-2 max-h-48 overflow-y-auto text-xs text-emerald-700 space-y-0.5">
                          {cleanupResult.deletedSymbols.map((s) => (
                            <div key={s.symbol}><span className="font-medium">{s.symbol}</span> — {s.name}</div>
                          ))}
                        </div>
                      </details>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="text-sm">
                <p className="font-medium text-red-800">Cleanup failed</p>
                <p className="text-red-700 mt-1">{cleanupResult.error}</p>
                {cleanupResult.details && <p className="text-red-600 text-xs mt-2">{cleanupResult.details}</p>}
              </div>
            )}
          </div>
        )}

        {/* Full DB Reset — secondary option */}
        <details className="mt-6">
          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
            Advanced: Full Database Reset
          </summary>
          <div className="mt-3 bg-white rounded-2xl border border-amber-200 p-6">
            <h2 className="text-sm font-semibold text-amber-600 uppercase tracking-wide">Full Database Reset</h2>
            <p className="text-xs text-gray-400 mt-1">
              Drops and recreates the stocks table from scratch. Only enriches the top ~200 stocks by market cap
              in a single run. <strong className="text-amber-600">All existing enrichment is lost.</strong> Only use
              for initial setup or if the database is corrupted.
            </p>

            <button
              onClick={handleBulkRefresh}
              disabled={anyBusy}
              className="mt-4 w-full px-4 py-3 text-sm font-medium bg-amber-600 text-white rounded-xl hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {bulkRefreshing ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Resetting... (3-5 minutes)
                </span>
              ) : (
                "Reset Database (destructive)"
              )}
            </button>
          </div>
        </details>

        {/* Bulk reset result */}
        {bulkResult && (
          <div className={`mt-4 rounded-2xl border p-6 ${
            bulkResult.success ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"
          }`}>
            {bulkResult.success ? (
              <div className="text-sm">
                <p className="font-medium text-emerald-800">Reset complete</p>
                {bulkResult.enrichment && (
                  <dl className="mt-3 space-y-1 text-emerald-700">
                    <div className="flex justify-between">
                      <dt>Enriched</dt>
                      <dd className="font-medium">{bulkResult.enrichment.enriched.toLocaleString()} / {bulkResult.enrichment.total.toLocaleString()}</dd>
                    </div>
                    {bulkResult.enrichment.failed > 0 && (
                      <div className="flex justify-between">
                        <dt>Failed</dt>
                        <dd className="font-medium text-amber-700">{bulkResult.enrichment.failed}</dd>
                      </div>
                    )}
                    {(bulkResult.enrichment.noData ?? 0) > 0 && (
                      <div className="flex justify-between">
                        <dt>No data</dt>
                        <dd className="font-medium text-amber-600">{bulkResult.enrichment.noData}</dd>
                      </div>
                    )}
                    {bulkResult.enrichment.skipped > 0 && (
                      <div className="flex justify-between">
                        <dt>Skipped (timeout)</dt>
                        <dd className="font-medium text-gray-500">{bulkResult.enrichment.skipped.toLocaleString()}</dd>
                      </div>
                    )}
                  </dl>
                )}
                {bulkResult.verification && (
                  <dl className="mt-3 space-y-1 text-emerald-700">
                    <div className="flex justify-between">
                      <dt>Total stocks</dt>
                      <dd className="font-medium">{bulkResult.verification.total.toLocaleString()}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>With PE ratio</dt>
                      <dd className="font-medium">{bulkResult.verification.has_pe.toLocaleString()}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>With ROE</dt>
                      <dd className="font-medium">{bulkResult.verification.has_roe.toLocaleString()}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>With dividend yield</dt>
                      <dd className="font-medium">{bulkResult.verification.has_div_yield.toLocaleString()}</dd>
                    </div>
                  </dl>
                )}
                {bulkResult.enrichIssues && bulkResult.enrichIssues.length > 0 && (
                  <details className="mt-3">
                    <summary className="text-amber-600 cursor-pointer text-xs font-medium">
                      Issues ({bulkResult.enrichIssues.length} stocks)
                    </summary>
                    <div className="mt-2 max-h-48 overflow-y-auto text-xs space-y-0.5 font-mono">
                      {bulkResult.enrichIssues.map((issue, i) => (
                        <div key={i} className={issue.status === 'error' ? 'text-red-600' : issue.status === 'no_data' ? 'text-amber-600' : 'text-gray-500'}>
                          <span className="font-medium">{issue.symbol}</span> [{issue.status}] {issue.detail}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {bulkResult.log && bulkResult.log.length > 0 && (
                  <details className="mt-3">
                    <summary className="text-emerald-600 cursor-pointer text-xs">Log ({bulkResult.log.length} entries)</summary>
                    <div className="mt-2 max-h-48 overflow-y-auto text-xs text-emerald-700 space-y-0.5 font-mono">
                      {bulkResult.log.map((line, i) => (
                        <div key={i}>{line}</div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ) : (
              <div className="text-sm">
                <p className="font-medium text-red-800">Reset failed</p>
                <p className="text-red-700 mt-1">{bulkResult.error}</p>
                {bulkResult.details && <p className="text-red-600 text-xs mt-2">{bulkResult.details}</p>}
                {bulkResult.log && bulkResult.log.length > 0 && (
                  <details className="mt-3">
                    <summary className="text-red-600 cursor-pointer text-xs">Log ({bulkResult.log.length} entries)</summary>
                    <div className="mt-2 max-h-48 overflow-y-auto text-xs text-red-700 space-y-0.5 font-mono">
                      {bulkResult.log.map((line, i) => (
                        <div key={i}>{line}</div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
