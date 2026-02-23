"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useUser } from "@clerk/nextjs";
import StockLogo from "./StockLogo";
import LoginGate from "./LoginGate";

// ── Types ──

interface Holding {
  symbol: string;
  shares: number;
  costBasis?: number;
}

interface EnrichedHolding {
  symbol: string;
  name: string;
  shares: number;
  currentPrice: number;
  currentValue: number;
  costBasis: number | null;
  costBasisTotal: number | null;
  gainLoss: number | null;
  gainLossPct: number | null;
  sector: string;
}

interface SectorBreakdown {
  sector: string;
  value: number;
  pct: number;
}

interface AnalysisResult {
  holdings: EnrichedHolding[];
  summary: {
    totalValue: number;
    totalCostBasis: number | null;
    totalGainLoss: number | null;
    holdingCount: number;
    weightedBeta: number;
    sectorBreakdown: SectorBreakdown[];
    concentrationRisk: { symbol: string; pct: number }[];
  };
  aiAnalysis: string | null;
  priceNote: string;
}

interface ImportSummary {
  totalHoldings: number;
  brokersDetected: string[];
  accountsDetected: string[];
  skippedRows: number;
}

// ── Broker export instructions ──

const BROKER_INSTRUCTIONS = [
  {
    name: "Fidelity",
    steps: "Accounts & Trade → Portfolio → Positions → Download icon (top right) → CSV",
  },
  {
    name: "Charles Schwab",
    steps: "Accounts → Positions → Export → CSV",
  },
  {
    name: "E*TRADE / Morgan Stanley",
    steps: "Portfolio tab → Export → CSV",
  },
  {
    name: "Merrill Edge",
    steps: "Accounts → Account Resources → Download Account Data → Spreadsheets and Text → CSV",
  },
  {
    name: "Vanguard",
    steps: "Portfolio Watch → Download",
  },
  {
    name: "Robinhood",
    steps: 'Account → History → Export All (CSV sent via email). For current positions, use the "Export Portfolio" Chrome extension.',
  },
  {
    name: "Webull",
    steps: "Account page → Export icon (top right) → CSV sent to email. Or export from the app's Positions page.",
  },
  {
    name: "Interactive Brokers",
    steps: "Reports → Statements → Activity → CSV format. We parse the Open Positions section automatically.",
  },
  {
    name: "SoFi",
    steps: "Account → Transaction History → Export",
  },
];

// Consolidated holding with optional lot breakdown
interface ConsolidatedHolding {
  symbol: string;
  name: string;
  totalShares: number;
  currentPrice: number;
  currentValue: number;
  avgCostBasis: number | null;
  totalCostBasis: number | null;
  gainLoss: number | null;
  gainLossPct: number | null;
  sector: string;
  lots: EnrichedHolding[];
}

// ── Sector colors for allocation chart ──
const SECTOR_COLORS: Record<string, string> = {
  Technology: "bg-th-accent",
  Healthcare: "bg-emerald-500",
  Financial: "bg-th-warning",
  Energy: "bg-orange-500",
  Consumer: "bg-violet-500",
  Industrials: "bg-slate-500",
  "Basic Materials": "bg-yellow-600",
  "Real Estate": "bg-purple-500",
  Utilities: "bg-teal-500",
  "Communication Services": "bg-indigo-500",
  "Index Fund": "bg-cyan-500",
  Unknown: "bg-gray-400",
  Other: "bg-gray-500",
};

// ── Helpers ──

