"use client";

import { useState, useEffect, useCallback } from "react";

interface StockStatus {
  configured: boolean;
  lastPopulate?: string;
  lastRefresh?: string;
  enrichOffset?: number;
  stockCount?: number;
  error?: string;
  message?: string;
}

interface RefreshResult {
  success?: boolean;
  stocks?: number;
  enriched?: number;
  enrichFailed?: number;
  nextOffset?: number;
  message?: string;
  error?: string;
  details?: string;
}

interface BulkRefreshResult {
  success?: boolean;
  verification?: { total: number; has_pe: number; has_roe: number; has_div_yield: number };
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

export default function AdminStocks() {
  const [status, setStatus] = useState<StockStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [bulkRefreshing, setBulkRefreshing] = useState(false);
  const [result, setResult] = useState<RefreshResult | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkRefreshResult | null>(null);
  const [cleanupResult, setCleanupResult] = useState<CleanupResult | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [secret, setSecret] = useState("");

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

  const handleRefresh = async () => {
    setRefreshing(true);
    setResult(null);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (secret.trim()) {
        headers["x-admin-secret"] = secret.trim();
      }
      const res = await fetch("/api/admin/refresh-stocks", {
        method: "POST",
        headers,
      });
      const data = await res.json();
      setResult(data);
      if (data.success) {
        fetchStatus();
      }
    } catch {
      setResult({ error: "Network error — could not reach server" });
    } finally {
      setRefreshing(false);
    }
  };

  const handleBulkRefresh = async () => {
    setBulkRefreshing(true);
    setBulkResult(null);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (secret.trim()) {
        headers["x-admin-secret"] = secret.trim();
      }
      const res = await fetch("/api/admin/refresh-data", {
        method: "POST",
        headers,
      });
      const data = await res.json();
      setBulkResult(data);
      if (data.success) {
        fetchStatus();
      }
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
      if (secret.trim()) {
        headers["x-admin-secret"] = secret.trim();
      }
      const res = await fetch("/api/admin/cleanup", {
        method: "POST",
        headers,
      });
      const data = await res.json();
      setCleanupResult(data);
      if (data.success) {
        fetchStatus();
      }
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
                disabled={refreshing}
                className="mt-3 px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
              >
                Initialize Tables
              </button>
            </div>
          ) : (
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">Database</dt>
                <dd className={status?.configured ? "text-emerald-600 font-medium" : "text-red-500 font-medium"}>
                  {status?.configured ? "Connected" : "Not configured"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Stocks</dt>
                <dd className="text-gray-900 font-medium">{status?.stockCount?.toLocaleString() ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Last bulk refresh</dt>
                <dd className="text-gray-900 font-medium">
                  {status?.lastRefresh
                    ? new Date(status.lastRefresh).toLocaleString()
                    : "Never"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Last per-stock refresh</dt>
                <dd className="text-gray-900 font-medium">
                  {status?.lastPopulate
                    ? new Date(status.lastPopulate).toLocaleString()
                    : "Never"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Enrich offset</dt>
                <dd className="text-gray-900 font-medium">{status?.enrichOffset ?? "—"}</dd>
              </div>
            </dl>
          )}
        </div>

        {/* Admin secret — shared across all actions */}
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

        {/* Bulk refresh controls (recommended) */}
        <div className="mt-6 bg-white rounded-2xl border border-blue-200 p-6">
          <h2 className="text-sm font-semibold text-blue-600 uppercase tracking-wide">Bulk Refresh (Recommended)</h2>
          <p className="text-xs text-gray-400 mt-1">
            Refreshes the entire database using only 3 FMP API calls: stock screener + ratios TTM bulk + key metrics TTM bulk.
            Creates a new table, populates it, then atomically swaps. Takes ~30 seconds.
          </p>

          <button
            onClick={handleBulkRefresh}
            disabled={bulkRefreshing || refreshing}
            className="mt-4 w-full px-4 py-3 text-sm font-medium bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {bulkRefreshing ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Bulk refreshing... (~30 seconds)
              </span>
            ) : (
              "Bulk Refresh (3 API calls)"
            )}
          </button>
        </div>

        {/* Bulk refresh result */}
        {bulkResult && (
          <div className={`mt-4 rounded-2xl border p-6 ${
            bulkResult.success
              ? "bg-emerald-50 border-emerald-200"
              : "bg-red-50 border-red-200"
          }`}>
            {bulkResult.success ? (
              <div className="text-sm">
                <p className="font-medium text-emerald-800">Bulk refresh complete</p>
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
                {bulkResult.aapl && (
                  <div className="mt-3 p-3 bg-emerald-100 rounded-lg">
                    <p className="font-medium text-emerald-800 text-xs">AAPL verification:</p>
                    <p className="text-emerald-700 text-xs mt-1">
                      PE: {String(bulkResult.aapl.price_to_earnings_ratio ?? "—")} |
                      PB: {String(bulkResult.aapl.price_to_book_ratio ?? "—")} |
                      ROE: {String(bulkResult.aapl.return_on_equity ?? "—")} |
                      Sector: {String(bulkResult.aapl.sector ?? "—")}
                    </p>
                  </div>
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
                <p className="font-medium text-red-800">Bulk refresh failed</p>
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

        {/* Per-stock refresh controls */}
        <div className="mt-6 bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Per-Stock Refresh</h2>
          <p className="text-xs text-gray-400 mt-1">
            Pulls the latest stock screener data from FMP and enriches a batch of 150 stocks with detailed metrics.
            Slower but more granular. Run multiple times to cover all stocks.
          </p>

          <button
            onClick={handleRefresh}
            disabled={refreshing || bulkRefreshing}
            className="mt-4 w-full px-4 py-3 text-sm font-medium bg-gray-700 text-white rounded-xl hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {refreshing ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Refreshing... (this takes a few minutes)
              </span>
            ) : (
              "Refresh Stocks (per-stock)"
            )}
          </button>
        </div>

        {/* Cleanup controls */}
        <div className="mt-6 bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Purge Non-Companies</h2>
          <p className="text-xs text-gray-400 mt-1">
            Removes mutual funds, indexes, ETFs, SPACs, trusts, preferred securities, and other
            non-operating-company entries from the database.
          </p>

          <button
            onClick={handleCleanup}
            disabled={cleaning || refreshing}
            className="mt-4 w-full px-4 py-3 text-sm font-medium bg-gray-900 text-white rounded-xl hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
          <div className={`mt-6 rounded-2xl border p-6 ${
            cleanupResult.success
              ? "bg-emerald-50 border-emerald-200"
              : "bg-red-50 border-red-200"
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

        {/* Result */}
        {result && (
          <div className={`mt-6 rounded-2xl border p-6 ${
            result.success
              ? "bg-emerald-50 border-emerald-200"
              : "bg-red-50 border-red-200"
          }`}>
            {result.success ? (
              <div className="text-sm">
                <p className="font-medium text-emerald-800">Refresh complete</p>
                {result.message && <p className="text-emerald-700 mt-1">{result.message}</p>}
                {result.stocks !== undefined && (
                  <dl className="mt-3 space-y-1 text-emerald-700">
                    <div className="flex justify-between">
                      <dt>Screener stocks</dt>
                      <dd className="font-medium">{result.stocks}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Enriched</dt>
                      <dd className="font-medium">{result.enriched}</dd>
                    </div>
                    {(result.enrichFailed ?? 0) > 0 && (
                      <div className="flex justify-between">
                        <dt>Failed</dt>
                        <dd className="font-medium text-amber-700">{result.enrichFailed}</dd>
                      </div>
                    )}
                  </dl>
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
      </div>
    </div>
  );
}
