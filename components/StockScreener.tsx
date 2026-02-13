"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface Stock {
  symbol: string;
  name: string;
  sector: string;
  marketCap: number;
  peRatio: number | null;
  roe: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  earningsYield: number | null;
  profitMargin: number | null;
  dividendYield: number | null;
  debtToEquity: number | null;
  beta: number | null;
  evToEbitda: number | null;
  freeCashFlowYield: number | null;
  consecutiveEarningsGrowth: number;
  currentRatio: number | null;
  backtestScore: number;
}

interface ScreenerData {
  stocks: Stock[];
  totalCount: number;
  page: number;
  perPage: number;
  sectors: string[];
}

type SortField = "backtest_score" | "market_cap" | "pe_ratio" | "roe" | "earnings_yield" | "earnings_growth" | "revenue_growth" | "dividend_yield";

function formatMarketCap(b: number): string {
  if (b >= 1000) return `$${(b / 1000).toFixed(1)}T`;
  if (b >= 1) return `$${b.toFixed(1)}B`;
  return `$${(b * 1000).toFixed(0)}M`;
}

function formatPct(v: number | null): string {
  if (v === null) return "\u2014";
  return `${(v * 100).toFixed(1)}%`;
}

function formatNum(v: number | null, decimals = 1): string {
  if (v === null) return "\u2014";
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

// ── Metric helpers for profile card ──
const PROFILE_METRICS: { key: keyof Stock; label: string; format: (v: number | null) => string; tooltip: string }[] = [
  { key: "earningsYield", label: "Earnings Yield", format: formatPct, tooltip: "Net income / market cap. Higher means more profit per dollar invested." },
  { key: "peRatio", label: "P/E", format: (v) => formatNum(v), tooltip: "Price / Earnings. Lower may indicate better value." },
  { key: "earningsGrowth", label: "Earnings Gr.", format: formatPct, tooltip: "Year-over-year growth in net income." },
  { key: "consecutiveEarningsGrowth", label: "Earn. Streak", format: (v) => v !== null ? `${v}yr` : "\u2014", tooltip: "Consecutive years of net income growth." },
  { key: "roe", label: "ROE", format: formatPct, tooltip: "Return on equity. Profit generated per dollar of shareholder equity." },
  { key: "profitMargin", label: "Margin", format: formatPct, tooltip: "Net profit margin. Percentage of revenue kept as profit." },
  { key: "freeCashFlowYield", label: "FCF Yield", format: formatPct, tooltip: "Free cash flow / market cap. Cash generation relative to price." },
  { key: "revenueGrowth", label: "Rev. Gr.", format: formatPct, tooltip: "Year-over-year revenue growth rate." },
  { key: "evToEbitda", label: "EV/EBITDA", format: (v) => formatNum(v), tooltip: "Enterprise value / EBITDA. Lower may indicate better value." },
  { key: "debtToEquity", label: "D/E", format: (v) => formatNum(v), tooltip: "Debt to equity ratio. Lower means less leveraged." },
  { key: "dividendYield", label: "Div. Yield", format: formatPct, tooltip: "Annual dividend / share price." },
  { key: "beta", label: "Beta", format: (v) => formatNum(v, 2), tooltip: "Volatility relative to the market. 1.0 = market average." },
];

function StockProfileCard({ stock, onClose }: { stock: Stock; onClose: () => void }) {
  return (
    <div className="mb-4 bg-white rounded-2xl border border-blue-100 p-5 animate-in fade-in duration-200">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-gray-900">{stock.symbol}</h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{stock.sector}</span>
          </div>
          <p className="text-sm text-gray-400">{stock.name}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-xs text-gray-400">Score</p>
            <ScoreBar score={stock.backtestScore} />
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">MCap</p>
            <p className="text-sm font-semibold text-gray-700">{formatMarketCap(stock.marketCap)}</p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-300 hover:text-gray-500 transition-colors" title="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
        {PROFILE_METRICS.map((m) => (
          <div key={m.key} className="group relative">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">{m.label}</p>
            <p className="text-sm font-semibold text-gray-800">{m.format(stock[m.key] as number | null)}</p>
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 hidden group-hover:block z-10 w-48 px-2 py-1 text-[10px] text-white bg-gray-800 rounded-md shadow-lg pointer-events-none">
              {m.tooltip}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Header tooltips ──
const HEADER_TOOLTIPS: Record<string, string> = {
  backtest_score: "Composite 1\u2013100 score based on earnings yield, growth, consistency, value, quality, and leverage factors.",
  market_cap: "Market capitalization \u2014 total value of all outstanding shares.",
  pe_ratio: "Price / Earnings \u2014 share price divided by earnings per share. Lower may indicate better value.",
  roe: "Return on Equity \u2014 net income divided by shareholder equity. Measures profit efficiency.",
  earnings_yield: "Earnings Yield \u2014 net income / market cap. Higher means more profit per dollar of market value.",
  earnings_growth: "Earnings Growth \u2014 year-over-year growth in net income.",
  revenue_growth: "Revenue Growth \u2014 year-over-year growth in total revenue.",
  dividend_yield: "Dividend Yield \u2014 annual dividend payment as a percentage of share price.",
  de: "Debt to Equity \u2014 total debt divided by shareholder equity. Lower means less leverage.",
};

export default function StockScreener() {
  const [data, setData] = useState<ScreenerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("backtest_score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [sector, setSector] = useState("");
  const [page, setPage] = useState(1);
  const [sectors, setSectors] = useState<string[]>([]);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Stock[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

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

  // Search with debounce
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/screener?search=${encodeURIComponent(searchQuery.trim())}`);
        const json = await res.json();
        if (json.stocks) {
          setSearchResults(json.stocks);
          setShowDropdown(true);
        }
      } catch { /* ignore */ }
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
    setPage(1);
  };

  const selectStock = (stock: Stock) => {
    setSelectedStock(stock);
    setSearchQuery("");
    setShowDropdown(false);
  };

  const SortHeader = ({ field, label, className = "" }: { field: SortField; label: string; className?: string }) => (
    <button
      onClick={() => handleSort(field)}
      className={`group/hdr relative font-medium text-xs uppercase tracking-wider transition-colors ${
        sortField === field ? "text-blue-600" : "text-gray-400 hover:text-gray-600"
      } ${className}`}
      title={HEADER_TOOLTIPS[field]}
    >
      {label}
      {sortField === field && (sortDir === "desc" ? " \u2193" : " \u2191")}
      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 hidden group-hover/hdr:block z-10 w-48 px-2 py-1 text-[10px] font-normal normal-case tracking-normal text-white bg-gray-800 rounded-md shadow-lg pointer-events-none text-left">
        {HEADER_TOOLTIPS[field]}
      </div>
    </button>
  );

  const totalPages = data ? Math.ceil(data.totalCount / data.perPage) : 0;

  return (
    <div className="min-h-screen bg-gray-50/50 px-6 py-12">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Stock Screener</h1>
        <p className="mt-2 text-gray-400">
          Every stock scored 1&ndash;100 based on earnings power, growth consistency, value, and quality factors.
        </p>

        {/* Search bar */}
        <div ref={searchRef} className="relative mt-6">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by ticker or company name..."
              className="w-full pl-10 pr-4 py-2.5 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-all"
            />
          </div>
          {/* Search dropdown */}
          {showDropdown && searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl border border-gray-200 shadow-lg z-20 overflow-hidden">
              {searchResults.map((stock) => (
                <button
                  key={stock.symbol}
                  onClick={() => selectStock(stock)}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-semibold text-gray-900">{stock.symbol}</span>
                    <span className="text-xs text-gray-400 ml-2 truncate">{stock.name}</span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs text-gray-400">{stock.sector}</span>
                    <ScoreBar score={stock.backtestScore} />
                  </div>
                </button>
              ))}
            </div>
          )}
          {showDropdown && searchQuery.trim() && searchResults.length === 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl border border-gray-200 shadow-lg z-20 px-4 py-3 text-sm text-gray-400">
              No stocks found for &ldquo;{searchQuery}&rdquo;
            </div>
          )}
        </div>

        {/* Profile card */}
        {selectedStock && (
          <div className="mt-4">
            <StockProfileCard stock={selectedStock} onClose={() => setSelectedStock(null)} />
          </div>
        )}

        {/* Filters */}
        <div className="mt-4 mb-4 flex flex-wrap items-center gap-3">
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
              <SortHeader field="market_cap" label="MCap" className="text-right" />
            </div>
            <div className="col-span-1 text-right">
              <SortHeader field="earnings_yield" label="Earn Yld" className="text-right" />
            </div>
            <div className="col-span-1 text-right">
              <SortHeader field="pe_ratio" label="P/E" className="text-right" />
            </div>
            <div className="col-span-1 text-right hidden md:block">
              <SortHeader field="earnings_growth" label="NI Gr." className="text-right" />
            </div>
            <div className="col-span-1 text-right hidden md:block">
              <SortHeader field="roe" label="ROE" className="text-right" />
            </div>
            <div className="col-span-1 text-right text-xs font-medium text-gray-400 uppercase tracking-wider hidden md:block group/hdr relative cursor-help" title={HEADER_TOOLTIPS.de}>
              D/E
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 hidden group-hover/hdr:block z-10 w-48 px-2 py-1 text-[10px] font-normal normal-case tracking-normal text-white bg-gray-800 rounded-md shadow-lg pointer-events-none text-left">
                {HEADER_TOOLTIPS.de}
              </div>
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
          {!loading && data?.stocks?.map((stock) => (
            <button
              key={stock.symbol}
              onClick={() => selectStock(stock)}
              className="w-full grid grid-cols-12 gap-2 px-4 py-3 border-b border-gray-50 last:border-0 items-center hover:bg-blue-50/40 transition-colors text-left cursor-pointer"
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
                {formatPct(stock.earningsYield)}
              </div>
              <div className="col-span-1 text-right text-sm text-gray-600">
                {formatNum(stock.peRatio)}
              </div>
              <div className="col-span-1 text-right text-sm text-gray-600 hidden md:block">
                {formatPct(stock.earningsGrowth)}
              </div>
              <div className="col-span-1 text-right text-sm text-gray-600 hidden md:block">
                {formatPct(stock.roe)}
              </div>
              <div className="col-span-1 text-right text-sm text-gray-600 hidden md:block">
                {formatNum(stock.debtToEquity)}
              </div>
              <div className="col-span-1 text-right">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                  {stock.sector}
                </span>
              </div>
            </button>
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
            <p>Each stock is ranked on 11 factors with heavy emphasis on <strong>earnings yield</strong> (net profit / market cap), <strong>earnings growth</strong>, and <strong>earnings consistency</strong> (consecutive years of growing net income). Additional factors include P/E, EV/EBITDA, ROE, ROIC, profit margin, revenue growth, FCF yield, and leverage (D/E).</p>
            <p>Percentile ranks are weighted and combined into a composite score from 1 (weakest) to 100 (strongest). The score reflects today&apos;s metrics &mdash; it&apos;s a static snapshot, not a forward prediction.</p>
          </div>
        </details>
      </div>
    </div>
  );
}
