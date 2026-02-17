"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import StockLogo from "./StockLogo";

interface Stock {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
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
  industries: string[];
}

type SortField = "backtest_score" | "market_cap" | "pe_ratio" | "roe" | "earnings_yield" | "earnings_growth" | "revenue_growth" | "dividend_yield";

const POPULAR_TICKERS = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "TSLA", "META", "JPM"];

const THEME_BUTTONS = [
  { id: "ai", label: "AI" },
  { id: "semiconductors", label: "Chips" },
  { id: "data_centers", label: "Data Centers" },
  { id: "cybersecurity", label: "Cybersecurity" },
  { id: "cloud", label: "Cloud" },
  { id: "ev", label: "EVs" },
];

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
  const color = score >= 75 ? "bg-th-positive-bar" : score >= 50 ? "bg-th-accent" : score >= 25 ? "bg-th-warning" : "bg-th-negative";
  return (
    <div className="flex items-center gap-2">
      <div className="w-12 h-2 bg-th-skeleton rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className={`text-sm font-bold ${
        score >= 75 ? "text-th-positive" : score >= 50 ? "text-th-accent" : score >= 25 ? "text-th-warning" : "text-th-negative"
      }`}>
        {score}
      </span>
    </div>
  );
}

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
  const router = useRouter();
  const [data, setData] = useState<ScreenerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("backtest_score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [sector, setSector] = useState("");
  const [industry, setIndustry] = useState("");
  const [theme, setTheme] = useState("");
  const [page, setPage] = useState(1);
  const [sectors, setSectors] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);

  // Market cap filter
  const [minCap, setMinCap] = useState(0);
  const [maxCap, setMaxCap] = useState(0);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Stock[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
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
        ...(industry && { industry }),
        ...(theme && { theme }),
        ...(minCap > 0 && { minCap: String(minCap) }),
        ...(maxCap > 0 && { maxCap: String(maxCap) }),
      });
      const res = await fetch(`/api/screener?${params}`);
      const json = await res.json();
      if (json.error) {
        setError(json.error);
        setData(null);
      } else {
        setData(json);
        if (json.sectors) setSectors(json.sectors);
        if (json.industries) setIndustries(json.industries);
      }
    } catch {
      setError("Failed to load screener data. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [sortField, sortDir, sector, industry, theme, page, minCap, maxCap]);

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

  const navigateToStock = (ticker: string) => {
    setSearchQuery("");
    setShowDropdown(false);
    router.push(`/screener/${ticker}`);
  };

  const setCapFilter = (min: number, max: number) => {
    if (minCap === min && maxCap === max) {
      setMinCap(0);
      setMaxCap(0);
    } else {
      setMinCap(min);
      setMaxCap(max);
    }
    setPage(1);
  };

  const toggleTheme = (id: string) => {
    setTheme(theme === id ? "" : id);
    setPage(1);
  };

  const selectIndustry = (ind: string) => {
    setIndustry(ind);
    setSector("");
    setTheme("");
    setSearchQuery("");
    setShowDropdown(false);
    setPage(1);
  };

  const selectSectorFromSearch = (s: string) => {
    setSector(s);
    setIndustry("");
    setTheme("");
    setSearchQuery("");
    setShowDropdown(false);
    setPage(1);
  };

  const clearAllFilters = () => {
    setSector("");
    setIndustry("");
    setTheme("");
    setMinCap(0);
    setMaxCap(0);
    setPage(1);
  };

  const isCapActive = (min: number, max: number) => minCap === min && maxCap === max;
  const hasActiveFilters = sector || industry || theme || minCap > 0 || maxCap > 0;

  // Client-side filtering for sectors/industries in dropdown
  const q = searchQuery.trim().toLowerCase();
  const matchingSectors = q.length >= 2
    ? sectors.filter((s) => s.toLowerCase().includes(q))
    : [];
  const matchingIndustries = q.length >= 2
    ? industries.filter((ind) => ind.toLowerCase().includes(q)).slice(0, 6)
    : [];

  const SortHeader = ({ field, label, className = "" }: { field: SortField; label: string; className?: string }) => (
    <button
      onClick={() => handleSort(field)}
      className={`group/hdr relative font-medium text-xs uppercase tracking-wider transition-colors ${
        sortField === field ? "text-th-accent" : "text-th-text-3 hover:text-th-text-2"
      } ${className}`}
    >
      {label}
      {sortField === field && (sortDir === "desc" ? " \u2193" : " \u2191")}
      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 hidden group-hover/hdr:block z-10 w-48 px-2 py-1 text-[10px] font-normal normal-case tracking-normal text-white bg-th-tooltip-bg rounded-md shadow-lg pointer-events-none text-left">
        {HEADER_TOOLTIPS[field]}
      </div>
    </button>
  );

  const totalPages = data ? Math.ceil(data.totalCount / data.perPage) : 0;

  return (
    <div className="min-h-screen bg-th-bg px-4 sm:px-6 py-8 sm:py-12">
      <div className="max-w-6xl mx-auto">
        {/* Hero section */}
        <div className="text-center mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-th-text tracking-tight">AI Stock Screener</h1>
          <p className="mt-2 text-sm sm:text-base text-th-text-3 max-w-xl mx-auto">
            Search any stock for AI-powered analysis, or browse all stocks ranked by our multi-factor Backtest Score.
          </p>
        </div>

        {/* Search bar */}
        <div ref={searchRef} className="relative max-w-2xl mx-auto">
          <div className="relative">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-th-text-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by ticker, company, sector, or industry..."
              className="w-full pl-12 pr-4 py-3 text-base bg-th-surface border-2 border-th-border rounded-xl focus:outline-none focus:border-th-focus-border focus:ring-4 focus:ring-th-focus-ring transition-all"
            />
          </div>

          {/* Search dropdown */}
          {showDropdown && (searchResults.length > 0 || matchingSectors.length > 0 || matchingIndustries.length > 0) && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-th-surface rounded-xl border border-th-border shadow-lg z-20 overflow-hidden max-h-[400px] overflow-y-auto">
              {/* Matching sectors */}
              {matchingSectors.length > 0 && (
                <div>
                  <p className="px-4 pt-2 pb-1 text-[10px] font-semibold text-th-text-3 uppercase tracking-wider">Sectors</p>
                  {matchingSectors.map((s) => (
                    <button
                      key={`sector-${s}`}
                      onClick={() => selectSectorFromSearch(s)}
                      className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-th-accent-bg transition-colors min-h-[40px]"
                    >
                      <svg className="w-4 h-4 text-th-text-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z" />
                      </svg>
                      <span className="text-sm text-th-text-2">Filter by sector: <span className="font-medium">{s}</span></span>
                    </button>
                  ))}
                </div>
              )}

              {/* Matching industries */}
              {matchingIndustries.length > 0 && (
                <div>
                  <p className="px-4 pt-2 pb-1 text-[10px] font-semibold text-th-text-3 uppercase tracking-wider">Industries</p>
                  {matchingIndustries.map((ind) => (
                    <button
                      key={`ind-${ind}`}
                      onClick={() => selectIndustry(ind)}
                      className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-th-accent-bg transition-colors min-h-[40px]"
                    >
                      <svg className="w-4 h-4 text-th-text-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z" />
                      </svg>
                      <span className="text-sm text-th-text-2">Filter by industry: <span className="font-medium">{ind}</span></span>
                    </button>
                  ))}
                </div>
              )}

              {/* Matching stocks */}
              {searchResults.length > 0 && (
                <div>
                  {(matchingSectors.length > 0 || matchingIndustries.length > 0) && (
                    <p className="px-4 pt-2 pb-1 text-[10px] font-semibold text-th-text-3 uppercase tracking-wider">Stocks</p>
                  )}
                  {searchResults.map((stock) => (
                    <button
                      key={stock.symbol}
                      onClick={() => navigateToStock(stock.symbol)}
                      className="w-full flex items-center justify-between px-3 sm:px-4 py-2.5 text-left hover:bg-th-hover transition-colors border-b border-th-border-light last:border-0 min-h-[44px]"
                    >
                      <div className="min-w-0 flex items-center gap-2">
                        <StockLogo ticker={stock.symbol} sector={stock.sector} />
                        <span className="text-sm font-semibold text-th-text">{stock.symbol}</span>
                        <span className="text-xs text-th-text-3 truncate hidden sm:inline">{stock.name}</span>
                      </div>
                      <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                        <span className="text-xs text-th-text-3 hidden sm:inline">{stock.sector}</span>
                        <ScoreBar score={stock.backtestScore} />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {showDropdown && searchQuery.trim() && searchResults.length === 0 && matchingSectors.length === 0 && matchingIndustries.length === 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-th-surface rounded-xl border border-th-border shadow-lg z-20 px-4 py-3 text-sm text-th-text-3">
              No results for &ldquo;{searchQuery}&rdquo;
            </div>
          )}
        </div>

        {/* Popular stocks */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <span className="text-xs text-th-text-4">Popular:</span>
          {POPULAR_TICKERS.map((t) => (
            <button
              key={t}
              onClick={() => navigateToStock(t)}
              className="px-3 py-2 sm:py-1.5 text-xs font-medium text-th-text-3 bg-th-surface border border-th-border rounded-lg hover:border-th-accent-border hover:text-th-accent transition-colors min-h-[44px] sm:min-h-0"
            >
              {t}
            </button>
          ))}
        </div>

        {/* Theme buttons */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <span className="text-xs text-th-text-4">Themes:</span>
          {THEME_BUTTONS.map((t) => (
            <button
              key={t.id}
              onClick={() => toggleTheme(t.id)}
              className={`px-3 py-2 sm:py-1.5 text-xs font-medium rounded-lg border transition-all min-h-[44px] sm:min-h-0 ${
                theme === t.id
                  ? "bg-th-accent border-th-accent text-white"
                  : "bg-th-surface border-th-border text-th-text-3 hover:border-th-accent-border hover:text-th-accent"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Filters row */}
        <div className="mt-5 mb-4 flex flex-wrap items-center gap-2 sm:gap-3">
          <select
            value={sector}
            onChange={(e) => { setSector(e.target.value); setIndustry(""); setPage(1); }}
            className="px-3 py-2 text-sm bg-th-surface border border-th-border rounded-lg text-th-text-2 focus:outline-none focus:border-th-focus-border"
          >
            <option value="">All sectors</option>
            {sectors.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <span className="text-xs text-th-text-4 hidden sm:inline">|</span>

          {/* Market cap range presets */}
          {([
            { label: "Small", min: 0.3, max: 2, title: "$300M \u2013 $2B" },
            { label: "Mid", min: 2, max: 10, title: "$2B \u2013 $10B" },
            { label: "Large", min: 10, max: 200, title: "$10B \u2013 $200B" },
            { label: "Mega", min: 200, max: 0, title: "$200B+" },
          ] as const).map((preset) => (
            <button
              key={preset.label}
              onClick={() => setCapFilter(preset.min, preset.max)}
              title={preset.title}
              className={`px-2.5 py-1.5 sm:py-1 text-xs rounded-lg border transition-all ${
                isCapActive(preset.min, preset.max)
                  ? "bg-th-accent-bg border-th-accent-border text-th-accent-text font-medium"
                  : "bg-th-surface border-th-border text-th-text-3 hover:border-th-border hover:text-th-text"
              }`}
            >
              {preset.label}
            </button>
          ))}

          <span className="text-xs text-th-text-4 hidden sm:inline">|</span>

          {([
            { label: ">$10B", min: 10, title: "Market cap above $10B" },
            { label: ">$100B", min: 100, title: "Market cap above $100B" },
          ] as const).map((quick) => (
            <button
              key={quick.label}
              onClick={() => setCapFilter(quick.min, 0)}
              title={quick.title}
              className={`px-2.5 py-1.5 sm:py-1 text-xs rounded-lg border transition-all ${
                isCapActive(quick.min, 0)
                  ? "bg-th-accent-bg border-th-accent-border text-th-accent-text font-medium"
                  : "bg-th-surface border-th-border text-th-text-3 hover:border-th-border hover:text-th-text"
              }`}
            >
              {quick.label}
            </button>
          ))}

          {/* Active filter badges */}
          {industry && (
            <span className="flex items-center gap-1 px-2 py-1 text-xs bg-th-accent-bg border border-th-accent-border text-th-accent-text rounded-lg">
              {industry}
              <button onClick={() => { setIndustry(""); setPage(1); }} className="ml-0.5 hover:text-th-accent-text">&times;</button>
            </span>
          )}

          {hasActiveFilters && (
            <button
              onClick={clearAllFilters}
              className="px-2 py-1 text-xs text-th-text-3 hover:text-th-text-2 transition-colors"
            >
              Clear all
            </button>
          )}

          {data && (
            <span className="text-xs text-th-text-3 ml-auto">
              {data.totalCount.toLocaleString()} stocks
            </span>
          )}
        </div>

        {/* Error state */}
        {error && (
          <div className="mb-4 flex items-start gap-2 text-sm text-th-negative bg-th-negative-bg border border-th-negative-border rounded-lg px-4 py-3">
            <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Table */}
        <div className="bg-th-surface rounded-2xl border border-th-border-light overflow-x-auto">
          <div className="min-w-[600px]">
          {/* Header */}
          <div className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-th-border-light items-center">
            <div className="col-span-3 text-xs font-medium text-th-text-3 uppercase tracking-wider">
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
            <div className="col-span-1 text-right text-xs font-medium text-th-text-3 uppercase tracking-wider hidden md:block group/hdr relative cursor-help">
              D/E
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 hidden group-hover/hdr:block z-10 w-48 px-2 py-1 text-[10px] font-normal normal-case tracking-normal text-white bg-th-tooltip-bg rounded-md shadow-lg pointer-events-none text-left">
                {HEADER_TOOLTIPS.de}
              </div>
            </div>
            <div className="col-span-1 text-right text-xs font-medium text-th-text-3 uppercase tracking-wider">
              Sector
            </div>
          </div>

          {/* Loading state */}
          {loading && (
            <div className="px-4 py-8">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-12 bg-th-inset rounded animate-pulse mb-2" />
              ))}
            </div>
          )}

          {/* Rows */}
          {!loading && data?.stocks?.map((stock) => (
            <button
              key={stock.symbol}
              onClick={() => navigateToStock(stock.symbol)}
              className="w-full grid grid-cols-12 gap-2 px-4 py-3 border-b border-th-border-light last:border-0 items-center hover:bg-th-accent-bg/40 transition-colors text-left cursor-pointer min-h-[44px]"
            >
              <div className="col-span-3 min-w-0 flex items-center gap-2">
                <StockLogo ticker={stock.symbol} sector={stock.sector} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-th-text truncate">{stock.symbol}</p>
                  <p className="text-xs text-th-text-3 truncate">{stock.name}</p>
                </div>
              </div>
              <div className="col-span-2">
                <ScoreBar score={stock.backtestScore} />
              </div>
              <div className="col-span-1 text-right text-sm text-th-text-2">
                {formatMarketCap(stock.marketCap)}
              </div>
              <div className="col-span-1 text-right text-sm text-th-text-2">
                {formatPct(stock.earningsYield)}
              </div>
              <div className="col-span-1 text-right text-sm text-th-text-2">
                {formatNum(stock.peRatio)}
              </div>
              <div className="col-span-1 text-right text-sm text-th-text-2 hidden md:block">
                {formatPct(stock.earningsGrowth)}
              </div>
              <div className="col-span-1 text-right text-sm text-th-text-2 hidden md:block">
                {formatPct(stock.roe)}
              </div>
              <div className="col-span-1 text-right text-sm text-th-text-2 hidden md:block">
                {formatNum(stock.debtToEquity)}
              </div>
              <div className="col-span-1 text-right">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-th-skeleton text-th-text-3">
                  {stock.sector}
                </span>
              </div>
            </button>
          ))}
          </div>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-6">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-4 py-2.5 sm:px-3 sm:py-1.5 text-sm text-th-text-2 bg-th-surface border border-th-border rounded-lg hover:bg-th-hover disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]"
            >
              Previous
            </button>
            <span className="text-sm text-th-text-3">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-4 py-2.5 sm:px-3 sm:py-1.5 text-sm text-th-text-2 bg-th-surface border border-th-border rounded-lg hover:bg-th-hover disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]"
            >
              Next
            </button>
          </div>
        )}

        {/* Score methodology + disclaimer */}
        <details className="mt-6 group">
          <summary className="flex items-center gap-2 text-xs text-th-text-3 cursor-pointer hover:text-th-text-2 transition-colors select-none list-none [&::-webkit-details-marker]:hidden">
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
            </svg>
            <span>How the Backtest Score works</span>
            <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </summary>
          <div className="mt-2 text-xs text-th-text-3 leading-relaxed pl-5.5 space-y-1">
            <p>Each stock is ranked on 12 factors with heavy emphasis on <strong>earnings yield</strong> (net profit / market cap), <strong>earnings consistency</strong> (consecutive years of growing net income), and <strong>earnings growth</strong>. Additional factors include P/E, EV/EBITDA, ROE, ROIC, profit margin, revenue growth, FCF yield, leverage (D/E), and a <strong>size confidence</strong> adjustment (log market cap) that adds healthy skepticism for smaller, less-proven companies.</p>
            <p>Percentile ranks are weighted and combined into a composite score from 1 (weakest) to 100 (strongest). The score reflects today&apos;s metrics &mdash; it&apos;s a static snapshot, not a forward prediction.</p>
          </div>
        </details>

        <p className="text-center mt-4 text-[10px] text-th-text-4">
          AI-generated analysis uses current data. Not financial advice. Always do your own research.
        </p>
      </div>
    </div>
  );
}