function formatCurrency(v: number): string {
  if (Math.abs(v) >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function consolidateHoldings(holdings: EnrichedHolding[]): ConsolidatedHolding[] {
  const groups: Record<string, EnrichedHolding[]> = {};
  for (const h of holdings) {
    if (!groups[h.symbol]) groups[h.symbol] = [];
    groups[h.symbol].push(h);
  }

  return Object.entries(groups).map(([symbol, lots]) => {
    const totalShares = lots.reduce((s, l) => s + l.shares, 0);
    const currentValue = lots.reduce((s, l) => s + l.currentValue, 0);
    const totalCostBasis = lots.reduce((s, l) => s + (l.costBasisTotal || 0), 0);
    const hasCostBasis = lots.some((l) => l.costBasisTotal !== null);
    const avgCostBasis = hasCostBasis && totalShares > 0
      ? Math.round((totalCostBasis / totalShares) * 100) / 100
      : null;
    const gainLoss = hasCostBasis ? currentValue - totalCostBasis : null;
    const gainLossPct = hasCostBasis && totalCostBasis > 0
      ? (currentValue - totalCostBasis) / totalCostBasis
      : null;

    return {
      symbol,
      name: lots[0].name,
      totalShares,
      currentPrice: lots[0].currentPrice,
      currentValue,
      avgCostBasis,
      totalCostBasis: hasCostBasis ? totalCostBasis : null,
      gainLoss,
      gainLossPct,
      sector: lots[0].sector,
      lots,
    };
  }).sort((a, b) => b.currentValue - a.currentValue);
}

/** Lightweight markdown → React renderer for AI analysis */
function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];
  let key = 0;

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(<ul key={key++} className="list-disc pl-5 space-y-1.5 my-2">{listItems}</ul>);
      listItems = [];
    }
  };

  const inlineFormat = (str: string): React.ReactNode => {
    // Handle **bold**, *italic*
    const parts: React.ReactNode[] = [];
    const remaining = str;
    let i = 0;
    const regex = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
    let match;
    let lastIndex = 0;
    while ((match = regex.exec(remaining)) !== null) {
      if (match.index > lastIndex) {
        parts.push(remaining.slice(lastIndex, match.index));
      }
      if (match[2]) {
        parts.push(<strong key={i++} className="font-semibold text-th-text">{match[2]}</strong>);
      } else if (match[3]) {
        parts.push(<em key={i++} className="italic text-th-text-3">{match[3]}</em>);
      }
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < remaining.length) {
      parts.push(remaining.slice(lastIndex));
    }
    return parts.length === 1 ? parts[0] : <>{parts}</>;
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("## ")) {
      flushList();
      elements.push(
        <h3 key={key++} className="text-sm font-bold text-th-text mt-5 mb-2 first:mt-0">
          {inlineFormat(trimmed.slice(3))}
        </h3>
      );
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      listItems.push(
        <li key={key++} className="text-sm text-th-text-2 leading-relaxed">
          {inlineFormat(trimmed.slice(2))}
        </li>
      );
    } else if (trimmed === "") {
      flushList();
    } else {
      flushList();
      elements.push(
        <p key={key++} className="text-sm text-th-text-2 leading-relaxed my-1.5">
          {inlineFormat(trimmed)}
        </p>
      );
    }
  }
  flushList();
  return elements;
}

// ── Sub-components ──

