"use client";

import { useState, useEffect, useCallback } from "react";

interface StockStatus {
  configured: boolean;
  lastPopulate?: string;
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

export default function AdminStocks() {
  const [status, setStatus] = useState<StockStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState<RefreshResult | null>(null);
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
                <dt className="text-gray-500">Last refresh</dt>
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

        {/* Refresh controls */}
        <div className="mt-6 bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Refresh Stock Data</h2>
          <p className="text-xs text-gray-400 mt-1">
            Pulls the latest stock screener data from FMP and enriches a batch of 150 stocks with detailed metrics.
            Run multiple times to cover all stocks.
          </p>

          <div className="mt-4">
            <label className="block text-xs text-gray-500 mb-1">Admin secret (leave blank if not configured)</label>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Optional"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-colors"
            />
          </div>

          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="mt-4 w-full px-4 py-3 text-sm font-medium bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
              "Refresh Stocks"
            )}
          </button>
        </div>

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
