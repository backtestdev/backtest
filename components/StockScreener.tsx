"use client";

import { useState, useEffect, useCallback } from "react";

interface Stock {
  symbol: string;
  name: string;
  sector: string;
  marketCap: number;
  peRatio: number | null;
  roe: number | null;
  revenueGrowth: number | null;
  profitMargin: number | null;
  dividendYield: number | null;
  debtToEquity: number | null;
  beta: number | null;
  backtestScore: number;
}

interface ScreenerData {
  stocks: Stock[];
  totalCount: number;
  page: number;
  perPage: number;
  sectors: string[];
}

type SortField = "backtest_score" | "market_cap" | "pe_ratio" | "roe" | "revenue_growth" | "dividend_yield";

function formatMarketCap(b: number): string {
  if (b >= 1000) return `$${(b / 1000).toFixed(1)}T`;
  if (b >= 1) return `$${b.toFixed(1)}B`;
  return `$${(b * 1000).toFixed(0)}M`;
}

function formatPct(v: number | null): string {
  if (v === null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function formatNum(v: number | null, decimals = 1): string {
  if (v === null) return "—";
  return v.toFixed(decimals);
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 75 ? "bg-emerald-500" : score >= 50 ? "bg-blue-500" : score >= 25 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="w-12 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className={`text-sm font-bold ${
        score >= 75 ? "text-emerald-600" : score >= 50 ? "text-blue-600" : score >= 25 ? "text-amber-600" : "text-red-500"
      }`}>
        {score}
      </span>
    </div>
  );
}

export default function StockScreener() {
  const [data, setData] = useState<ScreenerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("backtest_score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [sector, setSector] = useState("");
  const [page, setPage] = useState(1);
  const [sectors, setSectors] = useState<string[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        sort: sortField,
        dir: sortDir,
        page: String(page),
        ...(sector && { sector }),
      });
      const res = await fetch(`/api/screener?${params}`);
      const json = await res.json();
      if (json.error) {
        setError(json.error);
        setData(null);
      } else {
        setData(json);
        if (json.sectors) setSectors(json.sectors);
      }
    } catch {
      setError("Failed to load screener data. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [sortField, sortDir, sector, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
    setPage(1);
  };

  const SortHeader = ({ field, label, className = "" }: { field: SortField; label: string; className?: string }) => (
    <button
      onClick={() => handleSort(field)}
      className={`font-medium text-xs uppercase tracking-wider transition-colors ${
        sortField === field ? "text-blue-600" : "text-gray-400 hover:text-gray-600"
      } ${className}`}
    >
      {label}
      {sortField === field && (sortDir === "desc" ? " \u2193" : " \u2191")}
    </button>
  );

  const totalPages = data ? Math.ceil(data.totalCount / data.perPage) : 0;

  return (
    <div className="min-h-screen bg-gray-50/50 px-6 py-12">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Stock Screener</h1>
        <p className="mt-2 text-gray-400">
          Every stock scored 1–100 based on value, quality, growth, and momentum factors.
        </p>

        {/* Filters */}
        <div className="mt-6 mb-4 flex flex-wrap items-center gap-3">
          <select
            value={sector}
            onChange={(e) => { setSector(e.target.value); setPage(1); }}
            className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg text-gray-700 focus:outline-none focus:border-blue-400"
          >
            <option value="">All sectors</option>
            {sectors.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {data && (
            <span className="text-xs text-gray-400">
              {data.totalCount.toLocaleString()} stocks
            </span>
          )}
        </div>

        {/* Error state */}
        {error && (
          <div className="mb-4 flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3">
            <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-gray-100 items-center">
            <div className="col-span-3 text-xs font-medium text-gray-400 uppercase tracking-wider">
              Stock
            </div>
            <div className="col-span-2">
              <SortHeader field="backtest_score" label="Score" />
            </div>
            <div className="col-span-1 text-right">
              <SortHeader field="market_cap" label="Cap" className="text-right" />
            </div>
            <div className="col-span-1 text-right">
              <SortHeader field="pe_ratio" label="P/E" className="text-right" />
            </div>
            <div className="col-span-1 text-right">
              <SortHeader field="roe" label="ROE" className="text-right" />
            </div>
            <div className="col-span-1 text-right hidden md:block">
              <SortHeader field="revenue_growth" label="Rev Gr" className="text-right" />
            </div>
            <div className="col-span-1 text-right hidden md:block">
              <SortHeader field="dividend_yield" label="Yield" className="text-right" />
            </div>
            <div className="col-span-1 text-right text-xs font-medium text-gray-400 uppercase tracking-wider hidden md:block">
              D/E
            </div>
            <div className="col-span-1 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
              Sector
            </div>
          </div>

          {/* Loading state */}
          {loading && (
            <div className="px-4 py-8">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-12 bg-gray-50 rounded animate-pulse mb-2" />
              ))}
            </div>
          )}

          {/* Rows */}
          {!loading && data?.stocks.map((stock) => (
            <div
              key={stock.symbol}
              className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-gray-50 last:border-0 items-center hover:bg-gray-50 transition-colors"
            >
              <div className="col-span-3 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{stock.symbol}</p>
                <p className="text-xs text-gray-400 truncate">{stock.name}</p>
              </div>
              <div className="col-span-2">
                <ScoreBar score={stock.backtestScore} />
              </div>
              <div className="col-span-1 text-right text-sm text-gray-600">
                {formatMarketCap(stock.marketCap)}
              </div>
              <div className="col-span-1 text-right text-sm text-gray-600">
                {formatNum(stock.peRatio)}
              </div>
              <div className="col-span-1 text-right text-sm text-gray-600">
                {formatPct(stock.roe)}
              </div>
              <div className="col-span-1 text-right text-sm text-gray-600 hidden md:block">
                {formatPct(stock.revenueGrowth)}
              </div>
              <div className="col-span-1 text-right text-sm text-gray-600 hidden md:block">
                {formatPct(stock.dividendYield)}
              </div>
              <div className="col-span-1 text-right text-sm text-gray-600 hidden md:block">
                {formatNum(stock.debtToEquity)}
              </div>
              <div className="col-span-1 text-right">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                  {stock.sector}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-6">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-sm text-gray-400">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}

        {/* Score methodology */}
        <details className="mt-6 group">
          <summary className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-600 transition-colors select-none list-none [&::-webkit-details-marker]:hidden">
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
            </svg>
            <span>How the Backtest Score works</span>
            <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </summary>
          <div className="mt-2 text-xs text-gray-500 leading-relaxed pl-5.5 space-y-1">
            <p>Each stock is ranked on 12 factors across value (P/E, P/B, EV/EBITDA), quality (ROE, ROIC, margins), growth (revenue, earnings), cash flow (FCF yield), leverage (D/E), dividends, and momentum.</p>
            <p>Percentile ranks are weighted and combined into a composite score from 1 (weakest) to 100 (strongest). The score reflects today&apos;s metrics — it&apos;s a static snapshot, not a forward prediction.</p>
          </div>
        </details>
      </div>
    </div>
  );
}