function HoldingEntryRow({
  holding,
  onUpdate,
  onRemove,
}: {
  holding: Holding;
  onUpdate: (h: Holding) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <input
        type="text"
        value={holding.symbol}
        onChange={(e) => onUpdate({ ...holding, symbol: e.target.value.toUpperCase() })}
        placeholder="AAPL"
        className="w-20 sm:w-24 px-2 sm:px-3 py-2 text-sm font-mono bg-th-surface border border-th-border rounded-lg focus:outline-none focus:border-th-focus-border uppercase"
      />
      <input
        type="number"
        value={holding.shares || ""}
        onChange={(e) => onUpdate({ ...holding, shares: Number(e.target.value) || 0 })}
        placeholder="Shares"
        className="w-20 sm:w-24 px-2 sm:px-3 py-2 text-sm bg-th-surface border border-th-border rounded-lg focus:outline-none focus:border-th-focus-border"
      />
      <input
        type="number"
        value={holding.costBasis || ""}
        onChange={(e) => onUpdate({ ...holding, costBasis: Number(e.target.value) || undefined })}
        placeholder="Avg cost"
        step="0.01"
        className="w-24 sm:w-28 px-2 sm:px-3 py-2 text-sm bg-th-surface border border-th-border rounded-lg focus:outline-none focus:border-th-focus-border"
      />
      <button
        onClick={onRemove}
        className="p-2 sm:p-1.5 text-th-text-4 hover:text-th-negative transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
        title="Remove"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function SectorBar({ breakdown }: { breakdown: SectorBreakdown[] }) {
  return (
    <div>
      <div className="flex rounded-lg overflow-hidden h-5">
        {breakdown.map((s) => (
          <div
            key={s.sector}
            className={`${SECTOR_COLORS[s.sector] || "bg-gray-400"} transition-all`}
            style={{ width: `${Math.max(s.pct * 100, 1)}%` }}
            title={`${s.sector}: ${(s.pct * 100).toFixed(1)}%`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {breakdown.map((s) => (
          <div key={s.sector} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-sm ${SECTOR_COLORS[s.sector] || "bg-gray-400"}`} />
            <span className="text-xs text-th-text-3">
              {s.sector} {(s.pct * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <span className="relative group cursor-help">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 px-3 py-2 text-xs text-th-text-2 bg-th-surface border border-th-border rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-50 text-left leading-relaxed">
        {text}
      </span>
    </span>
  );
}

function HoldingsTableHeader() {
  return (
    <div className="grid grid-cols-12 gap-2 px-4 sm:px-6 py-2 border-b border-th-border-light">
      {/* Always reserve caret space (w-3 + gap) for alignment */}
      <div className="col-span-3 min-w-0 flex items-center gap-2">
        <span className="w-3 shrink-0" />
        <span className="text-[10px] font-medium text-th-text-3 uppercase tracking-wider">Holding</span>
      </div>
      <div className="col-span-1 text-right">
        <span className="text-[10px] font-medium text-th-text-3 uppercase tracking-wider">Shares</span>
      </div>
      <div className="col-span-2 text-right">
        <span className="text-[10px] font-medium text-th-text-3 uppercase tracking-wider">Avg Cost</span>
      </div>
      <div className="col-span-2 text-right">
        <span className="text-[10px] font-medium text-th-text-3 uppercase tracking-wider">Price</span>
      </div>
      <div className="col-span-2 text-right">
        <span className="text-[10px] font-medium text-th-text-3 uppercase tracking-wider">Value</span>
      </div>
      <div className="col-span-2 text-right">
        <span className="text-[10px] font-medium text-th-text-3 uppercase tracking-wider">Gain/Loss</span>
      </div>
    </div>
  );
}

function ConsolidatedHoldingRow({
  holding,
  totalValue,
  score,
}: {
  holding: ConsolidatedHolding;
  totalValue: number;
  score: number | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasMultipleLots = holding.lots.length > 1;

  return (
    <div>
      <div
        className={`grid grid-cols-12 gap-2 px-4 sm:px-6 py-3 items-center ${hasMultipleLots ? "cursor-pointer hover:bg-th-bg/50" : ""}`}
        onClick={hasMultipleLots ? () => setExpanded(!expanded) : undefined}
      >
        {/* Holding — always reserve caret space for alignment */}
        <div className="col-span-3 min-w-0 flex items-center gap-2">
          <span className="w-3 shrink-0 flex items-center justify-center">
            {hasMultipleLots && (
              <svg
                className={`w-3 h-3 text-th-text-3 transition-transform ${expanded ? "rotate-90" : ""}`}
                fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            )}
          </span>
          <StockLogo ticker={holding.symbol} sector={holding.sector} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold text-th-text">{holding.symbol}</p>
              {score !== undefined && (
                <span className={`text-[10px] font-bold px-1 py-0.5 rounded ${
                  score >= 75 ? "bg-th-positive-bg text-th-positive" :
                  score >= 50 ? "bg-th-accent-bg text-th-accent" :
                  score >= 25 ? "bg-th-warning-bg text-th-warning" :
                  "bg-th-negative-bg text-th-negative"
                }`}>{score}</span>
              )}
              {hasMultipleLots && (
                <span className="text-[10px] text-th-text-4 font-medium">{holding.lots.length} lots</span>
              )}
            </div>
            <p className="text-xs text-th-text-3 truncate">{holding.name}</p>
          </div>
        </div>
        {/* Shares */}
        <div className="col-span-1 text-right">
          <p className="text-sm text-th-text-2">{holding.totalShares.toLocaleString(undefined, { maximumFractionDigits: 3 })}</p>
        </div>
        {/* Avg Cost */}
        <div className="col-span-2 text-right">
          {holding.avgCostBasis !== null ? (
            <p className="text-sm text-th-text-2">${holding.avgCostBasis.toFixed(2)}</p>
          ) : (
            <span className="text-xs text-th-text-4">--</span>
          )}
        </div>
        {/* Price */}
        <div className="col-span-2 text-right">
          <p className="text-sm text-th-text-2">${holding.currentPrice.toFixed(2)}</p>
        </div>
        {/* Value + Weight */}
        <div className="col-span-2 text-right">
          <p className="text-sm font-medium text-th-text">{formatCurrency(holding.currentValue)}</p>
          <p className="text-xs text-th-text-3">
            {totalValue > 0 ? `${((holding.currentValue / totalValue) * 100).toFixed(1)}%` : ""}
          </p>
        </div>
        {/* Gain/Loss */}
        <div className="col-span-2 text-right">
          {holding.gainLoss !== null ? (
            <>
              <p className={`text-sm font-medium ${holding.gainLoss >= 0 ? "text-th-positive" : "text-th-negative"}`}>
                {holding.gainLoss >= 0 ? "+" : ""}{formatCurrency(holding.gainLoss)}
              </p>
              <p className={`text-xs ${(holding.gainLossPct ?? 0) >= 0 ? "text-th-positive" : "text-th-negative"}`}>
                {(holding.gainLossPct ?? 0) >= 0 ? "+" : ""}{((holding.gainLossPct ?? 0) * 100).toFixed(1)}%
              </p>
            </>
          ) : (
            <span className="text-xs text-th-text-4">--</span>
          )}
        </div>
      </div>

      {/* Expanded lot breakdown */}
      {expanded && hasMultipleLots && (
        <div className="bg-th-bg/30 border-t border-th-border-light">
          {holding.lots.map((lot, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 px-4 sm:px-6 py-2 items-center">
              <div className="col-span-3 min-w-0 flex items-center gap-2">
                <span className="w-3 shrink-0" />
                <span className="w-6 shrink-0" />
                <p className="text-xs text-th-text-3">Lot {i + 1}</p>
              </div>
              <div className="col-span-1 text-right">
                <p className="text-xs text-th-text-3">{lot.shares.toLocaleString(undefined, { maximumFractionDigits: 3 })}</p>
              </div>
              <div className="col-span-2 text-right">
                {lot.costBasis !== null ? (
                  <p className="text-xs text-th-text-3">${lot.costBasis.toFixed(2)}</p>
                ) : (
                  <span className="text-xs text-th-text-4">--</span>
                )}
              </div>
              <div className="col-span-2 text-right" />
              <div className="col-span-2 text-right">
                <p className="text-xs text-th-text-3">{formatCurrency(lot.currentValue)}</p>
              </div>
              <div className="col-span-2 text-right">
                {lot.gainLoss !== null ? (
                  <p className={`text-xs ${lot.gainLoss >= 0 ? "text-th-positive" : "text-th-negative"}`}>
                    {lot.gainLoss >= 0 ? "+" : ""}{formatCurrency(lot.gainLoss)}
                  </p>
                ) : (
                  <span className="text-xs text-th-text-4">--</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ──

interface SavedPortfolioItem {
  id: string;
  name: string;
  holdings: Holding[];
  analysis: AnalysisResult | null;
  created_at: string;
}

const HOLDINGS_STORAGE_KEY = "portfolio_holdings_draft";

export default function PortfolioAnalyzer() {
  const { isSignedIn } = useUser();
  const isGuest = !isSignedIn;
  const [holdings, setHoldings] = useState<Holding[]>([{ symbol: "", shares: 0 }]);
  const [profile, setProfile] = useState<{ age?: number; netWorth?: string; riskTolerance?: string }>({});
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const holdingsRef = useRef<HTMLDivElement>(null);
  const [stockScores, setStockScores] = useState<Map<string, number>>(new Map());
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [selectedBroker, setSelectedBroker] = useState("");

  // Saved portfolios
  const [savedPortfolios, setSavedPortfolios] = useState<SavedPortfolioItem[]>([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [savingPortfolio, setSavingPortfolio] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Restore holdings from sessionStorage on mount (survives login redirect)
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(HOLDINGS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Holding[];
        if (Array.isArray(parsed) && parsed.length > 0 && parsed.some(h => h.symbol)) {
          setHoldings(parsed);
          sessionStorage.removeItem(HOLDINGS_STORAGE_KEY);
        }
      }
    } catch { /* ignore */ }
  }, []);

  // Save holdings to sessionStorage on change (for login persistence)
  useEffect(() => {
    const hasData = holdings.some(h => h.symbol.trim());
    if (hasData) {
      try { sessionStorage.setItem(HOLDINGS_STORAGE_KEY, JSON.stringify(holdings)); } catch { /* ignore */ }
    }
  }, [holdings]);

  // Fetch saved portfolios for logged-in users
  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/portfolio/saved");
        const data = await res.json();
        if (!cancelled && data.portfolios) {
          setSavedPortfolios(data.portfolios.map((p: Record<string, unknown>) => ({
            id: p.id as string,
            name: p.name as string,
            holdings: p.holdings as Holding[],
            analysis: p.analysis as AnalysisResult | null,
            created_at: p.created_at as string,
          })));
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [isSignedIn]);

  const handleSavePortfolio = useCallback(async () => {
    if (!saveName.trim() || !result) return;
    setSavingPortfolio(true);
    try {
      const res = await fetch("/api/portfolio/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: saveName.trim(), holdings, analysis: result }),
      });
      const data = await res.json();
      if (res.ok) {
        setSavedPortfolios(prev => [{
          id: data.id,
          name: saveName.trim(),
          holdings,
          analysis: result,
          created_at: data.created_at,
        }, ...prev]);
        setSavedSuccess(true);
        setShowSaveDialog(false);
        setSaveName("");
        setTimeout(() => setSavedSuccess(false), 3000);
      }
    } catch { /* ignore */ }
    setSavingPortfolio(false);
  }, [saveName, result, holdings]);

  const handleDeletePortfolio = useCallback(async (id: string) => {
    setDeletingId(id);
    try {
      await fetch(`/api/portfolio/saved?id=${id}`, { method: "DELETE" });
      setSavedPortfolios(prev => prev.filter(p => p.id !== id));
    } catch { /* ignore */ }
    setDeletingId(null);
  }, []);

  const handleLoadPortfolio = useCallback((portfolio: SavedPortfolioItem) => {
    setHoldings(portfolio.holdings);
    if (portfolio.analysis) {
      setResult(portfolio.analysis);
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }, []);

  // Fetch backtest scores for portfolio holdings
  useEffect(() => {
    if (!result || result.holdings.length === 0) {
      setStockScores(new Map());
      return;
    }
    const tickers = Array.from(new Set(result.holdings.map((h) => h.symbol)));
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/screener?tickers=${tickers.join(",")}`);
        const json = await res.json();
        if (!cancelled && json.stocks) {
          const scores = new Map<string, number>();
          for (const stock of json.stocks) {
            scores.set(stock.symbol, stock.backtestScore);
          }
          setStockScores(scores);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [result]);

  const consolidated = result ? consolidateHoldings(result.holdings) : [];

  const updateHolding = (index: number, h: Holding) => {
    const updated = [...holdings];
    updated[index] = h;
    setHoldings(updated);
  };

  const removeHolding = (index: number) => {
    if (holdings.length === 1) return;
    setHoldings(holdings.filter((_, i) => i !== index));
  };

  const addHolding = () => {
    setHoldings([...holdings, { symbol: "", shares: 0 }]);
  };

  const handleCSVImport = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    // Validate
    if (fileArray.length > 5) {
      setError("Maximum 5 files allowed.");
      return;
    }
    for (const f of fileArray) {
      const name = f.name.toLowerCase();
      if (!name.endsWith(".csv") && !name.endsWith(".xlsx") && !name.endsWith(".xls")) {
        setError(`"${f.name}" is not a CSV or XLSX file.`);
        return;
      }
      if (f.size > 10 * 1024 * 1024) {
        setError(`"${f.name}" exceeds the 10 MB limit.`);
        return;
      }
    }

    setImportLoading(true);
    setError(null);
    setImportSummary(null);
    setImportWarnings([]);

    try {
      const formData = new FormData();
      for (const f of fileArray) {
        formData.append("files", f);
      }

      const res = await fetch("/api/portfolio/import", { method: "POST", body: formData });
      const data = await res.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      if (data.warnings && data.warnings.length > 0) {
        setImportWarnings(data.warnings);
      }

      if (data.holdings && data.holdings.length > 0) {
        // Map imported holdings to the form schema
        setHoldings(
          data.holdings
            .filter((h: { assetType?: string }) => h.assetType !== "cash")
            .map((h: { symbol?: string; quantity?: number; averageCostPerShare?: number | null }) => ({
              symbol: (h.symbol || "").toUpperCase(),
              shares: h.quantity || 0,
              costBasis: h.averageCostPerShare ?? undefined,
            }))
        );
        setImportSummary(data.summary);
        setResult(null); // Clear previous analysis
        // Auto-scroll to the holdings section
        setTimeout(() => {
          holdingsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 150);
      } else if (!data.warnings || data.warnings.length === 0) {
        setError("No holdings found in the uploaded file(s). Check that you exported Positions, not transaction history.");
      }
    } catch {
      setError("Failed to import portfolio data. Please try again.");
    } finally {
      setImportLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleCSVImport(e.dataTransfer.files);
    }
  }, [handleCSVImport]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const analyze = async () => {
    const validHoldings = holdings.filter((h) => h.symbol.trim() && h.shares > 0);
    if (validHoldings.length === 0) {
      setError("Add at least one holding with a ticker and shares.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/portfolio/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holdings: validHoldings, profile }),
      });
      const data = await res.json();

      if (data.error) {
        setError(data.error);
      } else {
        setResult(data);
        // Smooth scroll to results after a tick so DOM updates
        setTimeout(() => {
          resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 100);
      }
    } catch {
      setError("Failed to analyze portfolio. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-th-bg px-4 sm:px-6 py-8 sm:py-12">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <h1 className="text-2xl sm:text-3xl font-bold text-th-text tracking-tight">Portfolio Analyzer</h1>
        <p className="mt-2 text-sm sm:text-base text-th-text-3">
          Enter your holdings for a full analysis with diversification, risk assessment, and AI-powered recommendations.
        </p>

        {/* Saved portfolios (logged-in users) */}
        {isSignedIn && savedPortfolios.length > 0 && (
          <div className="mt-5">
            <h2 className="text-sm font-semibold text-th-text-2 mb-2">Saved Portfolios</h2>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {savedPortfolios.map((p) => (
                <div
                  key={p.id}
                  className="flex-shrink-0 w-56 bg-th-surface rounded-xl border border-th-border-light p-3 group hover:border-th-accent-border transition-colors"
                >
                  <button
                    onClick={() => handleLoadPortfolio(p)}
                    className="w-full text-left"
                  >
                    <p className="text-sm font-semibold text-th-text truncate">{p.name}</p>
                    <p className="text-xs text-th-text-3 mt-1">
                      {Array.isArray(p.holdings) ? p.holdings.length : 0} holdings
                    </p>
                    <p className="text-[10px] text-th-text-4 mt-0.5">
                      {new Date(p.created_at).toLocaleDateString()}
                    </p>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeletePortfolio(p.id); }}
                    disabled={deletingId === p.id}
                    className="mt-2 text-[10px] text-th-text-4 hover:text-th-negative transition-colors opacity-0 group-hover:opacity-100"
                  >
                    {deletingId === p.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CSV Import zone */}
        <div className="mt-6 sm:mt-8 bg-th-surface rounded-2xl border border-th-border-light p-4 sm:p-6">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            multiple
            onChange={(e) => e.target.files && handleCSVImport(e.target.files)}
            className="hidden"
          />

          {/* Drop zone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`w-full border-2 border-dashed rounded-xl p-6 transition-all cursor-pointer group ${
              dragOver
                ? "border-th-accent bg-th-accent-bg"
                : "border-th-border hover:border-th-accent-border hover:bg-th-accent-bg"
            } ${importLoading ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {importLoading ? (
              <div className="flex flex-col items-center gap-2">
                <svg className="animate-spin w-8 h-8 text-th-accent" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="text-sm font-medium text-th-accent">Importing your portfolio...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <div className="w-10 h-10 rounded-full bg-th-accent-bg flex items-center justify-center group-hover:bg-th-accent-muted transition-colors">
                  <svg className="w-5 h-5 text-th-accent" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-th-text-2">
                    {dragOver ? "Drop files here" : "Import your brokerage CSV or XLSX"}
                  </p>
                  <p className="text-xs text-th-text-3 mt-1">
                    Drag &amp; drop or click to browse &mdash; supports Fidelity, Schwab, E*TRADE, Vanguard, and more
                  </p>
                </div>
                <p className="text-[11px] text-th-text-4 mt-1">
                  .csv and .xlsx files, up to 10 MB each, max 5 files
                </p>
              </div>
            )}
          </div>

          {/* Import summary */}
          {importSummary && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-th-positive-bg text-th-positive font-medium">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                {importSummary.totalHoldings} holdings imported
              </span>
              {importSummary.brokersDetected.map((b) => (
                <span key={b} className="px-2 py-1 rounded-full bg-th-accent-bg text-th-accent font-medium">
                  {b}
                </span>
              ))}
              {importSummary.accountsDetected.length > 1 && (
                <span className="px-2 py-1 rounded-full bg-th-surface border border-th-border text-th-text-3">
                  {importSummary.accountsDetected.length} accounts
                </span>
              )}
              {importSummary.skippedRows > 0 && (
                <span className="px-2 py-1 rounded-full bg-th-warning-bg text-th-warning">
                  {importSummary.skippedRows} rows skipped
                </span>
              )}
            </div>
          )}

          {/* Import warnings */}
          {importWarnings.length > 0 && (
            <div className="mt-3 p-3 rounded-lg bg-th-warning-bg border border-th-warning/20">
              {importWarnings.map((w, i) => (
                <p key={i} className="text-xs text-th-warning leading-relaxed">
                  {w}
                </p>
              ))}
            </div>
          )}

          {/* Broker export instructions — compact dropdown */}
          <div className="mt-4 flex flex-col sm:flex-row items-start sm:items-center gap-2">
            <label className="text-xs font-medium text-th-text-3 whitespace-nowrap">
              How to export:
            </label>
            <select
              value={selectedBroker}
              onChange={(e) => setSelectedBroker(e.target.value)}
              className="px-3 py-1.5 text-sm bg-th-surface border border-th-border rounded-lg focus:outline-none focus:border-th-focus-border text-th-text-2"
            >
              <option value="">Select your broker...</option>
              {BROKER_INSTRUCTIONS.map((b) => (
                <option key={b.name} value={b.name}>{b.name}</option>
              ))}
            </select>
            {selectedBroker && (
              <p className="text-xs text-th-text-3 leading-relaxed">
                {BROKER_INSTRUCTIONS.find(b => b.name === selectedBroker)?.steps}
              </p>
            )}
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 border-t border-th-border-light" />
            <span className="text-xs font-medium text-th-text-3 uppercase tracking-wider">or enter manually</span>
            <div className="flex-1 border-t border-th-border-light" />
          </div>

          {/* Manual entry */}
          <h2 ref={holdingsRef} className="text-sm font-semibold text-th-text-2 mb-3">Your Holdings</h2>

          {/* Column headers */}
          <div className="flex items-center gap-2 sm:gap-3 mb-2 pl-0">
            <span className="w-20 sm:w-24 text-[10px] font-medium text-th-text-3 uppercase tracking-wider">Ticker</span>
            <span className="w-20 sm:w-24 text-[10px] font-medium text-th-text-3 uppercase tracking-wider">Shares</span>
            <span className="w-24 sm:w-28 text-[10px] font-medium text-th-text-3 uppercase tracking-wider">Avg Cost</span>
          </div>

          {/* Holdings list */}
          <div className="space-y-2">
            {holdings.map((h, i) => (
              <HoldingEntryRow
                key={i}
                holding={h}
                onUpdate={(updated) => updateHolding(i, updated)}
                onRemove={() => removeHolding(i)}
              />
            ))}
          </div>

          <button
            onClick={addHolding}
            className="mt-3 flex items-center gap-1.5 text-sm text-th-accent hover:text-th-accent transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add another
          </button>

          {/* Profile (optional) */}
          <div className="mt-6 pt-4 border-t border-th-border-light">
            <p className="text-xs font-medium text-th-text-3 uppercase tracking-wider mb-3">
              Optional: About you (for personalized advice)
            </p>
            <div className="flex flex-wrap items-start gap-4">
              <div>
                <label className="text-xs text-th-text-3 mb-1 block">Age</label>
                <input
                  type="number"
                  value={profile.age || ""}
                  onChange={(e) => setProfile({ ...profile, age: Number(e.target.value) || undefined })}
                  placeholder="30"
                  className="w-20 px-3 py-2 text-sm bg-th-surface border border-th-border rounded-lg focus:outline-none focus:border-th-focus-border"
                />
              </div>
              <div>
                <label className="text-xs text-th-text-3 mb-1 block">Est. net worth</label>
                <select
                  value={profile.netWorth || ""}
                  onChange={(e) => setProfile({ ...profile, netWorth: e.target.value || undefined })}
                  className="px-3 py-2 text-sm bg-th-surface border border-th-border rounded-lg focus:outline-none focus:border-th-focus-border text-th-text-2"
                >
                  <option value="">Select...</option>
                  <option value="Under $25K">Under $25K</option>
                  <option value="$25K – $100K">$25K – $100K</option>
                  <option value="$100K – $250K">$100K – $250K</option>
                  <option value="$250K – $500K">$250K – $500K</option>
                  <option value="$500K – $1M">$500K – $1M</option>
                  <option value="$1M – $5M">$1M – $5M</option>
                  <option value="$5M+">$5M+</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-th-text-3 mb-1 block">Risk tolerance</label>
                <select
                  value={profile.riskTolerance || ""}
                  onChange={(e) => setProfile({ ...profile, riskTolerance: e.target.value || undefined })}
                  className="px-3 py-2 text-sm bg-th-surface border border-th-border rounded-lg focus:outline-none focus:border-th-focus-border text-th-text-2"
                >
                  <option value="">Select...</option>
                  <option value="conservative">Conservative</option>
                  <option value="moderate">Moderate</option>
                  <option value="aggressive">Aggressive</option>
                </select>
              </div>
            </div>
          </div>

          {/* Analyze button */}
          <button
            onClick={analyze}
            disabled={loading || holdings.every((h) => !h.symbol.trim() || h.shares <= 0)}
            className="mt-6 w-full py-3 px-6 text-sm font-semibold text-white bg-th-accent rounded-xl hover:bg-th-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Analyzing...
              </>
            ) : (
              "Analyze Portfolio"
            )}
          </button>

          {error && (
            <p className="mt-3 text-sm text-th-negative text-center">{error}</p>
          )}
        </div>

        {/* Results */}
        {result && (
          <div ref={resultsRef} className="mt-8 space-y-6 animate-in fade-in duration-500">
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
              <div className="bg-th-surface rounded-xl border border-th-border-light p-3 sm:p-4 text-center">
                <p className="text-[10px] sm:text-xs text-th-text-3 uppercase tracking-wider">Total Value</p>
                <p className="text-lg sm:text-2xl font-bold text-th-text mt-1">
                  {formatCurrency(result.summary.totalValue)}
                </p>
              </div>
              <div className="bg-th-surface rounded-xl border border-th-border-light p-3 sm:p-4 text-center">
                <p className="text-[10px] sm:text-xs text-th-text-3 uppercase tracking-wider">Holdings</p>
                <p className="text-lg sm:text-2xl font-bold text-th-text mt-1">{result.summary.holdingCount}</p>
              </div>
              {result.summary.totalGainLoss !== null && (
                <div className="bg-th-surface rounded-xl border border-th-border-light p-3 sm:p-4 text-center">
                  <p className="text-[10px] sm:text-xs text-th-text-3 uppercase tracking-wider">Total Gain/Loss</p>
                  <p className={`text-lg sm:text-2xl font-bold mt-1 ${
                    result.summary.totalGainLoss >= 0 ? "text-th-positive" : "text-th-negative"
                  }`}>
                    {result.summary.totalGainLoss >= 0 ? "+" : ""}
                    {formatCurrency(result.summary.totalGainLoss)}
                  </p>
                </div>
              )}
              <div className="bg-th-surface rounded-xl border border-th-border-light p-3 sm:p-4 text-center">
                <Tooltip text="Beta measures how volatile your portfolio is vs. the market. 1.0 = same as S&P 500. Above 1 = more volatile (bigger swings). Below 1 = more stable. Most balanced portfolios fall between 0.8 and 1.2.">
                  <p className="text-[10px] sm:text-xs text-th-text-3 uppercase tracking-wider inline-flex items-center gap-1">
                    Portfolio Beta
                    <svg className="w-3 h-3 text-th-text-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
                    </svg>
                  </p>
                </Tooltip>
                <p className={`text-lg sm:text-2xl font-bold mt-1 ${
                  result.summary.weightedBeta > 1.3 ? "text-th-warning" :
                  result.summary.weightedBeta < 0.7 ? "text-th-accent" :
                  "text-th-text"
                }`}>
                  {result.summary.weightedBeta.toFixed(2)}
                </p>
                <p className="text-[10px] text-th-text-4 mt-0.5">
                  {result.summary.weightedBeta > 1.3 ? "High volatility" :
                   result.summary.weightedBeta > 1.0 ? "Above market" :
                   result.summary.weightedBeta > 0.7 ? "Near market" :
                   "Low volatility"}
                </p>
              </div>
            </div>

            {/* Save portfolio button (logged-in users only) */}
            {isSignedIn && !savedSuccess && !showSaveDialog && (
              <div className="flex justify-end">
                <button
                  onClick={() => setShowSaveDialog(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-th-accent bg-th-accent-bg border border-th-accent-border rounded-xl hover:bg-th-accent-muted transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
                  </svg>
                  Save Analysis
                </button>
              </div>
            )}
            {showSaveDialog && (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 max-w-md ml-auto">
                <input
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="Name this portfolio..."
                  className="flex-1 px-3 py-2 text-sm bg-th-surface border border-th-border rounded-lg focus:outline-none focus:border-th-focus-border"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") handleSavePortfolio(); }}
                />
                <button
                  onClick={handleSavePortfolio}
                  disabled={savingPortfolio || !saveName.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-th-accent rounded-lg hover:bg-th-accent-hover disabled:opacity-40 transition-colors"
                >
                  {savingPortfolio ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => { setShowSaveDialog(false); setSaveName(""); }}
                  className="px-3 py-2 text-sm text-th-text-3 hover:text-th-text-2 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
            {savedSuccess && (
              <p className="text-sm text-th-positive text-right font-medium">Portfolio saved!</p>
            )}

            {/* Detailed results - gated for guests */}
            <LoginGate
              locked={isGuest}
              message="Sign up to view your full portfolio analysis"
              subMessage="Sector allocation, per-holding detail, gain/loss breakdown, and AI-powered recommendations"
              blur="heavy"
              ctaPosition="top"
            >
              {/* AI Analysis — prominent placement */}
              {result.aiAnalysis && (
                <div className="bg-th-surface rounded-2xl border border-th-border-light overflow-hidden">
                  <div className="px-6 py-4 border-b border-th-border-light flex items-center gap-2">
                    <svg className="w-5 h-5 text-th-accent" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z" />
                    </svg>
                    <h3 className="text-sm font-semibold text-th-text">Advisor Analysis</h3>
                    <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-th-accent-bg text-th-accent border border-th-accent-border">
                      AI
                    </span>
                  </div>
                  <div className="px-6 py-5">
                    {renderMarkdown(result.aiAnalysis)}
                  </div>
                </div>
              )}

              {/* Sector allocation */}
              <div className="bg-th-surface rounded-2xl border border-th-border-light p-6 mt-6">
                <h3 className="text-sm font-semibold text-th-text-2 mb-3">Sector Allocation</h3>
                <SectorBar breakdown={result.summary.sectorBreakdown} />
              </div>

              {/* Holdings table */}
              <div className="bg-th-surface rounded-2xl border border-th-border-light overflow-x-auto mt-6">
                <div className="px-4 sm:px-6 py-3 border-b border-th-border-light">
                  <h3 className="text-sm font-semibold text-th-text-2">Holdings Detail</h3>
                </div>
                <div className="min-w-[640px]">
                  <HoldingsTableHeader />
                  <div className="divide-y divide-th-border-light">
                    {consolidated.map((h) => (
                      <ConsolidatedHoldingRow
                        key={h.symbol}
                        holding={h}
                        totalValue={result.summary.totalValue}
                        score={stockScores.get(h.symbol)}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Price note */}
              <p className="text-xs text-th-text-4 text-center mt-6">{result.priceNote}</p>
            </LoginGate>
          </div>
        )}
      </div>
    </div>
  );
}
